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
    const userLock = migration.indexOf("ORDER BY account_user.id");
    const targetReread = migration.indexOf("FOR SHARE OF listing, seller");
    assert.notEqual(userLock, -1);
    assert.notEqual(targetReread, -1);
    assert.ok(
      userLock < targetReread,
      "the predecessor guard must lock User before retaining target rows",
    );
    assert.match(
      migration.slice(userLock, targetReread),
      /review\."reviewerAccountActive" = true/,
      "the predecessor guard must re-read reviewer eligibility after the User locks",
    );
    assert.match(migration, /FROM public\."Block" AS relationship/);
    assert.match(
      migration,
      /Removing the actor's own existing vote is always allowed/,
    );
    const toggleStart = migration.indexOf(
      "CREATE FUNCTION public.grainline_review_vote_owner_toggle",
    );
    const toggle = migration.slice(toggleStart);
    assert.ok(
      toggle.indexOf('DELETE FROM public."ReviewVote"')
        < toggle.indexOf('FROM public."Block" AS relationship'),
      "an existing owner vote must be removable before add-only block checks",
    );
    assert.match(migration, /DELETE FROM public\."ReviewVote"/);
    assert.match(migration, /INSERT INTO public\."ReviewVote"/);
    assert.match(migration, /CREATE TRIGGER "ReviewVote_insert_guard"/);
    assert.match(migration, /SET "helpfulCount" = \(\s*SELECT pg_catalog\.count/);
    assert.doesNotMatch(migration, /ReviewVote_count_after_insert/);
    assert.doesNotMatch(migration, /ReviewVote_count_after_delete/);
  });
});
