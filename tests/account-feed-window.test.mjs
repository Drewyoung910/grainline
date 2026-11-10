import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/app/api/account/feed/route.ts";
const DAY = 24 * 60 * 60 * 1000;

function fixture() {
  const state = { wheres: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const capture = async ({ where }) => {
    state.wheres.push(where);
    return [];
  };
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": {
      prisma: {
        listing: { findMany: capture },
        blogPost: { findMany: capture },
        sellerBroadcast: { findMany: capture },
      },
    },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me" }) },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/queryParams": { parseBoundedPositiveIntParam: () => 20 },
    "@/lib/accountFeedCursor": {
      parseAccountFeedCursor: (value) => (value ? { date: new Date(value), id: "x", kind: "listing", legacy: false } : null),
      accountFeedCursorTieMode: () => "all",
    },
    "@/lib/savedBlogPostOwnerAccess": { ownerSavedBlogPostIdRows: async () => [] },
    "@/lib/favoriteAccess": { ownerFavoriteListingIds: async () => [] },
    "@/lib/blocks": { getBlockedSellerProfileIdsFor: async () => [] },
    "@/lib/sellerFollowAccess": { ownerFollowedSellerIds: async () => ["seller"] },
    "@/lib/sellerProfileParticipantAccess": {
      sellerActorAccountFeedCards: async () => [{ id: "seller", displayName: "Shop", guildLevel: "NONE" }],
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, URL, Date, Set, Map, Promise, Math, Number, Object,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, exports };
}

test("scrolling stops at the 90 days the Terms promise", async () => {
  const subject = fixture();
  const cursor = new Date(Date.now() - 200 * DAY).toISOString();
  await subject.exports.GET(new Request(`https://example.test/api/account/feed?cursor=${encodeURIComponent(cursor)}`));
  assert.equal(subject.state.wheres.length, 3);
  for (const where of subject.state.wheres) {
    const cutoffs = where.AND.flatMap((clause) => Object.values(clause))
      .filter((value) => value?.gte instanceof Date || (value?.gte && typeof value.gte.getTime === "function"));
    assert.equal(cutoffs.length, 1);
    const age = Date.now() - cutoffs[0].gte.getTime();
    assert.ok(Math.abs(age - 90 * DAY) < 60_000);
  }
});
