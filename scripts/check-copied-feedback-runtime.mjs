import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let language = 'english';
class TextNode {
  nodeType = 3;
  constructor(value) { this.nodeValue = value; }
  get nextSibling() {
    return this.parentElement?.childNodes[this.parentElement.childNodes.indexOf(this) + 1] || null;
  }
}
class Element {
  nodeType = 1;
  childNodes = [];
  attributes = new Map();
  writes = 0;
  constructor(doc, tag = 'div') {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    const values = new Map();
    const priorities = new Map();
    this.style = {
      getPropertyValue: key => values.get(key) || '',
      getPropertyPriority: key => priorities.get(key) || '',
      setProperty: (key, value, priority) => { this.writes++; values.set(key, value); priorities.set(key, priority); },
    };
  }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { return this.parentElement?.childNodes[this.parentElement.childNodes.indexOf(this) + 1] || null; }
  get textContent() { throw new Error('Cleanup must never concatenate ancestor textContent'); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  matches() { return ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(this.tagName) || this.getAttribute('role') === 'button'; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  appendChild(child) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.childNodes.push(child); return child; }
  remove() { this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); this.parentElement = null; }
}
function createDocument() {
  const frames = new Map();
  const timers = new Map();
  let next = 0;
  const doc = { walkers: [], visits: 0 };
  doc.body = new Element(doc, 'body');
  doc.defaultView = {
    closed: false, performance: { now: () => 0 },
    requestAnimationFrame: fn => { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  };
  doc.querySelectorAll = () => { throw Error('Cleanup must never query the whole document'); };
  doc.createTreeWalker = root => {
    doc.walkers.push(root);
    let current = root;
    return { nextNode() {
      if (current.firstElementChild) current = current.firstElementChild;
      else {
        while (current && current !== root) {
          const siblings = current.parentElement.children;
          const sibling = siblings[siblings.indexOf(current) + 1];
          if (sibling) { current = sibling; break; }
          current = current.parentElement;
        }
        if (current === root) return null;
      }
      doc.visits++;
      return current;
    } };
  };
  doc.flushSlice = () => {
    const paint = Array.from(frames.values()); frames.clear();
    for (const fn of paint) fn();
    const tasks = Array.from(timers.values()); timers.clear();
    for (const fn of tasks) fn();
  };
  doc.flush = () => { for (let step = 0; (frames.size || timers.size) && step < 200; step++) doc.flushSlice(); };
  doc.pending = () => frames.size + timers.size;
  return doc;
}
function leaf(doc, text, tag = 'span') {
  const element = new Element(doc, tag);
  element.appendChild(new TextNode(text));
  return element;
}
const context = vm.createContext({ exports: {}, Date, require: name => {
  assert.equal(name, '../steam/localization');
  return {
    steamLanguageSync: () => language,
    officialSteamText: text => language === 'french' ? (text === 'Copied!' ? 'Copié !' : 'Copié') : text,
  };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/runtime/copied-feedback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { scheduleCopiedFeedbackCleanup: schedule, disposeCopiedFeedbackCleanup: dispose } = context.exports;

const doc = createDocument();
for (let index = 0; index < 6000; index++) doc.body.appendChild(new Element(doc)).appendChild(leaf(doc, `Library content ${index}`));
schedule(doc);
assert.equal(doc.visits, 0, 'initial discovery performs no synchronous DOM scan before paint');
doc.flushSlice();
assert(doc.visits > 0 && doc.visits <= 255, 'a large initial document is scanned in bounded slices');
doc.flush();
const completeVisits = doc.visits;
schedule(doc); doc.flush();
assert.equal(doc.visits, completeVisits, 'initial document discovery runs only once per document');
const image = doc.body.appendChild(new Element(doc, 'img'));
const beforeImageWalks = doc.walkers.length;
schedule(doc, [image]); doc.flush();
assert.equal(doc.walkers.length, beforeImageWalks, 'adding hero/logo images never scans their document');
assert.equal(doc.visits, completeVisits, 'empty image roots require zero element visits');

const unrelated = doc.body.appendChild(leaf(doc, 'Copied!'));
const tooltip = doc.body.appendChild(new Element(doc));
tooltip.attributes.set('role', 'tooltip');
tooltip.appendChild(leaf(doc, 'Copied!'));
schedule(doc, [tooltip]);
assert.equal(tooltip.writes, 0, 'tooltip hiding also waits until after paint');
doc.flush();
assert.equal(tooltip.style.getPropertyValue('display'), 'none', 'an exact copied tooltip is hidden');
assert.equal(tooltip.style.getPropertyValue('pointer-events'), 'none');
assert.equal(unrelated.writes, 0, 'mutation cleanup is restricted to the supplied root');
const hiddenWrites = tooltip.writes;
for (let index = 0; index < 100; index++) schedule(doc, [tooltip]);
doc.flush();
assert.equal(tooltip.writes, hiddenWrites, '100 repeated notifications never rewrite an already hidden tooltip');

language = 'french';
const localized = doc.body.appendChild(leaf(doc, 'Copié !', 'p'));
schedule(doc, [localized]); doc.flush();
assert.equal(localized.style.getPropertyValue('display'), 'none', 'Steam localization supplies exact copied labels');
const button = doc.body.appendChild(new Element(doc, 'button'));
const buttonText = button.appendChild(leaf(doc, 'Copied!'));
const longer = doc.body.appendChild(leaf(doc, 'Copied! Your library information is available.'));
schedule(doc, [button, longer]); doc.flush();
assert.equal(button.writes + buttonText.writes + longer.writes, 0, 'interactive labels and ordinary longer text remain untouched');

const cancelled = doc.body.appendChild(leaf(doc, 'Copied!'));
schedule(doc, [cancelled]);
dispose(doc); dispose(doc);
doc.flush();
assert.equal(cancelled.writes, 0, 'disposal cancels queued work idempotently');
assert.equal(doc.pending(), 0);
console.log('Copied feedback runtime passed: 12,000-node deferred/bounded discovery, zero image-root walks, exact localized tooltip labels, scoped mutations, 100 idempotent updates and disposal.');
