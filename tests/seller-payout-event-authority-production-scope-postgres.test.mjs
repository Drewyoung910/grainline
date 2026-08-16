import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
  SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS,
  assertSellerPayoutEventAuthorityProductionScope,
  sellerPayoutEventAuthorityFunctionSources,
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/verify-seller-payout-event-authority-release.mjs";

const CHECKSUMS = Object.freeze({
  [LISTING_VARIANTS_REVIEWED_MIGRATION]: "1".repeat(64),
  [SCHEMA_NUMERIC_GUARDS_MIGRATION]: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName]:
    DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  [CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION]: "2".repeat(64),
  [SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION]:
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
});
const CATALOG = Object.entries(CHECKSUMS)
  .map(([migration_name, checksum]) => ({ migration_name, checksum }))
  .sort((left, right) => left.migration_name.localeCompare(right.migration_name));
const FUNCTION_SOURCES = sellerPayoutEventAuthorityFunctionSources();
const TABLE = Object.freeze({
  owner_name: "neondb_owner",
  rls_enabled: false,
  rls_forced: false,
  policy_count: 0,
  runtime_can_select: true,
  runtime_can_insert: true,
  runtime_can_update: true,
  runtime_can_delete: true,
  public_has_crud: false,
  invalid_table_acl_count: 0,
  column_acl_count: 0,
});
const PREDECESSOR_CATALOG = Object.freeze({
  table: TABLE,
  columns: [],
  constraints: [],
  indexes: [],
  functions: [],
});
const PREPARED_CATALOG = Object.freeze({
  table: TABLE,
  columns: [{
    column_name: "stripeEventCreatedSeconds",
    data_type: "bigint",
    is_nullable: "YES",
  }],
  constraints: [
    "SellerPayoutEvent_amount_nonnegative_chk",
    "SellerPayoutEvent_currency_chk",
    "SellerPayoutEvent_event_created_seconds_chk",
    "SellerPayoutEvent_failed_status_chk",
    "SellerPayoutEvent_source_event_chk",
  ].map((constraint_name) => ({
    constraint_name,
    constraint_type: "c",
    validated: true,
    definition: ({
      SellerPayoutEvent_amount_nonnegative_chk:
        'CHECK (("amountCents" IS NULL) OR ("amountCents" >= 0))',
      SellerPayoutEvent_currency_chk:
        "CHECK ((currency ~ '^[a-z]{3}$'::text))",
      SellerPayoutEvent_event_created_seconds_chk:
        'CHECK (("stripeEventCreatedSeconds" IS NULL) OR ("stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799))',
      SellerPayoutEvent_failed_status_chk:
        "CHECK ((status = 'failed'::text))",
      SellerPayoutEvent_source_event_chk:
        'CHECK (("stripeEventId" IS NOT NULL) AND (char_length(btrim("stripeEventId")) BETWEEN 1 AND 255))',
    })[constraint_name],
  })),
  indexes: [
    {
      index_name: "SellerPayoutEvent_seller_event_time_idx",
      is_unique: false,
      is_valid: true,
      is_ready: true,
      definition:
        "CREATE INDEX ... (\"sellerProfileId\", \"stripeEventCreatedSeconds\" DESC, id DESC)",
    },
    {
      index_name: "SellerPayoutEvent_stripeEventId_key",
      is_unique: true,
      is_valid: true,
      is_ready: true,
      definition: "CREATE UNIQUE INDEX ... (\"stripeEventId\")",
    },
  ],
  functions: SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map((entry) => ({
    identity: entry.identity,
    owner_name: "neondb_owner",
    function_kind: "f",
    language_name: entry.language,
    security_definer: true,
    leakproof: false,
    config: ["search_path=pg_catalog"],
    runtime_can_execute: true,
    public_can_execute: false,
    invalid_acl_count: 0,
    volatility: entry.volatility,
    parallel: entry.parallel,
    function_source: FUNCTION_SOURCES[entry.identity],
  })),
});

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

async function seedPredecessor(database) {
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
    checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
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
    id: "reservation-force",
    migrationName: CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
    checksum: CHECKSUMS[CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION],
  });
}

async function readRows(database) {
  return (await database.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     ORDER BY migration_name, started_at, id
  `)).rows;
}

test("disposable PostgreSQL accepts only complete predecessor or prepared ledger", async () => {
  const database = await createLedger();
  try {
    await seedPredecessor(database);
    assert.equal(
      assertSellerPayoutEventAuthorityProductionScope(
        { ledgerRows: await readRows(database), catalogState: PREDECESSOR_CATALOG },
        "restart",
        CATALOG,
      ).state,
      "predecessor",
    );
    await insertRow(database, {
      id: "payout-authority",
      migrationName: SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
      checksum: SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
    });
    assert.equal(
      assertSellerPayoutEventAuthorityProductionScope(
        { ledgerRows: await readRows(database), catalogState: PREPARED_CATALOG },
        "restart",
        CATALOG,
      ).state,
      "prepared",
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects a partial or checksum-drifted payout row", async (context) => {
  for (const candidate of [
    { name: "unfinished", finished: false },
    { name: "zero step", steps: 0 },
    { name: "rolled back", rolledBack: true },
    { name: "checksum drift", checksum: "9".repeat(64) },
  ]) {
    await context.test(candidate.name, async () => {
      const database = await createLedger();
      try {
        await seedPredecessor(database);
        await insertRow(database, {
          id: `payout-${candidate.name}`,
          migrationName: SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
          checksum: candidate.checksum
            ?? SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
          finished: candidate.finished,
          rolledBack: candidate.rolledBack,
          steps: candidate.steps,
        });
        const rows = await readRows(database);
        assert.throws(() =>
          assertSellerPayoutEventAuthorityProductionScope(
            { ledgerRows: rows, catalogState: PREPARED_CATALOG },
            "restart",
            CATALOG,
          )
        );
      } finally {
        await database.close();
      }
    });
  }
});
