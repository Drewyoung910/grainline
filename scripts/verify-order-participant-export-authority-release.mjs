#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION_TREE_SHA256,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION,
  verifyOrderParticipantExportAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderStaffReadAuthorityRelease } from "./verify-order-staff-read-authority-release.mjs";

export const ORDER_PARTICIPANT_EXPORT_AUTHORITY_PHASE =
  "order-participant-export-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderParticipantExportAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderStaffReadAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_STAFF_READ_AUTHORITY_MIGRATION,
    "Order participant export authority requires the staff-authority predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderParticipantExportAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(migrationDirectory, migrationNames);
  assert.equal(
    migrationTreeSha256,
    ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order participant export-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\.grainline_order_.*_export_page\(/gmu), 2);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /p_limit NOT BETWEEN 1 AND 25/g), 2);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  for (const identity of ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
  assert.match(migration, /seller\."userId" = p_actor_user_id/u);
  assert.doesNotMatch(
    migration,
    /OrderShippingRateQuote|'sellerRefundId'|'stripeChargeId'|'stripeTransferId'|'shipmentId'|'rates'/u,
  );
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_PARTICIPANT_EXPORT_AUTHORITY_PHASE,
    migration: ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_STAFF_READ_AUTHORITY_MIGRATION,
    functionCount: 2,
    pageLimit: 25,
    itemLimit: 100,
    rawShippingQuotesExposed: false,
    providerRefundIdsExposed: false,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderParticipantExportAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order participant export-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
