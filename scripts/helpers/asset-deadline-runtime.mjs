import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/** Load the production deadline helpers into isolated runtime fixtures. */
export function assetDeadlineRuntime(globals = {}) {
 const result = {};
 for (const name of ['asset-deadline', 'asset-write', 'native-asset-write']) {
  const source = fs.readFileSync(new URL(`../../frontend/features/library/${name}.ts`, import.meta.url), 'utf8');
  const context = vm.createContext({ exports: {}, setTimeout, clearTimeout, Date, ...globals,
   require: () => result });
  vm.runInContext(ts.transpileModule(source, {
   compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  Object.assign(result, context.exports);
 }
 return result;
}
