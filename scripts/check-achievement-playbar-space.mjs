import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('frontend/steam/achievement-playbar-space.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness(native = true, blueprint = false) {
  const classes = { Container: 'native-bar', AppButtonsContainer: 'native-buttons' };
  const stats = [], writes = [], nativeWrites = [];
  const style = (owner, value = '', priority = '') => {
    const values = new Map(value ? [['margin-inline-end', value]] : []);
    const priorities = new Map(priority ? [['margin-inline-end', priority]] : []);
    return {
      getPropertyValue: property => values.get(property) || '',
      getPropertyPriority: property => priorities.get(property) || '',
      setProperty(property, value, priority) { values.set(property, value); priorities.set(property, priority); writes.push([owner, property, value, priority]); },
      removeProperty(property) { values.delete(property); priorities.delete(property); writes.push([owner, property]); },
    };
  };
  const doc = {
    defaultView: { getComputedStyle: element => element.computed() },
    querySelectorAll: selector => { assert.equal(selector, '[data-gdl-playbar-achievements="1"]'); return stats; },
  };
  const dependencies = {
    './css': { PLAYBAR_CLASS_MODULE: () => ({ native, classes }) },
    './native-dom': {
      hasNativeUiBlueprint: () => blueprint,
      NATIVE_UI_BLUEPRINT_KEYS: { infoButton: 'info-button' },
      closestWithCssModuleClass: (stat, className) => { assert.equal(className, classes.Container); return stat.bar; },
      elementsWithCssModuleClass: (bar, className) => { assert.equal(className, classes.AppButtonsContainer); return bar.buttons ? [bar.buttons] : []; },
    },
  };
  const context = vm.createContext({ exports: {}, require: name => {
    assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  } });
  vm.runInContext(compiled, context);
  const makeBar = () => {
    const controls = [];
    const buttons = { querySelectorAll: () => controls, style: {
      setProperty() { nativeWrites.push('buttons'); }, removeProperty() { nativeWrites.push('buttons'); },
    } };
    return { buttons, controls, style: {
      setProperty() { nativeWrites.push('bar'); }, removeProperty() { nativeWrites.push('bar'); },
    } };
  };
  const makeStat = (bar, value = '', priority = '', baseMargin = 5) => {
    const stat = { bar, style: style('owned', value, priority) };
    stat.computed = () => ({ marginInlineEnd: stat.style.getPropertyValue('margin-inline-end') || `${baseMargin}px` });
    stats.push(stat); return stat;
  };
  const info = (owned = true, hidden = false, display = 'flex') => ({
    hidden, matches: () => owned, querySelector: () => owned ? null : {}, computed: () => ({ display }),
  });
  return { ...context.exports, doc, makeBar, makeStat, info, writes, nativeWrites };
}

{
  const h = harness(), bar = h.makeBar(), stat = h.makeStat(bar);
  h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '47px', 'The first mount reserves 42px plus Steam’s 5px existing margin');
  assert.equal(stat.style.getPropertyPriority('margin-inline-end'), 'important');
  const before = h.writes.length;
  for (let count = 0; count < 100; count++) h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(h.writes.length, before, '100 repeated synchronizations produce no extra style writes or accumulating margins');
  bar.controls.push(h.info()); h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '', 'Mounting Info retires the reservation synchronously');
  const after = h.writes.length;
  for (let count = 0; count < 100; count++) h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(h.writes.length, after, 'The installed control needs no repeated restoration writes');
  bar.controls.length = 0; h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '47px', 'Removing Info reserves its future space again');
  assert.deepEqual(h.nativeWrites, [], 'Neither the native bar nor its native controls receive style changes');
}

{
  const h = harness(), bar = h.makeBar(), stat = h.makeStat(bar, '12px', 'important');
  h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '54px', 'An authored inline margin is included in the reservation');
  bar.controls.push(h.info(false)); h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '12px', 'A native Information SVG also satisfies the slot');
  assert.equal(stat.style.getPropertyPriority('margin-inline-end'), 'important', 'The exact original priority is restored');
}

{
  const h = harness(), first = h.makeBar(), second = h.makeBar(), a = h.makeStat(first), b = h.makeStat(second);
  first.controls.push(h.info()); h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(a.style.getPropertyValue('margin-inline-end'), '');
  assert.equal(b.style.getPropertyValue('margin-inline-end'), '47px', 'Info in another native playbar cannot satisfy this stat’s reservation');
  second.controls.push(h.info(true, true)); h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(b.style.getPropertyValue('margin-inline-end'), '47px', 'A hidden information control does not consume the reserved slot');
  second.controls[0] = h.info(true, false, 'none'); h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(b.style.getPropertyValue('margin-inline-end'), '47px', 'A display:none control does not consume the reserved slot');
  b.bar = null; h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(b.style.getPropertyValue('margin-inline-end'), '', 'A stat removed from its native bar releases its temporary styling');
}

{
  const h = harness(false), bar = h.makeBar(), stat = h.makeStat(bar);
  h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '47px', 'Class discovery failure keeps the same 32px control and 10px native margin');
}

{
  const h = harness(false, true), bar = h.makeBar(), stat = h.makeStat(bar);
  h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '47px', 'A captured native Info button still reserves its native 42px when class discovery falls back');
  bar.controls.push({ hidden: false, matches: () => false, querySelector: () => null,
    getAttribute: name => name === 'aria-label' ? 'Detalles del juego' : '', computed: () => ({ display: 'flex' }) });
  h.syncAchievementPlaybarSpace(h.doc);
  assert.equal(stat.style.getPropertyValue('margin-inline-end'), '', 'The same localized native Info label accepted by the installer satisfies the reserved slot');
}

console.log('Achievement playbar space checks passed: final Info width is reserved before mount, restored synchronously, idempotent, and owned styles only.');
