#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  verifyOrderPaymentSignedAuthorityMigrationBytes,
} from "./order-payment-signed-authority-catalog.mjs";
import {
  verifyOrderRefundRecordAuthorityRelease,
} from "./verify-order-refund-record-authority-release.mjs";

export const ORDER_PAYMENT_SIGNED_AUTHORITY_PHASE =
  "order-payment-signed-authority-prepared";

export function verifyOrderPaymentSignedAuthorityRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyOrderRefundRecordAuthorityRelease(rootDirectory, {
    allowReviewedSignedAuthoritySuccessor: true,
  });
  const { migrationPath, migrationSha256 } =
    verifyOrderPaymentSignedAuthorityMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION);
  assert.deepEqual(
    laterMigrations,
    [],
    "Order payment signed authority release has an unreviewed successor",
  );
  assert.equal(
    (migration.match(/CREATE FUNCTION public\.grainline_/gu) ?? []).length,
    2,
    "Order payment signed authority function count drifted",
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.equal(
    (migration.match(/FROM PUBLIC, grainline_app_runtime;/gu) ?? []).length,
    2,
    "Order payment signed authority runtime revocation count drifted",
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    2,
    "Order payment signed authority runtime grant count drifted",
  );
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);

  return Object.freeze({
    phase: ORDER_PAYMENT_SIGNED_AUTHORITY_PHASE,
    migration: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: predecessor.migration,
    runtimeFunctions: 2,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentSignedAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order payment signed authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
