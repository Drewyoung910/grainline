#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS,
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
import {
  appendReviewedOrderParticipantListAuthoritySuccessor,
} from "./order-participant-list-authority-catalog.mjs";
import {
  ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
} from "./order-participant-list-projection-correction-catalog.mjs";
import {
  appendReviewedOrderStaffReadChargedTotalCorrection,
} from "./verify-order-staff-read-charged-total-correction.mjs";

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_PHASE =
  "order-payment-event-transition-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderPaymentEventTransitionAuthorityRelease(
  root = process.cwd(),
) {
  const predecessor = verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
  const { migration, migrationSha256 } =
    verifyOrderPaymentEventTransitionAuthorityMigrationBytes(root);
  const laterMigrations = readdirSync(path.join(root, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION);
  const reviewedSuccessors = [];
  if (laterMigrations.includes(ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION)) {
    verifyOrderPaymentEventActivationMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PAYMENT_EVENT_FORCE_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
      "OrderPaymentEvent FORCE requires the activation successor",
    );
    verifyOrderPaymentEventForceMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_FORCE_MIGRATION);
  }
  appendReviewedOrderParticipantListAuthoritySuccessor({
    root,
    laterMigrations,
    reviewedSuccessors,
    expectedPredecessor: ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  });
  const caseCorrectnessSuccessor = verifyOptionalCaseCorrectnessSuccessor(root);
  if (caseCorrectnessSuccessor) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
      "Case correctness requires the participant-list projection correction",
    );
    reviewedSuccessors.push(CASE_CORRECTNESS_MIGRATION);
  }
  appendReviewedOrderStaffReadChargedTotalCorrection({
    root,
    laterMigrations,
    reviewedSuccessors,
    expectedPredecessor: CASE_CORRECTNESS_MIGRATION,
  });
  assert.deepEqual(
    laterMigrations,
    reviewedSuccessors,
    "OrderPaymentEvent transition authority has an unreviewed successor",
  );

  assert.equal(count(migration, /ADD COLUMN "paymentOpenDisputeBlocked"/gu), 1);
  assert.equal(count(migration, /CREATE FUNCTION public\.grainline_order_payment_[A-Za-z0-9_]+\(/gu), 3);
  assert.equal(count(migration, /CREATE TRIGGER grainline_order_payment_[A-Za-z0-9_]+/gu), 2);
  assert.equal(count(migration, /\nVOLATILE\n/gu), 3);
  assert.equal(count(migration, /\nPARALLEL UNSAFE\n/gu), 3);
  assert.equal(count(migration, /\nSECURITY DEFINER\n/gu), 3);
  assert.equal(count(migration, /SET search_path = pg_catalog/gu), 3);
  assert.equal(count(migration, /FROM PUBLIC, grainline_app_runtime;/gu), 3);

  for (const column of ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS) {
    assert.match(migration, new RegExp(`"${column}"`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS) {
    assert.match(migration, new RegExp(`TRIGGER ${name}`, "u"));
  }

  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '120s'/u);
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]*grainline\.order-payment-event\.transition-authority\.preparation/u,
  );
  const orderLock = migration.indexOf(
    'LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;',
  );
  const ledgerLock = migration.indexOf(
    'LOCK TABLE public."OrderPaymentEvent" IN SHARE ROW EXCLUSIVE MODE;',
  );
  const orderAlter = migration.indexOf('ALTER TABLE public."Order"');
  assert.ok(
    orderLock > 0 && ledgerLock > orderLock && orderAlter > ledgerLock,
    "transition-authority migration lost its parent-first DDL lock order",
  );
  assert.match(migration, /pg_catalog\.max\([\s\S]*"stripeEventCreatedSeconds"/u);
  assert.match(migration, /pg_catalog\.count\(DISTINCT pg_catalog\.jsonb_build_array/u);
  assert.match(migration, /'won', 'lost', 'prevented', 'warning_closed'/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF "paymentOpenDisputeBlocked"/u);
  assert.match(migration, /AFTER INSERT ON public\."OrderPaymentEvent"/u);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|nullif|greatest|least|extract)/iu);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/u);
  assert.doesNotMatch(migration, /GRANT EXECUTE/u);

  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_PHASE,
    migration: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
    predecessorMigrationSha256: predecessor.migrationSha256,
    projectionColumnCount: 1,
    functionCount: 3,
    triggerCount: 2,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderPaymentEventTransitionAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent transition-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
