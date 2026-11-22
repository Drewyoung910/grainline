import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/sellerRatingSummary.ts";

function load({ sellers = ["seller_1", "seller_2"], failLookup = false } = {}) {
  const state = { refreshed: 0, captured: [] };
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => { state.refreshed += 1; return [{ averageRating: 5, reviewCount: 1 }]; },
  };
  const prisma = {
    ...tx,
    $queryRaw: async () => {
      if (failLookup) throw new Error("database down");
      return sellers.map((sellerProfileId) => ({ sellerProfileId }));
    },
    $transaction: (callback) => callback(tx),
  };
  const dependencies = {
    "@/lib/db": { prisma },
    "@prisma/client": {},
    "@sentry/nextjs": { captureException: (error) => state.captured.push(error) },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, { exports, require: (name) => dependencies[name], Number, Map, Set, Array }, { filename: path });
  return { ...exports, state };
}

test("banning or deleting a reviewer refreshes every seller they reviewed", async () => {
  const subject = load();
  await subject.refreshRatingSummariesForReviewer("reviewer");
  assert.equal(subject.state.refreshed, 2);
});

test("a failed refresh is reported and never fails the ban", async () => {
  const subject = load({ failLookup: true });
  await subject.refreshRatingSummariesForReviewer("reviewer");
  assert.equal(subject.state.refreshed, 0);
  assert.equal(subject.state.captured.length, 1);
});
