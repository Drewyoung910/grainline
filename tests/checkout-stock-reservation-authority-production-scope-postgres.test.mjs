import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
  assertReservationAuthorityProductionScope,
} from "../scripts/verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";

const CHECKSUMS = Object.freeze({
  [LISTING_VARIANTS_REVIEWED_MIGRATION]: "1".repeat(64),
  [SCHEMA_NUMERIC_GUARDS_MIGRATION]: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName]:
    DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  [STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION]: "2".repeat(64),
  [CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION]: "3".repeat(64),
});
const CATALOG = Object.entries(CHECKSUMS).map(([migration_name, checksum]) => ({
  migration_name,
  checksum,
}));

async function createLedger() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public._prisma_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      finished_at timestamptz,
      migration_name text NOT NULL,
      rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_steps_count integer NOT NULL DEFAULT 0
    )
  `);
  return database;
}

async function insertRow(database, {
  id,
  migrationName,
  checksum,
  finished = true,
  rolledBack = false,
  steps = 1,
}) {
  await database.query(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, rolled_back_at,
      applied_steps_count
    ) VALUES ($1, $2, CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
              $4, CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE NULL END, $6)
  `, [id, checksum, finished, migrationName, rolledBack, steps]);
}

async function readRows(database) {
  return (await database.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     ORDER BY migration_name, started_at, id
  `)).rows;
}

async function seedReviewedPredecessor(database, schemaNumericChecksum) {
  await insertRow(database, {
    id: "listing-current",
    migrationName: LISTING_VARIANTS_REVIEWED_MIGRATION,
    checksum: CHECKSUMS[LISTING_VARIANTS_REVIEWED_MIGRATION],
  });
  await insertRow(database, {
    id: "listing-alias",
    migrationName: LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    checksum: CHECKSUMS[LISTING_VARIANTS_REVIEWED_MIGRATION],
    finished: false,
    rolledBack: true,
    steps: 0,
  });
  await insertRow(database, {
    id: "numeric-original",
    migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
    checksum: schemaNumericChecksum,
  });
  await insertRow(database, {
    id: "direct-current",
    migrationName: DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    checksum: DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  });
  await insertRow(database, {
    id: "direct-failed",
    migrationName: DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    checksum: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
    finished: false,
    rolledBack: true,
    steps: 0,
  });
  await insertRow(database, {
    id: "stripe-force",
    migrationName: STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
    checksum: CHECKSUMS[STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION],
  });
}

test("disposable PostgreSQL accepts only the proved historical numeric-guard checksum", async () => {
  const database = await createLedger();
  try {
    await seedReviewedPredecessor(
      database,
      SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
    );
    assert.deepEqual(
      assertReservationAuthorityProductionScope(
        await readRows(database),
        "before",
        CATALOG,
      ),
      {
        stripeForceApplied: true,
        reservationAuthorityApplied: false,
        reservationActivationRows: 0,
        reservationForceRows: 0,
        reviewedMigrationCount: 5,
        historicalLedgerExceptionCount: 3,
        state: "predecessor",
        productionChangedByProof: false,
      },
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects current, near-match, and non-complete numeric-guard rows", async (context) => {
  for (const candidate of [
    { name: "current repository checksum", checksum: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256 },
    { name: "one-character checksum drift", checksum: `e${SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256.slice(1)}` },
    { name: "zero-step row", checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256, steps: 0 },
    { name: "unfinished row", checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256, finished: false },
    { name: "rolled-back row", checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256, rolledBack: true },
    { name: "duplicate row", checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256, duplicate: true },
  ]) {
    await context.test(candidate.name, async () => {
      const database = await createLedger();
      try {
        await seedReviewedPredecessor(database, candidate.checksum);
        if (candidate.steps !== undefined) {
          await database.query(
            `UPDATE public._prisma_migrations
                SET applied_steps_count = $1
              WHERE migration_name = $2`,
            [candidate.steps, SCHEMA_NUMERIC_GUARDS_MIGRATION],
          );
        }
        if (candidate.finished === false) {
          await database.query(
            `UPDATE public._prisma_migrations SET finished_at = NULL
              WHERE migration_name = $1`,
            [SCHEMA_NUMERIC_GUARDS_MIGRATION],
          );
        }
        if (candidate.rolledBack === true) {
          await database.query(
            `UPDATE public._prisma_migrations SET rolled_back_at = CURRENT_TIMESTAMP
              WHERE migration_name = $1`,
            [SCHEMA_NUMERIC_GUARDS_MIGRATION],
          );
        }
        if (candidate.duplicate === true) {
          await insertRow(database, {
            id: "numeric-duplicate",
            migrationName: SCHEMA_NUMERIC_GUARDS_MIGRATION,
            checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
          });
        }
        const rows = await readRows(database);
        assert.throws(() =>
          assertReservationAuthorityProductionScope(rows, "before", CATALOG)
        );
      } finally {
        await database.close();
      }
    });
  }
});
