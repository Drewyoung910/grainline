import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("Conversation and Message invariant PostgreSQL proof", () => {
  const proof = fs.readFileSync("scripts/conversation-message-invariant-proof.mjs", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20260722231500_enforce_conversation_message_invariants/migration.sql",
    "utf8",
  );
  const indexMigration = fs.readFileSync(
    "prisma/migrations/20260722232000_add_message_body_trgm_index/migration.sql",
    "utf8",
  );

  it("pins canonical immutable participants and exact opposing Message routes", () => {
    assert.match(migration, /Conversation_canonical_participant_pair_check/);
    assert.match(migration, /CHECK \("userAId" < "userBId"\)/);
    assert.match(migration, /grainline_conversation_participants_immutable/);
    assert.match(migration, /grainline_message_participants_match_conversation/);
    assert.match(migration, /grainline_message_route_immutable/);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, pg_temp/);
    assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    assert.match(proof, /forged Message sender/);
    assert.match(proof, /self Message/);
    assert.match(proof, /Message route rewrite/);
    assert.match(proof, /Conversation participant rewrite/);
    assert.match(proof, /noncanonical Conversation/);
    assert.match(proof, /self Conversation/);
  });

  it("proves monotonic thread time and archive reopening under a real lock wait", () => {
    assert.match(migration, /grainline_message_maintain_thread_state/);
    assert.match(migration, /pg_catalog\.greatest\("updatedAt", NEW\."createdAt"\)/);
    assert.match(migration, /"archivedAAt" = NULL/);
    assert.match(migration, /"archivedBAt" = NULL/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /2026-01-05T00:00:00\.000Z/);
    assert.match(proof, /concurrent_insert_lock_wait_and_monotonic_thread_state/);
  });

  it("keeps proof loopback-only and the body search index concurrent", () => {
    assert.match(proof, /refuses a non-loopback database/);
    assert.match(proof, /requires grainline_ci/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(indexMigration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_body_trgm_idx"/);
    assert.match(indexMigration, /USING GIN \("body" gin_trgm_ops\)/);
  });
});
