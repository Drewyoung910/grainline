#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION_TREE_SHA256,
  verifyOrderParticipantDetailProjectionMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderParticipantCursorAuthorityRelease } from "./verify-order-participant-cursor-authority-release.mjs";

export const ORDER_PARTICIPANT_DETAIL_PROJECTION_PHASE =
  "order-participant-detail-projection-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderParticipantDetailProjectionRelease(root = process.cwd()) {
  const predecessor = verifyOrderParticipantCursorAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
    "Order participant detail projection requires the cursor-authority predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderParticipantDetailProjectionMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(migrationDirectory, migrationNames);
  assert.equal(
    migrationTreeSha256,
    ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION_TREE_SHA256,
    "Order participant detail-projection migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 2);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 4);
  for (const identity of ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS) {
    const functionName = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${functionName}\\(`, "u"));
  }
  assert.match(migration, /actor\.banned = false/gmu);
  assert.match(migration, /seller_user\.banned = false/gmu);
  assert.match(migration, /buyer\.banned = false/gmu);
  assert.match(migration, /detail\.buyer_data_purged_at_epoch_millis IS NULL/gmu);
  assert.match(migration, /detail\.label_status = 'PURCHASED'/gmu);
  assert.match(migration, /'listingLinkAvailable'/gmu);
  assert.match(migration, /source_listing\.status::text IN \('ACTIVE', 'SOLD_OUT'\)/gmu);
  assert.match(migration, /source_listing\."reservedForUserId" = p_actor_user_id/gmu);
  assert.match(migration, /listing_seller\."userId" = p_actor_user_id/gmu);
  assert.match(migration, /listing_seller\."chargesEnabled" = true/gmu);
  assert.match(migration, /listing_seller_user\.banned = false/gmu);
  assert.match(migration, /'processingTimeMaxDays'/gmu);
  assert.doesNotMatch(migration, /'description'|'category'|'tags'|'capturedAt'/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE)\s+(?:INTO|public\.)/iu);

  return Object.freeze({
    phase: ORDER_PARTICIPANT_DETAIL_PROJECTION_PHASE,
    migration: ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
    functionCount: 2,
    convertedOrderSourceCount: 2,
    directOrderSourceCount: 22,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderParticipantDetailProjectionRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order participant detail-projection release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
