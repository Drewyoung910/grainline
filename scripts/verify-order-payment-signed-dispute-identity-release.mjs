#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
import {
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  verifyOrderPaymentEventInvariantsMigrationBytes,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventReadAuthorityMigrationBytes,
} from "./order-payment-event-read-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventTransitionAuthorityMigrationBytes,
} from "./order-payment-event-transition-authority-catalog.mjs";

export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PHASE =
  "order-payment-signed-dispute-identity-corrected";

export function verifyOrderPaymentSignedDisputeIdentityRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyOrderPaymentSignedRefundIdentityMigrationBytes(
    rootDirectory,
  );
  const { migrationPath, migrationSha256 } =
    verifyOrderPaymentSignedDisputeIdentityMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION);
  const reviewedSuccessors = [];
  const invariantsPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  );
  if (fs.existsSync(invariantsPath)) {
    verifyOrderPaymentEventInvariantsMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION);
  }
  const readAuthorityPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(readAuthorityPath)) {
    assert.deepEqual(
      reviewedSuccessors,
      [ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION],
      "OrderPaymentEvent read authority requires the invariant successor",
    );
    verifyOrderPaymentEventReadAuthorityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION);
  }
  const aggregateAuthorityPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(aggregateAuthorityPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
      "OrderPaymentEvent aggregate authority requires the read-authority successor",
    );
    verifyOrderPaymentEventAggregateAuthorityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION);
  }
  const transitionAuthorityPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(transitionAuthorityPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
      "OrderPaymentEvent transition authority requires the aggregate-authority successor",
    );
    verifyOrderPaymentEventTransitionAuthorityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION);
  }
  assert.deepEqual(
    laterMigrations,
    reviewedSuccessors,
    "signed-dispute identity release has an unreviewed successor",
  );
  assert.equal(
    (migration.match(
      /CREATE OR REPLACE FUNCTION public\.grainline_order_payment_signed_dispute_apply/gu,
    ) ?? []).length,
    1,
    "signed-dispute identity function count drifted",
  );
  assert.match(migration, /p_dispute_id !~ '\^du_\[A-Za-z0-9\]\+\$'/);
  assert.doesNotMatch(migration, /p_dispute_id !~ '\^dp_/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.equal(
    (migration.match(/FROM PUBLIC, grainline_app_runtime;/gu) ?? []).length,
    1,
    "signed-dispute identity runtime revocation count drifted",
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    1,
    "signed-dispute identity runtime grant count drifted",
  );
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/);

  return Object.freeze({
    phase: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PHASE,
    migration: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
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
      verifyOrderPaymentSignedDisputeIdentityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Signed-dispute identity release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
