import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/messages/[id]/page.tsx", "utf8");
const access = readFileSync("src/lib/sellerProfilePublicAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235996_prepare_seller_profile_conversation_context_listing/migration.sql",
  "utf8",
);

test("message thread reads its retained listing card through conversation authority", () => {
  assert.match(
    page,
    /sellerActorConversationContextListing\(me\.id, conversation\.id\)/u,
  );
  assert.doesNotMatch(page, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(page, /canViewListingDetail/u);
  assert.match(access, /withDbUserContext\(actorUserId/u);
  assert.match(migration, /grainline_conversation_staff_report_visible\(conversation\.id\)/u);
  assert.match(migration, /listing\."archivedAt" IS NULL/u);
  assert.match(migration, /listing\.status::text IN \('ACTIVE', 'SOLD_OUT'\)/u);
  assert.match(migration, /listing\.status::text IN \('ACTIVE', 'SOLD'\)/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/u);
});
