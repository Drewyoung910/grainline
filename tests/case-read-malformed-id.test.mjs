import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load() {
  const path = "src/lib/caseReadAuthority.ts";
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    "@/lib/db": { prisma: {} },
    "@/lib/dbUserContextState": { normalizeDbUserContextUserId: (id) => id },
    "@/lib/caseReadResult": {
      validateCaseReadRow: (row) => row,
      validateCaseStaffActiveCount: (count) => count,
    },
  };
  const exports = {};
  vm.runInNewContext(javascript, { exports, require: (name) => dependencies[name] }, { filename: path });
  return exports;
}

const failIfQueried = {
  $queryRaw: async () => {
    throw new Error("a malformed id must not reach the database");
  },
};

test("a malformed Case id finds nothing, so the page answers 404 instead of 500", async () => {
  const { getVisibleCaseById, getVisibleCaseByOrderId } = load();
  for (const id of ["../etc/passwd", "has space", "x".repeat(192), ""]) {
    assert.equal(await getVisibleCaseById({ actorUserId: "actor", caseId: id }, failIfQueried), null);
    assert.equal(await getVisibleCaseByOrderId({ actorUserId: "actor", orderId: id }, failIfQueried), null);
  }
});

test("an ordinary Case id still reaches the database", async () => {
  const { getVisibleCaseById } = load();
  const row = { id: "case_1" };
  const found = await getVisibleCaseById(
    { actorUserId: "actor", caseId: "case_1" },
    { $queryRaw: async () => [row] },
  );
  assert.equal(found, row);
});
