#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS,
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventReadAuthorityMigrationBytes,
} from "./order-payment-event-read-authority-catalog.mjs";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_PHASE =
  "order-payment-event-aggregate-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderPaymentEventAggregateAuthorityRelease(
  root = process.cwd(),
) {
  const predecessor = verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
  const { migration, migrationSha256 } =
    verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
  const laterMigrations = readdirSync(path.join(root, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION);
  assert.deepEqual(
    laterMigrations,
    [],
    "OrderPaymentEvent aggregate authority has an unreviewed successor",
  );

  assert.equal(count(migration, /ADD COLUMN "payment[A-Za-z]+Blocked"/gu), 2);
  assert.equal(count(migration, /CREATE FUNCTION public\.grainline_order_payment_[A-Za-z0-9_]+\(/gu), 3);
  assert.equal(count(migration, /CREATE TRIGGER grainline_order_payment_[A-Za-z0-9_]+/gu), 2);
  assert.equal(count(migration, /\nVOLATILE\n/gu), 3);
  assert.equal(count(migration, /\nPARALLEL UNSAFE\n/gu), 3);
  assert.equal(count(migration, /\nSECURITY DEFINER\n/gu), 3);
  assert.equal(count(migration, /SET search_path = pg_catalog/gu), 3);
  assert.equal(count(migration, /FROM PUBLIC, grainline_app_runtime;/gu), 3);

  for (const column of ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS) {
    assert.match(migration, new RegExp(`"${column}"`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  for (const name of ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS) {
    assert.match(migration, new RegExp(`TRIGGER ${name}`, "u"));
  }
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '120s'/u);
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]*grainline\.order-payment-event\.aggregate-authority\.preparation/u,
  );
  const ledgerLock = migration.indexOf(
    'LOCK TABLE public."OrderPaymentEvent" IN SHARE ROW EXCLUSIVE MODE;',
  );
  const orderAlter = migration.indexOf('ALTER TABLE public."Order"');
  assert.ok(ledgerLock > 0 && orderAlter > ledgerLock);
  assert.match(migration, /max\([\s\S]*"stripeEventCreatedSeconds"/u);
  assert.match(migration, /count\(DISTINCT pg_catalog\.jsonb_build_array/u);
  assert.match(migration, /'failed', 'canceled', 'cancelled'/u);
  assert.match(migration, /'won', 'warning_closed'/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF/u);
  assert.match(migration, /AFTER INSERT ON public\."OrderPaymentEvent"/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/u);
  assert.doesNotMatch(migration, /GRANT EXECUTE/u);

  return Object.freeze({
    phase: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_PHASE,
    migration: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
    predecessorMigrationSha256: predecessor.migrationSha256,
    projectionColumnCount: 2,
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
      verifyOrderPaymentEventAggregateAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent aggregate-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
