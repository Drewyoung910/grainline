#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS,
  ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
  ORDER_ELIGIBILITY_AUTHORITY_MIGRATION_TREE_SHA256,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
  verifyOrderEligibilityAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderParticipantExportAuthorityRelease } from "./verify-order-participant-export-authority-release.mjs";

export const ORDER_ELIGIBILITY_AUTHORITY_PHASE =
  "order-eligibility-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderEligibilityAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderParticipantExportAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
    "Order eligibility authority requires the export-authority predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderEligibilityAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_ELIGIBILITY_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(migrationDirectory, migrationNames);
  assert.equal(
    migrationTreeSha256,
    ORDER_ELIGIBILITY_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order eligibility-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 4);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 4);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 4);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 4);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 4);
  for (const identity of ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /FOR UPDATE OF source_order/u);
  assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
  assert.match(migration, /seller\."userId" = p_actor_user_id/u);
  assert.match(migration, /INTERVAL '30 days'/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_ELIGIBILITY_AUTHORITY_PHASE,
    migration: ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
    functionCount: 4,
    directOrderSourceCount: 35,
    reviewOrderLockPreserved: true,
    rowProjectionExposed: false,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderEligibilityAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order eligibility-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
