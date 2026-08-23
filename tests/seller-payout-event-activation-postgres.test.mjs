import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const authority = readFileSync(
  "prisma/migrations/20260815210000_prepare_seller_payout_event_authority/migration.sql",
  "utf8",
);
const activation = readFileSync(
  "prisma/migrations/20260822180000_enable_seller_payout_event_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-payout-event-activation-rollback.sql",
  "utf8",
);

async function createPreparedDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (id text PRIMARY KEY);
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "stripeAccountId" varchar(255) UNIQUE
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(2000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerPayoutEvent" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL
        REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripePayoutId" varchar(255) NOT NULL UNIQUE,
      status varchar(100) NOT NULL,
      "amountCents" integer,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "failureCode" varchar(100),
      "failureMessage" varchar(1000),
      "stripeEventId" varchar(255),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "SellerPayoutEvent_sellerProfileId_createdAt_idx"
      ON public."SellerPayoutEvent" ("sellerProfileId", "createdAt");
    CREATE INDEX "SellerPayoutEvent_status_createdAt_idx"
      ON public."SellerPayoutEvent" (status, "createdAt");
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."SellerPayoutEvent" TO grainline_app_runtime;
  `);
  await database.exec(authority);
  return database;
}

async function rollbackFailedMigration(database) {
  await database.exec("ROLLBACK").catch(() => {});
}

test("policyless activation executes and establishes the exact table posture", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(activation);
    const state = (await database.query(`
      SELECT
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS rls_forced,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid) AS policy_count,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', relation.oid, 'SELECT'
        ) AS runtime_select,
        attribute.attnotnull AS provider_time_not_null
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attname = 'stripeEventCreatedSeconds'
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'SellerPayoutEvent'
    `)).rows;
    assert.deepEqual(state, [{
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
      runtime_select: false,
      provider_time_not_null: true,
    }]);
  } finally {
    await database.close();
  }
});

test("activation rejects an unreviewed third-role table grant", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(`
      CREATE ROLE grainline_unreviewed_reader NOLOGIN;
      GRANT SELECT ON TABLE public."SellerPayoutEvent"
        TO grainline_unreviewed_reader;
    `);
    await assert.rejects(
      database.exec(activation),
      /predecessor table ACLs drifted/u,
    );
    await rollbackFailedMigration(database);
    const state = (await database.query(`
      SELECT relrowsecurity AS rls_enabled
        FROM pg_catalog.pg_class
       WHERE oid = 'public."SellerPayoutEvent"'::pg_catalog.regclass
    `)).rows;
    assert.deepEqual(state, [{ rls_enabled: false }]);
  } finally {
    await database.close();
  }
});

test("activation rejects a same-name index with the wrong key order", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(`
      DROP INDEX public."SellerPayoutEvent_status_createdAt_idx";
      CREATE INDEX "SellerPayoutEvent_status_createdAt_idx"
        ON public."SellerPayoutEvent" ("createdAt", status);
    `);
    await assert.rejects(
      database.exec(activation),
      /required index catalog drifted/u,
    );
    await rollbackFailedMigration(database);
  } finally {
    await database.close();
  }
});

test("rollback rejects an unreviewed third-role grant before changing posture", async () => {
  const database = await createPreparedDatabase();
  try {
    await database.exec(activation);
    await database.exec(`
      CREATE ROLE grainline_unreviewed_reader NOLOGIN;
      GRANT SELECT ON TABLE public."SellerPayoutEvent"
        TO grainline_unreviewed_reader;
    `);
    await assert.rejects(
      database.exec(rollback),
      /activation rollback predecessor drifted/u,
    );
    await rollbackFailedMigration(database);
    const state = (await database.query(`
      SELECT relrowsecurity AS rls_enabled
        FROM pg_catalog.pg_class
       WHERE oid = 'public."SellerPayoutEvent"'::pg_catalog.regclass
    `)).rows;
    assert.deepEqual(state, [{ rls_enabled: true }]);
  } finally {
    await database.close();
  }
});
