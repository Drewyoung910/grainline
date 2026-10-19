import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020000000_prepare_seller_profile_conversation_participant_cards/migration.sql";
const inbox = readFileSync("src/app/messages/page.tsx", "utf8");
const thread = readFileSync("src/app/messages/[id]/page.tsx", "utf8");

test("message pages use the bounded conversation participant seller authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync("src/lib/sellerProfileParticipantAccess.ts", "utf8");

  assert.match(migration, /grainline_seller_actor_conversation_cards\(text\[\]\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /public\."Conversation"/u);
  assert.match(helper, /export function sellerConversationParticipantCards/u);
  assert.match(inbox, /sellerConversationParticipantCards\(me\.id, otherUserIds\)/u);
  assert.match(thread, /sellerConversationParticipantCards\(me\.id, \[other\.id\]\)/u);
  assert.doesNotMatch(inbox, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(thread, /prisma\.sellerProfile\./u);
});
