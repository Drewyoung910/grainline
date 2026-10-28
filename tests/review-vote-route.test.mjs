import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { privateJson, privateResponse } from "../src/lib/privateResponse.ts";

const routePath = "src/app/api/reviews/[id]/vote/route.ts";

function fixture({
  resultStatus = "OK",
  voted = true,
  helpfulCount = 4,
  signedOut = false,
} = {}) {
  const state = { toggleCalls: [] };
  const dependencies = {
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: signedOut ? null : "clerk-buyer" }),
    },
    "@/lib/ensureUser": {
      ensureUser: async () => ({ id: "buyer" }),
    },
    "@/lib/apiAccountAccess": {
      accountAccessErrorResponse: () => null,
    },
    "@/lib/privateResponse": { privateJson, privateResponse },
    "@/lib/ratelimit": {
      reviewVoteRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/requestOriginGuard": {
      getExplicitCrossOriginPostRejection: () => null,
    },
    "@/lib/reviewVoteAccess": {
      isReviewVoteId: (value) => /^[A-Za-z0-9._:-]{1,191}$/u.test(value),
      toggleOwnerReviewVote: async (userId, reviewId) => {
        state.toggleCalls.push({ userId, reviewId });
        return { resultStatus, voted, helpfulCount };
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(routePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    Request,
    Response,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: routePath });
  return {
    state,
    post: (reviewId = "review-1") => exports.POST(
      new Request("https://example.test/api/reviews/review-1/vote", { method: "POST" }),
      { params: Promise.resolve({ id: reviewId }) },
    ),
  };
}

test("review vote route returns the atomic authority result", async () => {
  const subject = fixture();
  const response = await subject.post();
  assert.equal(response.status, 200);
  assert.deepEqual(subject.state.toggleCalls, [{ userId: "buyer", reviewId: "review-1" }]);
  assert.deepEqual(await response.json(), { ok: true, helpfulCount: 4, voted: true });
});

test("review vote route maps fixed-operation denials without a second database read", async () => {
  for (const [resultStatus, status, error] of [
    ["NOT_FOUND", 404, "Not found"],
    ["SELF", 400, "Cannot vote own review"],
    ["OWN_LISTING", 400, "Cannot vote on your own listing"],
  ]) {
    const subject = fixture({ resultStatus, voted: false, helpfulCount: 2 });
    const response = await subject.post();
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
    assert.equal(subject.state.toggleCalls.length, 1);
  }
});

test("review vote route rejects malformed ids and signed-out callers before mutation", async () => {
  const malformed = fixture();
  assert.equal((await malformed.post("bad/id")).status, 404);
  assert.equal(malformed.state.toggleCalls.length, 0);

  const signedOut = fixture({ signedOut: true });
  assert.equal((await signedOut.post()).status, 401);
  assert.equal(signedOut.state.toggleCalls.length, 0);
});
