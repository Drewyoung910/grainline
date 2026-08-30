#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS,
  ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
  ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS,
  verifyOrderPaymentEventInvariantsMigrationBytes,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
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
import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  verifyOrderPaymentEventActivationMigrationBytes,
} from "./order-payment-event-activation-identity.mjs";

export const ORDER_PAYMENT_EVENT_INVARIANTS_PHASE =
  "order-payment-event-invariants-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderPaymentEventInvariantsRelease(
  root = process.cwd(),
) {
  const predecessor = verifyOrderPaymentSignedDisputeIdentityMigrationBytes(root);
  const { migration, migrationSha256 } =
    verifyOrderPaymentEventInvariantsMigrationBytes(root);
  const laterMigrations = readdirSync(
    path.join(root, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION);
  const reviewedSuccessors = [];
  const readAuthorityPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  );
  if (existsSync(readAuthorityPath)) {
    verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION);
  }
  const aggregateAuthorityPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  );
  if (existsSync(aggregateAuthorityPath)) {
    verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION);
  }
  const transitionAuthorityPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  );
  if (existsSync(transitionAuthorityPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
      "OrderPaymentEvent transition authority requires the aggregate-authority successor",
    );
    verifyOrderPaymentEventTransitionAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION);
  }
  const activationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  );
  if (existsSync(activationPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
      "OrderPaymentEvent activation requires the transition-authority successor",
    );
    verifyOrderPaymentEventActivationMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION);
  }
  assert.deepEqual(
    laterMigrations,
    reviewedSuccessors,
    "OrderPaymentEvent invariant release has an unreviewed successor",
  );
  assert.equal(count(migration, /ADD CONSTRAINT "OrderPaymentEvent_[^"]+_check"/gu), 6);
  assert.equal(count(migration, /CREATE FUNCTION public\.grainline_[A-Za-z0-9_]+\(\)/gu), 3);
  assert.equal(count(migration, /CREATE TRIGGER grainline_[A-Za-z0-9_]+/gu), 3);
  assert.equal(count(migration, /\nVOLATILE\n/gu), 3);
  assert.equal(count(migration, /\nSECURITY DEFINER\n/gu), 2);
  assert.equal(count(migration, /FROM PUBLIC, grainline_app_runtime;/gu), 3);
  for (const name of ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS) {
    assert.match(migration, new RegExp(`"${name}"`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(\\)`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS) {
    assert.match(migration, new RegExp(`TRIGGER ${name}`, "u"));
  }
  assert.match(migration, /FOR UPDATE;/u);
  assert.match(migration, /metadata->'refundIds'[\s\S]*jsonb_build_array\("stripeObjectId"\)/u);
  assert.match(migration, /metadata->>'latestRefundId' = "stripeObjectId"/u);
  assert.match(migration, /\)\) IS TRUE/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/u);
  assert.doesNotMatch(migration, /GRANT EXECUTE/u);

  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_INVARIANTS_PHASE,
    migration: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
    migrationSha256,
    predecessorMigrationSha256: predecessor.migrationSha256,
    validatedConstraintCount: 6,
    triggerCount: 3,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentEventInvariantsRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent invariant release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
