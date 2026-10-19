// Offline oracle: evaluate only the installed SVG visual factory with inert JSX
// adapters. The playbar's sticky-state contract is read from its renderer source;
// no Steam client, controller service, account store, or network API is executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function nativeScrollTopOracle(steamPath = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') {
  const chunks = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(path.join(steamPath, 'sp.js'), 'utf8'), { self: chunks });
  const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
  const literals = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/pure-class-factory.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: literals });
  const classes = literals.readPureClassFactory(factories[96821]);
  const detailsClasses = literals.readPureClassFactory(factories[69196]);
  const overviewClasses = literals.readPureClassFactory(factories[69359]);
  assert(classes?.Container && classes.StickyHeader && classes.InPage && classes.DotDotDot && classes.MenuButton,
    'Installed playbar retains its native state and button classes');
  assert(detailsClasses?.ShowPlayBar && overviewClasses?.HidePlayBar, 'Installed details renderer retains both playbar visibility states');

  const playbarSource = String(factories[89980]);
  const detailsSource = String(factories[27531]);
  const overviewSource = String(factories[43257]);
  const waypointSource = String(factories[41182]);
  const intersectionSource = String(factories[28368]);
  const visualContract = playbarSource.match(/children:this\.props\.stickyheader\?\(0,e\.jsx\)\(k\.i3G,\{angle:0\}\):\(0,e\.jsx\)\(k\.\$\$j,\{\}\)/)?.[0];
  assert(visualContract, 'Installed playbar selects Arrow/Information solely from its own stickyheader prop');
  assert(playbarSource.includes('ct&&V().StickyHeader'), 'Installed playbar exposes the same stickyheader prop as its StickyHeader class');
  assert(playbarSource.includes('#GameAction_ViewDetails_ScrollUp'), 'Installed sticky playbar retains its own scroll-up label');
  assert(overviewSource.includes('onLeave:this.OnHeaderWaypointLeave,onEnter:this.OnHeaderWaypointEnter'),
    'Installed overview retains the header waypoint callbacks');
  assert(overviewSource.includes('bInPage:!0') && overviewSource.includes('stickyheader:Xe'),
    'Installed in-page playbar receives the native sticky state');
  assert(detailsSource.includes('stickyheader:Z') && detailsSource.includes('z().ShowPlayBar'),
    'Installed fixed playbar receives the native sticky and visibility state');
  assert(waypointSource.includes('fontSize:0') && intersectionSource.includes('isIntersecting'),
    'Installed header waypoint remains an IntersectionObserver sentinel');

  const jsx = (type, props = {}) => ({ type, props });
  const Fragment = Symbol('Fragment');
  class Component { constructor(props) { this.props = props; } }
  const combine = (...values) => values.flat().filter(value => typeof value === 'string' && value).join(' ');
  const deps = {
    62540: { jsx, jsxs: jsx, Fragment },
    63696: { Component, createElement: jsx, forwardRef: callback => callback, memo: callback => callback },
    8658: { A: combine },
    // Unrelated glyphs import these modules; Arrow and Information never call them.
    23365: {}, 64664: {}, 6739: {}, 40311: {}, 22545: {},
  };
  const requireVisual = id => {
    assert(Object.hasOwn(deps, id), `Unexpected scroll-top SVG dependency ${id}`);
    return deps[id];
  };
  requireVisual.d = (target, values) => {
    for (const [name, get] of Object.entries(values)) Object.defineProperty(target, name, { get, enumerable: true });
  };
  requireVisual.r = () => {};
  requireVisual.n = value => () => value;
  const glyphs = {};
  assert.equal(typeof factories[42095], 'function', 'Installed playbar SVG factory exists');
  factories[42095]({}, glyphs, requireVisual);
  assert.equal(typeof glyphs.i3G, 'function', 'Installed Arrow export exists');
  assert.equal(typeof glyphs.$$j, 'function', 'Installed Information export exists');
  const escape = value => String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const svgAttributes = {
    className: 'class', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
    strokeMiterlimit: 'stroke-miterlimit', fillRule: 'fill-rule', clipRule: 'clip-rule',
  };
  const render = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(render).join('');
    if (typeof node !== 'object') return escape(node);
    const { type, props } = node;
    if (type === Fragment) return render(props.children);
    if (typeof type === 'function') return render(type.prototype?.render ? new type(props).render() : type(props));
    assert.equal(typeof type, 'string', 'Native scroll-top glyph retains a visual DOM renderer');
    const attributes = Object.entries(props).filter(([name, value]) => !['children', 'ref'].includes(name)
      && !name.startsWith('on') && value !== undefined && value !== null && value !== false)
      .map(([name, value]) => {
        if (name === 'style') value = Object.entries(value).map(([key, entry]) => `${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}:${entry}`).join(';');
        return ` ${svgAttributes[name] || name}="${escape(value)}"`;
      }).join('');
    return `<${type}${attributes}>${render(props.children)}</${type}>`;
  };
  const arrowHtml = render(jsx(glyphs.i3G, { angle: 0 }));
  const infoHtml = render(jsx(glyphs.$$j));
  assert(arrowHtml.includes('SVGIcon_Button SVGIcon_Arrow') && arrowHtml.includes('<polyline'), 'Installed Arrow renders its native SVG');
  assert(infoHtml.includes('SVGIcon_Button SVGIcon_Information') && infoHtml.includes('<circle'), 'Installed Information renders its native SVG');
  return {
    classes, detailsClasses, overviewClasses, arrowHtml, infoHtml,
    scrollTopLabelToken: 'GameAction_ViewDetails_ScrollUp',
    visualContract,
    // These sources are useful for precise regression assertions without invoking
    // the full account-dependent React components.
    evidence: { playbarSource, detailsSource, overviewSource, waypointSource, intersectionSource },
  };
}
