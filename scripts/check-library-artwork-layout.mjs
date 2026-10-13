import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const HEADER = '_2gZXhRmKUk68pA28-5ZmGQ', HERO = 'NZMJ6g2iVnFsOOp-lDmIP';
const BACKGROUND = '_1IX7FPSY9Jb82KhBVBSkZa', LOGO = '_3NBxSLAZLbbbnul8KfDFjw';
const PLAYBAR = '_3Yf8b2v5oOD8Wqsxu04ar', STATS = '_1mDAVT4sTzFRwJtlKCw2Ws';
let now = 1000, resolvedModules = [];
class Element {
  nodeType = 1;
  className = '';
  id = '';
  text = '';
  attrs = {};
  children = [];
  style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
  constructor(doc, className = '') { this.ownerDocument = doc; this.className = className; }
  get classList() { return { contains: token => this.className.split(/\s+/).includes(token) }; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.firstChild; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  getAttribute(key) { if (key === 'class') return this.className; if (key === 'id') return this.id; return this.attrs[key] ?? null; }
  setAttribute(key, value) { if (key === 'id') this.id = value; else this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  hasAttribute(key) { return this.getAttribute(key) !== null; }
  matches(selector) {
    return selector.split(',').some(part => {
      const attribute = part.trim().match(/^\[([\w-]+)(\*=|\^=|=)?(?:"([^"]*)")?\]$/);
      if (!attribute) return false;
      const [, key, op, expected] = attribute, actual = this.getAttribute(key);
      if (!op) return actual !== null;
      if (actual === null) return false;
      return op === '*=' ? actual.includes(expected) : op === '^=' ? actual.startsWith(expected) : actual === expected;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  contains(element) { for (let current = element; current; current = current.parentElement) if (current === this) return true; return false; }
  insertBefore(child, reference) {
    child.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    assert(index >= 0);
    this.children.splice(index, 0, child); child.parentElement = this;
  }
  appendChild(child) { this.insertBefore(child, null); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
}
class Document {
  constructor() { this.body = new Element(this); this.defaultView = { getComputedStyle: () => ({ backgroundImage: 'none', backgroundColor: 'rgba(0,0,0,0)' }) }; }
  createElement() { return new Element(this); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
  createTreeWalker(root) {
    const text = [];
    const visit = element => { if (element.text) text.push({ textContent: element.text, parentElement: element }); for (const child of element.children) visit(child); };
    visit(root); let index = 0;
    return { nextNode: () => text[index++] || null };
  }
}
function byClass(root, css) {
  const found = [], tokens = String(css || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return found;
  const visit = element => { if (tokens.every(token => element.classList.contains(token))) found.push(element); for (const child of element.children) visit(child); };
  visit(root.body || root); return found;
}
const css = { PLAYBAR_CLASSES: () => ({ Container: PLAYBAR, GameStatsSection: STATS }) };
const nativeDom = { elementsWithCssModuleClass: byClass, hasCssModuleClass: (element, css) => Boolean(css && element.classList.contains(css)) };
function load(file, dependencies) {
  const context = vm.createContext({ exports: {}, Document, HTMLElement: Element, Element, document: new Document(), NodeFilter: { SHOW_TEXT: 4 }, Date: { now: () => now }, require: name => {
    assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context.exports;
}
const header = load('frontend/steam/library-header.ts', {
  '@steambrew/client': { findClassModule: predicate => resolvedModules.find(predicate) }, './css': css, './native-dom': nativeDom,
});
const layout = load('frontend/features/library/layout.ts', {
  '../../steam/localization': { loc: (_key, fallback) => fallback },
  '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility() {} }, '../../steam/library-header': header,
});
function fixture(noticeInsideHeader = false) {
  const doc = new Document(), shell = new Element(doc); doc.body.appendChild(shell);
  const art = new Element(doc, HEADER), hero = new Element(doc, HERO), background = new Element(doc, BACKGROUND), logo = new Element(doc, LOGO);
  background.setAttribute('src', 'https://steamloopback.host/local-hero.jpg'); logo.setAttribute('src', 'https://steamloopback.host/local-logo.png');
  art.appendChild(hero); hero.appendChild(background); hero.appendChild(logo); shell.appendChild(art);
  const playbar = new Element(doc, PLAYBAR), stats = new Element(doc, STATS); playbar.appendChild(stats); shell.appendChild(playbar);
  const row = new Element(doc), content = new Element(doc), sidebar = new Element(doc), region = new Element(doc), notes = new Element(doc), notice = new Element(doc);
  region.setAttribute('role', 'region'); notes.textContent = 'Notes'; region.appendChild(notes); sidebar.appendChild(region);
  if (noticeInsideHeader) { hero.appendChild(notice); shell.appendChild(sidebar); }
  else { shell.appendChild(row); row.appendChild(content); row.appendChild(sidebar); content.appendChild(notice); }
  return { doc, shell, art, hero, background, logo, playbar, row, content, sidebar, region, notice };
}
const regular = fixture();
assert.equal(header.findNativeLibraryHeader(regular.doc), regular.art, 'hashed native header is found before CSS exports resolve');
const sources = [regular.background.getAttribute('src'), regular.logo.getAttribute('src')];
for (const element of [regular.art, regular.hero, regular.background, regular.logo, regular.playbar, regular.shell]) {
  layout.hideNativeLibraryElement(element);
  assert.notEqual(element.style.display, 'none', 'native artwork/playbar and enclosing surfaces cannot be hidden');
  assert.equal(element.hasAttribute('data-gdl-hidden'), false);
}
const discovered = layout.discoverNativeLibraryLayout(regular.doc, regular.notice);
assert.equal(discovered.contentColumn, regular.content, 'normal notice/Notes columns still resolve');
assert.equal(discovered.sidebarColumn, regular.sidebar);
const injected = new Element(regular.doc); injected.id = 'gdl-main-content-stack';
layout.prepareNativeLibraryLayout(discovered); layout.insertMainContent(injected, discovered, new Set());
assert.equal(injected.parentElement, regular.content, 'ordinary linked content still mounts');
assert.equal(regular.notice.style.display, 'none', 'only the original content/notice is concealed');
assert.deepEqual([regular.background.getAttribute('src'), regular.logo.getAttribute('src')], sources, 'hero/logo sources retain identity');
assert.equal(regular.art.parentElement, regular.shell); assert.equal(regular.hero.parentElement, regular.art);

const incomplete = fixture(true);
const partialLayout = { anchorRegion: incomplete.region, sidebarColumn: incomplete.sidebar, twoColumnRow: incomplete.shell, contentColumn: incomplete.shell, noticeParent: incomplete.hero };
const partialInjected = new Element(incomplete.doc); partialInjected.id = 'gdl-main-content-stack';
layout.prepareNativeLibraryLayout(partialLayout); layout.insertMainContent(partialInjected, partialLayout, new Set());
assert.equal(partialInjected.isConnected, false, 'an incomplete broad content host waits instead of covering native artwork');
assert.equal(incomplete.shell.style.display, undefined, 'partial layout cannot resize the entire native header ancestor');
const partialDiscovery = layout.discoverNativeLibraryLayout(incomplete.doc, incomplete.notice);
assert(!partialDiscovery.contentColumn || !header.containsNativeLibraryHeader(partialDiscovery.contentColumn), 'discovery never accepts a hashed header ancestor as content');
assert.equal(incomplete.background.getAttribute('src'), sources[0]); assert.equal(incomplete.logo.getAttribute('src'), sources[1]);

resolvedModules = [{ Header: 'next-header-hash', HeaderLoaded: 'next-loaded', ShowPlayBar: 'next-shown', AppDetailsOverviewPanel: 'next-overview' },
  { TopCapsule: 'next-hero-hash', HeaderBackgroundImage: 'next-background-hash', TitleLogo: 'next-logo-hash' }];
now += 6000;
const updated = new Element(regular.doc, 'next-header-hash'); regular.doc.body.appendChild(updated);
assert(header.containsNativeLibraryHeader(updated), 'resolved CSS modules protect changed Steam hashes');
layout.hideNativeLibraryElement(updated); assert.equal(updated.hasAttribute('data-gdl-hidden'), false);
assert(header.containsNativeLibraryHeader(regular.art), 'fallback hashes remain protected through module hydration');
console.log('Library artwork layout passed: native hashed hero/header/playbar and image sources stay intact, partial layouts wait safely, normal notice/Notes injection works, and CSS module updates are recognized.');
