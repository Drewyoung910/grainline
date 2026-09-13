#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION_TREE_SHA256,
  ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
  verifyOrderParticipantSummaryAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderSellerMetricsAuthorityRelease } from "./verify-order-seller-metrics-authority-release.mjs";

export const ORDER_PARTICIPANT_SUMMARY_AUTHORITY_PHASE =
  "order-participant-summary-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderParticipantSummaryAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderSellerMetricsAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
    "Order participant summary authority requires the seller-metrics predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderParticipantSummaryAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  assert.equal(
    migrationTreeSha256,
    ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order participant summary-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 3);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 3);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 3);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 3);
  for (const identity of ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /LIMIT 5/u);
  assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
  assert.match(migration, /seller\."userId" = p_actor_user_id/u);
  assert.match(migration, /source_order\."sellerProfileId"/u);
  assert.doesNotMatch(migration, /JOIN public\."Listing"/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE)\s+(?:INTO|public\.)/iu);

  return Object.freeze({
    phase: ORDER_PARTICIPANT_SUMMARY_AUTHORITY_PHASE,
    migration: ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
    functionCount: 3,
    runtimeFunctionCount: 2,
    privateFunctionCount: 1,
    summaryItemLimit: 5,
    convertedOrderSourceCount: 2,
    directOrderSourceCount: 26,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderParticipantSummaryAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order participant summary-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
