import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = "src/app/api/reviews/route.ts";

// Actual route with isolated ports. A role that passes the new check goes on to
// the next port, which is where this fixture stops it.
function post(role) {
  const reached = { listingLookup: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }), reviewRatelimit: {} },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/urlValidation": { isFirstPartyMediaUrl: () => true },
    "@/lib/profanity": { containsProfanity: () => ({ flagged: false }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "account", role }) },
    "@/lib/sellerProfilePublicAccess": {
      sellerActorReviewListingTarget: async () => {
        reached.listingLookup += 1;
        return { seller: { userId: "account", ownerAccountActive: true } };
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, Date,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return exports.POST(new Request("https://example.test/api/reviews", {
    method: "POST",
    body: JSON.stringify({ listingId: "listing", ratingX2: 10, comment: "Great" }),
  })).then(async (response) => ({ status: response.status, body: await response.json(), reached }));
}

test("staff and admin accounts cannot leave a review", async () => {
  for (const role of ["EMPLOYEE", "ADMIN"]) {
    const result = await post(role);
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "Staff accounts cannot leave reviews.");
    assert.equal(result.reached.listingLookup, 0);
  }
});

test("an ordinary account still reaches the listing check", async () => {
  const result = await post("USER");
  assert.equal(result.reached.listingLookup, 1);
  assert.equal(result.body.error, "Cannot review your own listing");
});
