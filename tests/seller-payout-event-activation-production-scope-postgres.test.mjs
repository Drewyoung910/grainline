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
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  assertSellerPayoutEventActivationProductionScope,
  readSellerPayoutEventActivationMigrationCatalog,
} from "../scripts/verify-seller-payout-event-activation-production-scope.mjs";

const CATALOG = readSellerPayoutEventActivationMigrationCatalog();

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

async function seedPreparedLedger(database) {
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
  assert.match(listingChecksum ?? "", /^[0-9a-f]{64}$/u);
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

test("disposable PostgreSQL accepts only the exact payout activation transition", async () => {
  const database = await createLedger();
  try {
    await seedPreparedLedger(database);
    assert.equal(
      assertSellerPayoutEventActivationProductionScope(
        await readRows(database),
        "restart",
        CATALOG,
      ).state,
      "prepared",
    );

    const activation = CATALOG.at(-1);
    await insertRow(
      database,
      "payout-activation",
      activation.migration_name,
      activation.checksum,
    );
    assert.equal(
      assertSellerPayoutEventActivationProductionScope(
        await readRows(database),
        "after",
        CATALOG,
      ).state,
      "activated",
    );
    assert.equal(
      assertSellerPayoutEventActivationProductionScope(
        await readRows(database),
        "restart",
        CATALOG,
      ).state,
      "activated",
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects partial and drifting payout activation rows", async (context) => {
  const activation = CATALOG.at(-1);
  for (const candidate of [
    { name: "unfinished", finished: false },
    { name: "zero step", steps: 0 },
    { name: "rolled back", rolledBack: true },
    { name: "checksum drift", checksum: "9".repeat(64) },
  ]) {
    await context.test(candidate.name, async () => {
      const database = await createLedger();
      try {
        await seedPreparedLedger(database);
        await insertRow(
          database,
          `payout-${candidate.name}`,
          activation.migration_name,
          candidate.checksum ?? activation.checksum,
          {
            finished: candidate.finished,
            rolledBack: candidate.rolledBack,
            steps: candidate.steps,
          },
        );
        const rows = await readRows(database);
        assert.throws(() => assertSellerPayoutEventActivationProductionScope(
          rows,
          "restart",
          CATALOG,
        ));
      } finally {
        await database.close();
      }
    });
  }
});
