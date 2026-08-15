import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";
import {
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  assertReservationForceProductionScope,
  readReservationForceMigrationCatalog,
} from "../scripts/verify-checkout-stock-reservation-force-production-scope.mjs";

const CATALOG = readReservationForceMigrationCatalog();

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

async function insertRow(database, id, migrationName, checksum, {
  finished = true,
  rolledBack = false,
  steps = 1,
} = {}) {
  await database.query(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, rolled_back_at,
      applied_steps_count
    ) VALUES ($1, $2, CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
              $4, CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE NULL END, $6)
  `, [id, checksum, finished, migrationName, rolledBack, steps]);
}

async function seedReviewedActivation(database) {
  for (const [index, entry] of CATALOG.slice(0, -1).entries()) {
    await insertRow(
      database,
      `reviewed-${index}`,
      entry.migration_name,
      entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
        ? SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256
        : entry.checksum,
    );
  }
  const listingChecksum = CATALOG.find(
    (entry) => entry.migration_name === LISTING_VARIANTS_REVIEWED_MIGRATION,
  )?.checksum;
  await insertRow(
    database,
    "listing-alias",
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    listingChecksum,
    { finished: false, rolledBack: true, steps: 0 },
  );
  await insertRow(
    database,
    "direct-upload-failed",
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
    { finished: false, rolledBack: true, steps: 0 },
  );
}

async function readRows(database) {
  return (await database.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     ORDER BY migration_name, started_at, id
  `)).rows;
}

test("disposable PostgreSQL accepts only the exact FORCE restart transition", async () => {
  const database = await createLedger();
  try {
    await seedReviewedActivation(database);
    assert.equal(
      assertReservationForceProductionScope(
        await readRows(database),
        "restart",
        CATALOG,
      ).state,
      "activated",
    );
    const force = CATALOG.at(-1);
    await insertRow(
      database,
      "reservation-force",
      force.migration_name,
      force.checksum,
    );
    assert.equal(
      assertReservationForceProductionScope(
        await readRows(database),
        "after",
        CATALOG,
      ).state,
      "force-hardened",
    );
    assert.equal(
      assertReservationForceProductionScope(
        await readRows(database),
        "restart",
        CATALOG,
      ).state,
      "force-hardened",
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects a zero-step FORCE row on restart", async () => {
  const database = await createLedger();
  try {
    await seedReviewedActivation(database);
    const force = CATALOG.at(-1);
    await insertRow(
      database,
      "reservation-force-failed",
      force.migration_name,
      force.checksum,
      { finished: false, steps: 0 },
    );
    const rows = await readRows(database);
    assert.throws(() => assertReservationForceProductionScope(
      rows,
      "restart",
      CATALOG,
    ));
  } finally {
    await database.close();
  }
});
