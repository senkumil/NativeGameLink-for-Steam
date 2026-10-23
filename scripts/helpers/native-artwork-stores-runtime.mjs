import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function nativeArtworkStoresRuntime(steamWebpackRuntime, globals = {}) {
  const context = vm.createContext({ exports: {}, ...globals, require(name) {
    if (name !== '../../steam/modules/SteamWebpackRuntime') throw Error('Unexpected native artwork store dependency ' + name);
    return { steamWebpackRuntime };
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/native-artwork-stores.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
