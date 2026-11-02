import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const [migration, helper] = await Promise.all([
  readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
  readFile(new URL("src/lib/listingAiReviewTransition.ts", root), "utf8"),
]);

test("a stale AI approval cannot activate content from a newer resubmission", () => {
  assert.match(migration, /source_listing\.status::text <> p_source_status/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_reviewed_at/u);
  assert.match(migration, /RETURN QUERY SELECT false;[\s\S]*UPDATE public\."Listing"/u);
});

test("the AI transition is actor-bound and updates one locked listing", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\."sellerId" = seller_id[\s\S]*FOR UPDATE/u);
  assert.match(migration, /NOT source_listing\."sellerPubliclyOrderable"/u);
  assert.match(migration, /ELSE p_status::public\."ListingStatus"/u);
  assert.match(helper, /withDbUserContext\(userId,/u);
  assert.doesNotMatch(helper, /listing\.updateMany/u);
});

test("review results fail closed on malformed status, flags, score, or result cardinality", () => {
  assert.match(helper, /REVIEW_TARGET_STATUSES\.has\(input\.status\)/u);
  assert.match(helper, /validReviewTransition\(input\.sourceStatus, input\.status\)/u);
  assert.match(helper, /input\.flags\.length > 20/u);
  assert.match(helper, /isTextWithinCodePointRange\(flag, 0, 80\)/u);
  assert.match(helper, /!Number\.isFinite\(input\.score\)/u);
  assert.match(helper, /rows\.length !== 1 \|\| typeof rows\[0\]\?\.applied !== "boolean"/u);
});
