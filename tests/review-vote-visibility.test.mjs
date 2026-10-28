import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");
const migration = readFileSync(
  process.env.REVIEW_VOTE_PREPARATION_MIGRATION_PATH
    ?? "prisma/migrations/20261028030000_prepare_review_vote_authorities/migration.sql",
  "utf8",
);

describe("review vote visibility guardrails", () => {
  it("uses the actor-bound atomic toggle before accepting helpful votes", () => {
    assert.match(
      source,
      /import \{ isReviewVoteId, toggleOwnerReviewVote \} from "@\/lib\/reviewVoteAccess";/,
      "review helpful votes must use the atomic database authority",
    );
    assert.match(
      source,
      /toggleOwnerReviewVote\(me\.id, id\)/,
      "target eligibility and mutation must share one database transaction",
    );
    assert.match(source, /updated\.resultStatus === "NOT_FOUND"/);
    assert.match(source, /updated\.resultStatus === "SELF"/);
    assert.match(source, /updated\.resultStatus === "OWN_LISTING"/);
    assert.doesNotMatch(source, /canViewListingDetail/);
    assert.doesNotMatch(source, /listing:\s*\{\s*select:/);
    assert.doesNotMatch(source, /prisma\./);
  });

  it("serializes visibility and keeps predecessor count maintenance compatible", () => {
    assert.match(migration, /ORDER BY account_user\.id\s+FOR UPDATE/);
    assert.match(migration, /FOR SHARE OF listing, seller/);
    assert.match(migration, /FROM public\."Block" AS relationship/);
    assert.match(migration, /DELETE FROM public\."ReviewVote"/);
    assert.match(migration, /INSERT INTO public\."ReviewVote"/);
    assert.match(migration, /CREATE TRIGGER "ReviewVote_insert_guard"/);
    assert.match(migration, /SET "helpfulCount" = \(\s*SELECT pg_catalog\.count/);
    assert.doesNotMatch(migration, /ReviewVote_count_after_insert/);
    assert.doesNotMatch(migration, /ReviewVote_count_after_delete/);
  });
});
