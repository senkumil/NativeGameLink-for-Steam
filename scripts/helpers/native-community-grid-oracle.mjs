// Offline layout oracle. Only the installed client's pure item classifier,
// width calculator and row matcher run; no module, client or account API runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function functionAt(source, offset) {
  const parsed = ts.createSourceFile('native-community-grid.js', source.slice(offset, offset + 8192),
    ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const declaration = parsed.statements[0];
  assert(ts.isFunctionDeclaration(declaration) && declaration.body,
    'Installed Community layout helper remains an isolated function declaration');
  return { name: declaration.name.text, source: declaration.getText(parsed), offset };
}

export function nativeCommunityGridOracle(steamPath = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') {
  const filename = path.join(steamPath, 'sp.js');
  const installed = fs.readFileSync(filename, 'utf8');
  // Capability discovery tolerates changing webpack module IDs and minified
  // names, while requiring the row matcher's actual template vocabulary.
  let select;
  for (const match of installed.matchAll(/\.eFixedCard/g)) {
    const before = installed.slice(Math.max(0, match.index - 1500), match.index);
    const declarations = [...before.matchAll(/function\s+[\w$]+\([^)]*\)\{/g)];
    if (!declarations.length) continue;
    const offset = Math.max(0, match.index - 1500) + declarations.at(-1).index;
    const candidate = functionAt(installed, offset);
    if (candidate.source.includes('.eFixedCard') && candidate.source.includes('.nItemSpace')
      && candidate.source.includes('.eSize')) { select = candidate; break; }
  }
  assert(select, 'Installed Community row matcher has fixed-card and remaining-space templates');
  const widthName = select.source.match(/([\w$]+)\([\w$]+\.eSize\)/)?.[1];
  assert(widthName, 'Native matcher derives a candidate width from its eSize');
  const widthOffset = installed.lastIndexOf(`function ${widthName}(`, select.offset);
  assert(widthOffset >= 0, 'Native candidate width helper precedes the row matcher');
  const width = functionAt(installed, widthOffset);
  const preceding = installed.slice(Math.max(0, widthOffset - 1500), widthOffset);
  const classifierOffset = [...preceding.matchAll(/function\s+[\w$]+\([^)]*\)\{/g)].at(-1)?.index;
  assert(classifierOffset !== undefined, 'Native Community item classifier precedes its width helper');
  const classify = functionAt(installed, Math.max(0, widthOffset - 1500) + classifierOffset);
  assert(classify.source.includes('.image_width') && classify.source.includes('.image_height'),
    'Installed classifier uses intrinsic media dimensions');
  assert(/2\.5/.test(classify.source) && /\.8/.test(classify.source),
    'Installed panoramic and portrait classifier thresholds are identifiable');
  const symbols = [...classify.source.matchAll(/\.type==([\w$]+)\.([\w$]+)/g)];
  assert(symbols.length === 3 && new Set(symbols.map(match => match[1])).size === 1,
    'Native classifier retains its video and guide enum comparisons');
  const types = { video: 'native-video', guide: 'native-guide', otherGuide: 'native-other-guide' };
  const enums = Object.fromEntries(symbols.map((match, index) => [match[2], Object.values(types)[index]]));
  const pureSource = [classify.source, width.source, select.source].join('\n');
  assert(!/SteamClient|window|document|fetch\(|XMLHttpRequest|require\(|GetClientSetting/.test(pureSource),
    'Extracted grid functions cannot access native services or network');
  const context = vm.createContext({ [symbols[0][1]]: enums });
  const native = vm.runInContext(`(() => { ${pureSource}; return { classify: ${classify.name}, width: ${width.name}, select: ${select.name} }; })()`, context,
    { timeout: 1000 });
  return {
    evidence: { filename, classifierOffset: classify.offset, widthOffset, selectorOffset: select.offset },
    source: { classify: classify.source, width: width.source, selectRow: select.source },
    types,
    classify(item) {
      const type = types[item.type] || item.type;
      return native.classify({ ...item, type });
    },
    span(size) { return native.width(size); },
    selectRow(cards, columns) {
      assert(Number.isInteger(columns) && columns > 0 && columns <= 10, 'Native oracle column count is 1..10');
      const selected = native.select(cards, { vecCards: [{ nItemSpace: columns }] });
      if (!selected) return null;
      // The real renderer splices the shrinking pool after each returned index.
      // Expose original indices so browser checks can compare identity directly.
      const remaining = cards.map((_card, index) => index), result = [];
      for (const index of selected) result.push(remaining.splice(index, 1)[0]);
      return result;
    },
  };
}
