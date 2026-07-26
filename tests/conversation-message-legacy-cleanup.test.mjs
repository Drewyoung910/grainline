import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migration = fs.readFileSync(
  "prisma/migrations/20260726013500_repair_legacy_custom_order_link_context/migration.sql",
  "utf8",
);
const proof = fs.readFileSync(
  "scripts/conversation-message-legacy-cleanup-proof.mjs",
  "utf8",
);

describe("Conversation and Message legacy custom-link cleanup", () => {
  it("updates only one fully source-bound missing custom-order link", () => {
    assert.match(migration, /missing_count > 1/);
    assert.match(migration, /repairable_count <> missing_count/);
    assert.match(migration, /message\.kind = 'custom_order_link'/);
    assert.match(migration, /message\."contextListingId" IS NULL/);
    assert.match(migration, /pg_catalog\.pg_input_is_valid\(message\.body::text, 'jsonb'\)/);
    assert.match(migration, /listing\."isPrivate" = true/);
    assert.match(
      migration,
      /listing\."customOrderConversationId" = message\."conversationId"/,
    );
    assert.match(
      migration,
      /listing\."reservedForUserId" = message\."recipientId"/,
    );
    assert.match(migration, /seller\."userId" = message\."senderId"/);
    assert.match(migration, /SET "contextListingId" = repairable\.listing_id/);
    assert.doesNotMatch(migration, /\bDELETE\b|SET\s+body\s*=/i);
    assert.doesNotMatch(
      migration,
      /\b(?:ALTER TABLE|CREATE POLICY|DROP POLICY|GRANT|REVOKE)\b/i,
    );
    assert.equal(
      migration.match(/\bUPDATE\s+public\."Message"\s+AS\s+message\b/g)?.length,
      1,
      "cleanup must contain exactly one narrowly validated Message update",
    );
  });

  it("serializes source and target writes and proves zero residue conditions", () => {
    assert.match(
      migration,
      /LOCK TABLE[\s\S]*public\."Listing"[\s\S]*public\."SellerProfile"[\s\S]*public\."Conversation"[\s\S]*public\."Message"[\s\S]*IN SHARE ROW EXCLUSIVE MODE/,
    );
    assert.match(migration, /SET LOCAL lock_timeout = '10s'/);
    assert.match(migration, /GET DIAGNOSTICS updated_count = ROW_COUNT/);
    assert.match(migration, /remaining_missing_count <> 0/);
    assert.match(migration, /remaining_invalid_count <> 0/);
    assert.match(migration, /duplicate_source_group_count <> 0/);
    assert.match(migration, /USING ERRCODE = 'P0001'/);
  });

  it("executes the exact migration for success and both fail-closed shapes", () => {
    assert.match(proof, /readFileSync\([\s\S]*20260726013500_repair_legacy_custom_order_link_context/);
    assert.match(proof, /refuses a non-loopback database/);
    assert.match(proof, /requires grainline_ci/);
    assert.match(proof, /repairableCustomLinkMissingContextCount, 1/);
    assert.match(proof, /unrepairableCustomLinkMissingContextCount, 1/);
    assert.match(proof, /repairableCustomLinkMissingContextCount, 2/);
    assert.match(proof, /migrationBytesExecuted: true/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });
});
