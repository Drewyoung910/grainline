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
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
} from "../scripts/stage-seller-payout-event-force-migration.mjs";
import {
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS,
  assertSellerPayoutEventForceReviewedSuccessorScope,
  readSellerPayoutEventForceSealedPrefixCatalog,
} from "../scripts/verify-seller-payout-event-force-production-scope.mjs";

const FORCE_CATALOG = readSellerPayoutEventForceSealedPrefixCatalog();

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

async function seedBeforeActivation(database) {
  for (const [index, entry] of FORCE_CATALOG.entries()) {
    await insertRow(
      database,
      `prefix-${index}`,
      entry.migration_name,
      entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
        ? SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256
        : entry.checksum,
    );
  }
  const listingChecksum = FORCE_CATALOG.find(
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
  for (
    const [index, entry]
      of SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.slice(0, -1).entries()
  ) {
    await insertRow(
      database,
      `successor-${index}`,
      entry.migration_name,
      entry.checksum,
    );
  }
}

async function readRows(database) {
  return (await database.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     ORDER BY migration_name, started_at, id
  `)).rows;
}

test("disposable PostgreSQL proves the exact reviewed successor transition", async () => {
  const database = await createLedger();
  try {
    await seedBeforeActivation(database);
    assert.equal(
      assertSellerPayoutEventForceReviewedSuccessorScope(
        await readRows(database),
        "before-order-payment-event-activation",
        { forceCatalog: FORCE_CATALOG },
      ).state,
      "before-order-payment-event-activation",
    );
    const target = SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.at(-1);
    await insertRow(database, "activation", target.migration_name, target.checksum);
    assert.equal(
      assertSellerPayoutEventForceReviewedSuccessorScope(
        await readRows(database),
        "after-order-payment-event-activation",
        { forceCatalog: FORCE_CATALOG },
      ).state,
      "after-order-payment-event-activation",
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects unknown and drifted successor rows", async () => {
  for (const variant of ["unknown", "drifted"]) {
    const database = await createLedger();
    try {
      await seedBeforeActivation(database);
      if (variant === "unknown") {
        await insertRow(
          database,
          "unknown",
          "20260830025000_unreviewed",
          "1".repeat(64),
        );
      } else {
        const target = SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS[6];
        await database.query(
          `UPDATE public._prisma_migrations
              SET checksum = $1
            WHERE migration_name = $2`,
          ["0".repeat(64), target.migration_name],
        );
      }
      const rows = await readRows(database);
      assert.throws(
        () => assertSellerPayoutEventForceReviewedSuccessorScope(
          rows,
          "before-order-payment-event-activation",
          { forceCatalog: FORCE_CATALOG },
        ),
      );
    } finally {
      await database.close();
    }
  }
});

assert.equal(
  FORCE_CATALOG.at(-1).migration_name,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
);
assert.equal(
  FORCE_CATALOG.at(-1).checksum,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
);
