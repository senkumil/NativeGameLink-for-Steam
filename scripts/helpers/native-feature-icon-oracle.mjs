// Offline oracle: only Steam's installed visual factories are evaluated. Every
// dependency is an inert JSX/data adapter; no Steam account or client API runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function nativeFeatureIconOracle(steamPath) {
  const chunks = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(path.join(steamPath, 'sp.js'), 'utf8'), { self: chunks });
  const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
  const literals = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/pure-class-factory.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: literals });
  const classes = {};
  for (const [name, id] of Object.entries({ info: 76052, outer: 70989, feature: 92107 })) {
    classes[name] = literals.readPureClassFactory(factories[id]);
    assert(classes[name], `Installed ${name} CSS factory retains its literal contract`);
  }
  const jsx = (type, props = {}) => ({ type, props });
  const Fragment = Symbol('Fragment');
  class Component { constructor(props) { this.props = props; } }
  const combine = (...values) => values.flat().filter(value => typeof value === 'string' && value).join(' ');
  // ControllerType only compares enum identities. Distinct symbolic values keep
  // its actual PS4/PS5 branches while avoiding the controller services module.
  const controllerTypes = new Proxy({}, { get: (_target, name) => String(name) });
  const deps = {
    62540: { jsx, jsxs: jsx, Fragment },
    63696: { Component, createElement: jsx, forwardRef: callback => callback, memo: callback => callback },
    92107: classes.feature,
    26122: { Xr: overview => feature => overview.features.has(feature) },
    47438: { he: props => jsx('div', { className: props.className, children: props.children }) },
    7727: { we: token => token },
    3493: { wT: (condition, message) => assert(condition, message) },
    42095: {}, 43251: controllerTypes, 8658: { A: combine },
    // These imports belong to other SVGs in the shared glyph module. They have
    // no initialization behavior, and the selected feature glyphs do not call them.
    94601: {}, 20887: {}, 98146: {}, 81882: {},
    40311: { l: () => ['native-oracle-svg', 'url(#native-oracle-svg)'] },
    72672: {}, 23365: {}, 66069: {},
  };
  const requireVisual = id => {
    assert(Object.hasOwn(deps, id), `Unexpected visual-oracle dependency ${id}`);
    return deps[id];
  };
  requireVisual.d = (target, values) => {
    for (const [name, get] of Object.entries(values)) Object.defineProperty(target, name, { get, enumerable: true });
  };
  requireVisual.r = () => {};
  requireVisual.n = value => () => value;
  const glyphs = {}, featureIds = {}, features = {};
  assert.equal(typeof factories[69385], 'function', 'Installed SVG factory exists');
  factories[69385]({}, glyphs, requireVisual);
  // The feature enum is a constants-only factory. Reject any future dependency.
  factories[22189]({}, featureIds, Object.assign(id => { throw Error(`Unexpected feature-enum dependency ${id}`); }, { d: requireVisual.d }));
  deps[69385] = glyphs;
  deps[22189] = featureIds;
  factories[83420]({}, features, requireVisual);
  const escape = value => String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const svgAttributes = { className: 'class', fillRule: 'fill-rule', clipRule: 'clip-rule', clipPath: 'clip-path', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin' };
  const render = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(render).join('');
    if (typeof node !== 'object') return escape(node);
    const { type, props } = node;
    if (type === Fragment) return render(props.children);
    if (typeof type === 'function') return render(type.prototype?.render ? new type(props).render() : type(props));
    assert.equal(typeof type, 'string', 'Native feature retains a visual DOM renderer');
    const attributes = Object.entries(props).filter(([name, value]) => !['children', 'ref', 'style'].includes(name)
      && !name.startsWith('on') && value !== undefined && value !== null && value !== false)
      .map(([name, value]) => ` ${svgAttributes[name] || name}="${escape(value)}"`).join('');
    return `<${type}${attributes}>${render(props.children)}${['img', 'input'].includes(type) ? '' : `</${type}>`}`;
  };
  const mapping = [
    ['single-player', '$'], ['multiplayer', 'wE'], ['coop', 'ne'], ['achievements', 'II'],
    ['cloud', 'TQ'], ['workshop', 'Tm'], ['remote-play', 'of'], ['family-sharing', 'W9'],
    ['controller-full', '_j'], ['controller-partial', 'AW'], ['steam-input', 'mb'], ['ps4', 'Km'], ['ps5', 'xg'],
  ];
  const rows = mapping.map(([kind, symbol]) => {
    const feature = featureIds[symbol];
    assert.notEqual(feature, undefined, `Native feature ${kind} retains its enum`);
    const details = features.tx(feature);
    const html = render(jsx(features.n$, { overview: { features: new Set([feature]) }, feature, suppresstooltip: true }));
    assert(html.includes(classes.feature.Container) && html.includes(classes.feature.Icon), `Native ${kind} renders its row and glyph`);
    assert(/<(?:svg|img)\b/.test(html), `Native ${kind} renders an image or SVG`);
    return { kind, label: details.sDisplayName, html };
  });
  return { classes, rows };
}
