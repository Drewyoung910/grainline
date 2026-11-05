import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function isTransient() {
  const path = "src/app/api/cart/add/route.ts";
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = null;
  ts.forEachChild(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isTransientPrismaError") found = node.getText(sf);
  });
  assert.ok(found, "isTransientPrismaError is absent");
  const javascript = ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  class PrismaClientKnownRequestError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  class PrismaClientInitializationError extends Error {}
  class PrismaClientRustPanicError extends Error {}
  const Prisma = { PrismaClientKnownRequestError, PrismaClientInitializationError, PrismaClientRustPanicError };
  const check = new Function("Prisma", `${javascript}; return isTransientPrismaError;`)(Prisma);
  return { check, known: (code) => new PrismaClientKnownRequestError(code), Prisma };
}

test("an error that can follow a commit is not retried, so one click cannot add two", () => {
  const { check, known } = isTransient();
  assert.equal(check(known("P1008")), false);
  assert.equal(check(known("P1017")), false);
});

test("errors from before the query ran are still retried", () => {
  const { check, known, Prisma } = isTransient();
  assert.equal(check(known("P2024")), true);
  assert.equal(check(known("P1001")), true);
  assert.equal(check(new Prisma.PrismaClientInitializationError("no connection")), true);
});
