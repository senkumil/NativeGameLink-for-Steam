import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const rows = { Container: '_2-O4ZG0KrnSrzISHBKctFQ', GameListEntryContainer: '_1vO6BoiVslZgs1kqDGdUs8' };
const sidebar = { Container: '_3x1HklzyDs4TEjACrRO2tB' };
let reads = 0;
class Element {
  nodeType = 1;
  parentElement = null;
  nodes = [];
  constructor(className = '', popover = '') { this.className = className; this.popover = popover; }
  get children() { reads++; return this.nodes; }
  classList = { contains: token => this.className.split(/\s+/).includes(token) };
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (selector === '[popover="manual"]' && element.popover === 'manual') return element;
      if (selector.split(',').some(part => {
        const match = part.trim().match(/^\[class\*="([^"]+)"\]$/);
        return match && element.className.includes(match[1]);
      })) return element;
    }
    return null;
  }
  append(child) { this.nodes.push(child); child.parentElement = this; return child; }
  getBoundingClientRect() { throw new Error('Classifying list mutations must never measure layout'); }
  querySelectorAll() { throw new Error('Classifying a hover must never scan the document/list'); }
}
const context = vm.createContext({ exports: {}, require: name => {
  assert.equal(name, './css'); return { LIBRARY_SIDEBAR_CLASSES: () => sidebar, LIBRARY_SIDEBAR_ENTRY_CLASSES: () => rows };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/library-sidebar.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { isLibrarySidebarMutation, withoutLibrarySidebarMutations } = context.exports;
const body = new Element(), bar = body.append(new Element(sidebar.Container)), row = bar.append(new Element(rows.Container));
const record = (target, addedNodes = [], removedNodes = []) => ({ target, addedNodes, removedNodes });
for (let index = 0; index < 100; index++) assert(isLibrarySidebarMutation([record(row, [new Element()])]));
assert.equal(reads, 0, 'Ordinary row recycling never traverses the list or measures layout');

// Steam 15489 -> createPortal(92251 HoverPositionOuter[popover=manual] -> wrappers -> row, body).
const portal = new Element('', 'manual'), wrapper = portal.append(new Element()), focus = wrapper.append(new Element());
const hoverRow = focus.append(new Element(rows.GameListEntryContainer));
const hoverAdded = record(body, [portal]), hoverRemoved = record(body, [], [portal]);
const hoverContent = record(wrapper, [new Element()]);
const details = body.append(new Element('native-details')), nativeUpdate = record(details, [new Element()]);
for (let index = 0; index < 100; index++) {
  assert(isLibrarySidebarMutation([hoverAdded, hoverRemoved, hoverContent]));
  assert.deepEqual(Array.from(withoutLibrarySidebarMutations([hoverAdded, nativeUpdate, hoverRemoved])), [nativeUpdate]);
}
wrapper.nodes.length = 0; focus.parentElement = null;
assert(isLibrarySidebarMutation([record(wrapper, [], [focus])]), 'Detached hover content is recognized through its native portal host');
const ordinaryPopover = new Element('', 'manual'); ordinaryPopover.append(new Element('native-details'));
assert(!isLibrarySidebarMutation([record(body, [ordinaryPopover])]), 'Unrelated native popovers remain visible to their feature observers');
const page = new Element(); page.append(new Element(rows.Container)); page.append(new Element('native-details'));
assert(!isLibrarySidebarMutation([record(body, [page])]), 'A new page containing both list and details is never mistaken for a row portal');
const oversized = new Element('', 'manual'); let tail = oversized;
for (let index = 0; index < 60; index++) tail = tail.append(new Element());
tail.append(new Element(rows.Container)); reads = 0;
assert(!isLibrarySidebarMutation([record(body, [oversized])]));
assert(reads <= 48, 'Portal discovery has a fixed traversal budget');
assert.equal(hoverRow.className, rows.GameListEntryContainer);
console.log('Sidebar portal checks passed: 100 native row and body-portal cycles, mixed details, detached content, unrelated popovers and bounded traversal without list scans or layout reads.');
