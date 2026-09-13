#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
  ORDER_STAFF_READ_AUTHORITY_FUNCTIONS,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION_TREE_SHA256,
  verifyOrderStaffReadAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderParticipantDetailAuthorityRelease } from "./verify-order-participant-detail-authority-release.mjs";

export const ORDER_STAFF_READ_AUTHORITY_PHASE =
  "order-staff-read-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderStaffReadAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderParticipantDetailAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
    "Order staff read authority requires the detail-authority predecessor",
  );
  const { migration, migrationSha256 } = verifyOrderStaffReadAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_STAFF_READ_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(migrationDirectory, migrationNames);
  assert.equal(
    migrationTreeSha256,
    ORDER_STAFF_READ_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order staff read-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\.grainline_order_staff_/gmu), 2);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/g), 2);
  assert.equal(count(migration, /actor\.role::text IN \('EMPLOYEE', 'ADMIN'\)/g), 2);
  for (const identity of ORDER_STAFF_READ_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.equal(count(migration, /^GRANT /gmu), 0);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  assert.match(migration, /FROM PUBLIC, grainline_app_runtime/g);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_STAFF_READ_AUTHORITY_PHASE,
    migration: ORDER_STAFF_READ_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
    dormantFunctionCount: 2,
    runtimeExecuteGranted: false,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(verifyOrderStaffReadAuthorityRelease(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Order staff read-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
