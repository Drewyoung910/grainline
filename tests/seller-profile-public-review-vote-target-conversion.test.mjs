import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235990_prepare_seller_profile_public_review_vote_target/migration.sql",
  "utf8",
);

test("review voting resolves its exact visible target through actor-bound authority", () => {
  assert.doesNotMatch(route, /prisma\.review\.findUnique\(\{[\s\S]*?listing:[\s\S]*?seller:/u);
  assert.doesNotMatch(route, /canViewListingDetail/u);
  assert.match(route, /sellerPublicReviewVoteTarget\(me\.id, id\)/u);
  assert.match(route, /review\.reviewerId === me\.id/u);
  assert.match(route, /review\.sellerUserId === me\.id/u);
  assert.match(migration, /actor_id text := NULLIF\(/u);
  assert.doesNotMatch(migration, /pg_catalog\.nullif/u);
});
