#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  verifyOrderRefundRecordAuthorityMigrationBytes,
} from "./order-refund-record-authority-catalog.mjs";
import {
  verifyOrderRefundClaimGenerationRelease,
} from "./verify-order-refund-claim-generation-release.mjs";

export const ORDER_REFUND_RECORD_AUTHORITY_PHASE =
  "order-refund-record-authority-prepared";

export function verifyOrderRefundRecordAuthorityRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyOrderRefundClaimGenerationRelease(rootDirectory, {
    allowReviewedRefundRecordSuccessor: true,
  });
  const { migrationPath, migrationSha256 } =
    verifyOrderRefundRecordAuthorityMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_REFUND_RECORD_AUTHORITY_MIGRATION);
  assert.deepEqual(
    laterMigrations,
    [],
    "Order refund record authority release has an unreviewed successor",
  );
  assert.equal(
    (migration.match(/CREATE FUNCTION public\.grainline_/gu) ?? []).length,
    3,
    "Order refund record authority function count drifted",
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.equal(
    (migration.match(/FROM PUBLIC;/gu) ?? []).length,
    3,
    "Order refund record PUBLIC revocation count drifted",
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    3,
    "Order refund record runtime grant count drifted",
  );
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);

  return Object.freeze({
    phase: ORDER_REFUND_RECORD_AUTHORITY_PHASE,
    migration: ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: predecessor.migration,
    runtimeFunctions: 3,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderRefundRecordAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund record authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
