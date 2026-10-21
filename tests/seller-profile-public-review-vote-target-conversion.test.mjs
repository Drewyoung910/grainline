import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");

test("review voting resolves its exact visible target through actor-bound authority", () => {
  assert.doesNotMatch(route, /prisma\.review\.findUnique\(\{[\s\S]*?listing:[\s\S]*?seller:/u);
  assert.doesNotMatch(route, /canViewListingDetail/u);
  assert.match(route, /sellerPublicReviewVoteTarget\(me\.id, id\)/u);
  assert.match(route, /review\.reviewerId === me\.id/u);
  assert.match(route, /review\.sellerUserId === me\.id/u);
});
