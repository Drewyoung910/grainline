import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/messages/new/page.tsx", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235995_prepare_seller_profile_participant_conversation_listing_target/migration.sql",
  "utf8",
);

test("new-message listing context uses actor-bound participant authority", () => {
  assert.doesNotMatch(page, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(page, /canAttachConversationContextListing/u);
  assert.match(
    page,
    /sellerParticipantConversationListingTarget\(\s*me\.id,\s*other\.id,\s*listing,?\s*\)/u,
  );
  assert.match(page, /validListingId = contextListing\.id/u);
  assert.match(page, /listingTitle = contextListing\.title/u);
  assert.match(migration, /actor_id text := NULLIF\(/u);
  assert.doesNotMatch(migration, /pg_catalog\.nullif/u);
});
