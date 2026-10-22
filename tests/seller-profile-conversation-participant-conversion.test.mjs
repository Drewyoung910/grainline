import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020000000_prepare_seller_profile_conversation_participant_cards/migration.sql";
const correctionPath =
  "prisma/migrations/20261020030000_correct_seller_profile_conversation_participant_cards/migration.sql";
const inbox = readFileSync("src/app/messages/page.tsx", "utf8");
const thread = readFileSync("src/app/messages/[id]/page.tsx", "utf8");

test("message pages use the bounded conversation participant seller authority", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(correctionPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const correction = readFileSync(correctionPath, "utf8");
  const helper = readFileSync("src/lib/sellerProfileParticipantAccess.ts", "utf8");

  assert.match(migration, /grainline_seller_actor_conversation_cards\(text\[\]\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /public\."Conversation"/u);
  for (const field of ["id", '"userId"', '"displayName"', '"avatarImageUrl"']) {
    assert.match(correction, new RegExp(`seller\\.${field}::text`, "u"));
  }
  assert.match(correction, /SQLSTATE 42804/u);
  assert.match(helper, /export function sellerConversationParticipantCards/u);
  assert.match(inbox, /sellerConversationParticipantCards\(me\.id, otherUserIds\)/u);
  assert.match(thread, /sellerConversationParticipantCards\(me\.id, \[other\.id\]\)/u);
  assert.doesNotMatch(inbox, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(thread, /prisma\.sellerProfile\./u);
});
