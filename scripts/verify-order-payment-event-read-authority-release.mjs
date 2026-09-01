#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  verifyOrderPaymentEventInvariantsMigrationBytes,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
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
import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  verifyOrderPaymentEventForceMigrationBytes,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  CASE_CORRECTNESS_MIGRATION,
  verifyOptionalCaseCorrectnessSuccessor,
} from "./build-case-correctness-migration.mjs";

export const ORDER_PAYMENT_EVENT_READ_AUTHORITY_PHASE =
  "order-payment-event-read-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderPaymentEventReadAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderPaymentEventInvariantsMigrationBytes(root);
  const { migration, migrationSha256 } =
    verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
  const migrationNames = readdirSync(path.join(root, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION);
  const reviewedSuccessors = [ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION];
  if (existsSync(path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  ))) {
    verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION);
  }
  if (existsSync(path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  ))) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
      "OrderPaymentEvent transition authority requires the aggregate-authority successor",
    );
    verifyOrderPaymentEventTransitionAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION);
  }
  if (existsSync(path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ))) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
      "OrderPaymentEvent activation requires the transition-authority successor",
    );
    verifyOrderPaymentEventActivationMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION);
  }
  const forcePath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  );
  if (existsSync(forcePath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
      "OrderPaymentEvent FORCE requires the activation successor",
    );
    verifyOrderPaymentEventForceMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_FORCE_MIGRATION);
  }
  const caseCorrectnessSuccessor = verifyOptionalCaseCorrectnessSuccessor(root);
  if (caseCorrectnessSuccessor) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
      "Case correctness requires the OrderPaymentEvent FORCE successor",
    );
    reviewedSuccessors.push(CASE_CORRECTNESS_MIGRATION);
  }
  assert.deepEqual(
    migrationNames,
    reviewedSuccessors,
    "OrderPaymentEvent read authority has an unreviewed successor or missing predecessor order",
  );

  assert.equal(count(migration, /CREATE FUNCTION public\.grainline_order_payment_[A-Za-z0-9_]+\(/gu), 5);
  assert.equal(count(migration, /\nSECURITY DEFINER\n/gu), 5);
  assert.equal(count(migration, /\nSTABLE\n/gu), 5);
  assert.equal(count(migration, /\nPARALLEL SAFE\n/gu), 5);
  assert.equal(count(migration, /SET search_path = pg_catalog/gu), 5);
  assert.equal(count(migration, /REVOKE ALL ON FUNCTION public\.grainline_order_payment_[^;]+ FROM PUBLIC;/gu), 5);
  assert.equal(count(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_order_payment_[^;]+ TO grainline_app_runtime;/gu), 5);
  for (const identity of ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS) {
    const [name] = identity.split("(");
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /payment\."eventType" = 'REFUND'/u);
  assert.match(migration, /actor\.role::text IN \('EMPLOYEE', 'ADMIN'\)/u);
  assert.match(migration, /LIMIT p_limit/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/u);
  assert.doesNotMatch(migration, /CREATE POLICY/u);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_READ_AUTHORITY_PHASE,
    migration: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
    predecessorMigrationSha256: predecessor.migrationSha256,
    runtimeFunctionCount: 5,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentEventReadAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent read-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
