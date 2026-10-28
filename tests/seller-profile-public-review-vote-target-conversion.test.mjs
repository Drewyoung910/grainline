import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");
const migration = readFileSync(
  process.env.REVIEW_VOTE_PREPARATION_MIGRATION_PATH
    ?? "prisma/migrations/20261028030000_prepare_review_vote_authorities/migration.sql",
  "utf8",
);

test("review voting resolves and mutates its exact visible target atomically", () => {
  assert.doesNotMatch(route, /prisma\.review\.findUnique\(\{[\s\S]*?listing:[\s\S]*?seller:/u);
  assert.doesNotMatch(route, /canViewListingDetail/u);
  assert.match(route, /toggleOwnerReviewVote\(me\.id, id\)/u);
  assert.doesNotMatch(route, /sellerPublicReviewVoteTarget/u);
  assert.match(migration, /request_user_id text := NULLIF\(/u);
  assert.match(migration, /review\."reviewerAccountActive" = true/u);
  assert.match(migration, /relationship\."blockedId" IN/u);
  assert.doesNotMatch(migration, /pg_catalog\.nullif/u);
});
