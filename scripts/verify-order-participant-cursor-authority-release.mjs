#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION_TREE_SHA256,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
  verifyOrderParticipantCursorAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderParticipantSummaryAuthorityRelease } from "./verify-order-participant-summary-authority-release.mjs";

export const ORDER_PARTICIPANT_CURSOR_AUTHORITY_PHASE =
  "order-participant-cursor-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderParticipantCursorAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderParticipantSummaryAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
    "Order participant cursor authority requires the summary-authority predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderParticipantCursorAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(migrationDirectory, migrationNames);
  assert.equal(
    migrationTreeSha256,
    ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order participant cursor-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 2);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  for (const identity of ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${identity.slice(0, identity.indexOf("("))}\\(`, "u"));
  }
  assert.equal(count(migration, /> \(/gu), 2);
  assert.equal(count(migration, /ORDER BY source_order\."createdAt" ASC, source_order\.id ASC/gu), 2);
  assert.equal(count(migration, /ORDER BY newer_page\.created_at_epoch_millis DESC, newer_page\.order_id DESC/gu), 2);
  assert.doesNotMatch(migration.replace(/^--.*$/gmu, ""), /\bOFFSET\b/iu);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE)\s+(?:INTO|public\.)/iu);

  return Object.freeze({
    phase: ORDER_PARTICIPANT_CURSOR_AUTHORITY_PHASE,
    migration: ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
    functionCount: 2,
    convertedOrderSourceCount: 2,
    directOrderSourceCount: 24,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderParticipantCursorAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order participant cursor-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
