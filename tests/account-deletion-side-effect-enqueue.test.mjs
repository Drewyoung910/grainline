import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/accountDeletionSideEffects.ts";

test("a new deletion step is due at once, whatever this server's clock says", async () => {
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require: () => stub(),
  }, { filename: path });

  const created = [];
  await exports.enqueueAccountDeletionLocalAnonymizeSideEffect({
    accountDeletionSideEffect: {
      create: async ({ data }) => created.push(data),
      findUnique: async () => ({ id: "effect" }),
    },
  }, "user");

  assert.equal(created.length, 1);
  assert.equal(created[0].nextAttemptAt, null);
});
