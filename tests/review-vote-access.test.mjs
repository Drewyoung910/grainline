import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const modulePath = "src/lib/reviewVoteAccess.ts";

function loadSubject(rows = []) {
  const state = { contexts: [], findMany: [] };
  const client = {
    reviewVote: {
      findMany: async (args) => {
        state.findMany.push(args);
        return rows;
      },
    },
  };
  const dependencies = {
    "@prisma/client": {
      Prisma: { TransactionIsolationLevel: { ReadCommitted: "ReadCommitted" } },
    },
    "@/lib/dbUserContext": {
      withDbUserContext: async (userId, operation) => {
        state.contexts.push(userId);
        return operation(client);
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(modulePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    Set,
  }, { filename: modulePath });
  return { exports, state };
}

test("owner review-vote state keeps an explicit owner predicate before and after RLS", async () => {
  const subject = loadSubject([{ reviewId: "review-2" }]);
  const result = await subject.exports.ownerReviewVoteIds(
    "buyer-1",
    ["review-1", "review-2", "review-2"],
  );

  assert.deepEqual([...result], ["review-2"]);
  assert.deepEqual(subject.state.contexts, ["buyer-1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(subject.state.findMany)), [{
    where: {
      userId: "buyer-1",
      reviewId: { in: ["review-1", "review-2"] },
    },
    select: { reviewId: true },
  }]);
});

test("empty or malformed review-vote state reads cannot broaden the query", async () => {
  const empty = loadSubject();
  assert.deepEqual(
    [...await empty.exports.ownerReviewVoteIds("buyer-1", [])],
    [],
  );
  assert.deepEqual(empty.state.contexts, []);

  const malformed = loadSubject();
  await assert.rejects(
    malformed.exports.ownerReviewVoteIds("buyer-1", ["bad/review"]),
    (error) => error?.name === "RangeError"
      && error?.message === "Review vote ids are outside the supported range",
  );
  assert.deepEqual(malformed.state.contexts, []);
});
