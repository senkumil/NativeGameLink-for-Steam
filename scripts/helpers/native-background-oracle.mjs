// Offline visual oracle. Evaluate only Steam's isolated header/background
// renderer with inert JSX adapters; no client, account, stores or network run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function nativeBackgroundOracle(steamPath = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') {
  const chunks = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(path.join(steamPath, 'sp.js'), 'utf8'), { self: chunks });
  const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
  const literals = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/pure-class-factory.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: literals });
  const css = id => {
    const result = literals.readPureClassFactory(factories[id]);
    assert(result, `Installed CSS factory ${id} must remain pure`);
    return result;
  };
  const heroClasses = css(4527), detailsClasses = css(69196), overviewClasses = css(69359), headerClasses = css(46621);
  const source = String(factories[53507]);
  const begin = source.indexOf('const v={exit:');
  const end = source.indexOf('function J(', begin);
  assert(begin > 0 && end > begin, 'Installed pure hero renderer boundaries are identifiable');
  const visualSource = source.slice(begin, end);
  assert(!/SteamClient|GetClientSetting|GetHeroImages|GetAppOverview|fetch\(|XMLHttpRequest/.test(visualSource),
    'The extracted visual region cannot access native services or network');
  assert(visualSource.includes('updateRate:0,width:192,height:62,reductionFactor:10,blurAmount:3'),
    'Installed native canvas blur retains its static reduction/radius contract');
  const jsx = (type, props = {}) => ({ type, props });
  const Fragment = Symbol('Fragment');
  class Component {
    constructor(props) { this.props = props; }
    setState(next, callback) { Object.assign(this.state, next); callback?.(); }
  }
  const createContext = value => ({ Provider: props => props.children, Consumer: props => props.children(value) });
  const combine = (...values) => values.flat().filter(value => typeof value === 'string' && value).join(' ');
  const native = vm.runInNewContext(`(() => { ${visualSource}; return { Header: H, Background: Y }; })()`, {
    e: { jsx, jsxs: jsx },
    a: { Component, Fragment, createContext, createRef: () => ({ current: null }) },
    // Decorators are inert: the visual methods still execute unchanged.
    E: (_decorators, target) => target, l: {}, s: { PA: target => target },
    S: { i_: value => Number.parseFloat(value) }, z: () => heroClasses, P: () => heroClasses,
    r: { Pk: 'BottomLeft', Ag: 'UpperCenter', NO: 'CenterCenter', Fv: 'BottomCenter', pp: 'None' },
    N: { wT: (value, label) => assert(value, label) }, d: { A: combine },
    // Transition/context wrappers only forward their child tree in a steady
    // desktop state. Their services and lifecycle are intentionally absent.
    O: { M: props => props.children(null) },
    I: { c: props => jsx('img', { ...props, rgSources: undefined, src: props.rgSources[0] }) },
    x: { m: props => jsx('canvas', props) },
  });
  const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const render = (node, options) => {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(value => render(value, options)).join('');
    if (typeof node !== 'object') return escape(node);
    const { type, props } = node;
    if (type === Fragment) return render(props.children, options);
    if (type === native.Background) {
      const background = new type(props);
      background.state.bBackgroundLoaded = true;
      background.state.bUseCanvasBlur = options.canvas;
      return render(background.render(), options);
    }
    if (typeof type === 'function') return render(type.prototype?.render ? new type(props).render() : type(props), options);
    assert.equal(typeof type, 'string', 'Only visual DOM nodes may leave the native oracle');
    const attributes = Object.entries(props).filter(([name, value]) => !['children', 'ref', 'elementRef', 'updateRate', 'reductionFactor', 'blurAmount'].includes(name)
      && !name.startsWith('on') && value !== undefined && value !== null && value !== false)
      .map(([name, value]) => {
        if (name === 'style') value = Object.entries(value).filter(([, entry]) => entry != null)
          .map(([key, entry]) => `${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}:${entry}`).join(';');
        return ` ${name === 'className' ? 'class' : name}="${escape(value)}"`;
      }).join('');
    return `<${type}${attributes}>${render(props.children, options)}</${type}>`;
  };
  return {
    heroClasses, detailsClasses, overviewClasses, headerClasses,
    visualSource,
    source: { header: source, assetSelection: String(factories[32558]), details: String(factories[27531]) },
    headerHtml({ heroURL, blurURL = '', canvas = !blurURL, lowPerf = false, height = 320, hasHeroImage = true } = {}) {
      assert(heroURL, 'Oracle fixtures must supply their own image URL');
      return render(jsx(native.Header, { appid: 1, hasHeroImage, height,
        rgHeaderImages: [heroURL, heroURL], rgBlurImages: blurURL ? [blurURL] : [],
        rgLogoImages: [], bLowPerfMode: lowPerf, bFullscreen: false }), { canvas });
    },
  };
}
