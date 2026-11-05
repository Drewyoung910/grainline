import { readFileSync } from "node:fs";
import ts from "typescript";

// Runs one real source file with its imports replaced, so a test can call a
// route handler or render a component without Next, Clerk or a database.
// Any import not named in `modules` becomes a stub whose exports are no-ops.
export function loadWithStubs(path, modules = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  const stub = () => undefined;
  new Function("module", "exports", "require", outputText)(loaded, loaded.exports, (name) =>
    modules[name] ?? new Proxy({ __esModule: true }, { get: (target, key) => target[key] ?? stub }));
  return loaded.exports;
}
