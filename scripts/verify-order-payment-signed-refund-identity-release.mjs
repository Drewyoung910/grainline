#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";

export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PHASE =
  "order-payment-signed-refund-identity-prepared";

export function verifyOrderPaymentSignedRefundIdentityRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyBlockedCheckoutTransferBindingMigrationBytes(
    rootDirectory,
  );
  const { migrationPath, migrationSha256 } =
    verifyOrderPaymentSignedRefundIdentityMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION);
  assert.deepEqual(
    laterMigrations,
    [],
    "signed-refund identity release has an unreviewed successor",
  );
  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION public\.grainline_/gu) ?? []).length,
    1,
    "signed-refund identity function count drifted",
  );
  assert.match(migration, /local_refund_evidence_count = 1/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.equal(
    (migration.match(/FROM PUBLIC, grainline_app_runtime;/gu) ?? []).length,
    1,
    "signed-refund identity runtime revocation count drifted",
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    1,
    "signed-refund identity runtime grant count drifted",
  );
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);

  return Object.freeze({
    phase: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PHASE,
    migration: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    migrationSha256,
    predecessorMigrationSha256: predecessor.migrationSha256,
    runtimeFunctionsReplaced: 1,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentSignedRefundIdentityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Signed-refund identity release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

