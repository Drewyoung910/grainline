import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260815210000_prepare_seller_payout_event_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
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
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
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
  await database.exec(migration);
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('user-1'), ('user-2');
    INSERT INTO public."SellerProfile" (id, "userId", "stripeAccountId") VALUES
      ('seller-1', 'user-1', 'acct_1'),
      ('seller-2', 'user-2', 'acct_2');
  `);
  return database;
}

async function seedLease(database, eventId, payoutId, generation = 1) {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, 'payout.failed', $2, $3, CURRENT_TIMESTAMP)
  `, [eventId, payoutId, generation]);
}

async function applyPayout(database, {
  eventId,
  eventCreatedSeconds,
  accountId = "acct_1",
  payoutId = "po_1",
  amountCents = 100,
  failureCode = "no_account",
  failureMessage = "Test payout failed",
} = {}) {
  return (await database.query(`
    SELECT action, payout_event_id, seller_user_id
      FROM public.grainline_seller_payout_event_apply(
        $1, 1, $2, $3, $4, $5, 'usd', $6, $7
      )
  `, [
    eventId,
    eventCreatedSeconds,
    accountId,
    payoutId,
    amountCents,
    failureCode,
    failureMessage,
  ])).rows[0];
}

test("disposable PostgreSQL proves ordered payout authority and seller projections", async () => {
  const database = await createDatabase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await seedLease(database, "evt_insert", "po_1");
    const inserted = await applyPayout(database, {
      eventId: "evt_insert",
      eventCreatedSeconds: now - 3,
    });
    assert.equal(inserted.action, "inserted");
    assert.equal(inserted.seller_user_id, "user-1");
    assert.ok(inserted.payout_event_id);

    const replay = await applyPayout(database, {
      eventId: "evt_insert",
      eventCreatedSeconds: now - 3,
    });
    assert.deepEqual(replay, {
      action: "already_applied",
      payout_event_id: inserted.payout_event_id,
      seller_user_id: "user-1",
    });

    await seedLease(database, "evt_old", "po_1");
    const stale = await applyPayout(database, {
      eventId: "evt_old",
      eventCreatedSeconds: now - 4,
      failureMessage: "Older failure",
    });
    assert.equal(stale.action, "stale_ignored");

    await seedLease(database, "evt_equal", "po_1");
    await assert.rejects(
      applyPayout(database, {
        eventId: "evt_equal",
        eventCreatedSeconds: now - 3,
      }),
      /ordering is ambiguous/,
    );

    await seedLease(database, "evt_new", "po_1");
    const updated = await applyPayout(database, {
      eventId: "evt_new",
      eventCreatedSeconds: now - 2,
      amountCents: 125,
      failureMessage: "Newer failure",
    });
    assert.equal(updated.action, "updated");
    assert.equal(updated.payout_event_id, inserted.payout_event_id);

    const latest = (await database.query(`
      SELECT * FROM public.grainline_seller_payout_latest_failure('user-1')
    `)).rows;
    assert.equal(latest.length, 1);
    assert.equal(latest[0].payout_event_id, inserted.payout_event_id);
    assert.equal(Number(latest[0].event_created_seconds), now - 2);
    assert.equal(latest[0].failure_message, "Newer failure");
    assert.equal((await database.query(`
      SELECT * FROM public.grainline_seller_payout_latest_failure('user-2')
    `)).rows.length, 0);

    const exported = (await database.query(`
      SELECT * FROM public.grainline_seller_payout_export_page(
        'user-1', 10000, NULL, NULL
      )
    `)).rows;
    assert.equal(exported.length, 1);
    assert.equal(exported[0].seller_profile_id, "seller-1");
    assert.equal(exported[0].stripe_payout_id, "po_1");
    assert.equal(Number(exported[0].event_created_seconds), now - 2);
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL rejects forged source relationships and preserves compatibility grants", async () => {
  const database = await createDatabase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await seedLease(database, "evt_wrong_source", "po_real");
    await assert.rejects(
      applyPayout(database, {
        eventId: "evt_wrong_source",
        eventCreatedSeconds: now,
        payoutId: "po_forged",
      }),
      /webhook claim is invalid/,
    );

    await seedLease(database, "evt_unknown", "po_unknown");
    const ignored = await applyPayout(database, {
      eventId: "evt_unknown",
      eventCreatedSeconds: now,
      accountId: "acct_unknown",
      payoutId: "po_unknown",
    });
    assert.deepEqual(ignored, {
      action: "ignored_unknown_account",
      payout_event_id: null,
      seller_user_id: null,
    });

    const posture = (await database.query(`
      SELECT
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        has_table_privilege('grainline_app_runtime', 'public."SellerPayoutEvent"', 'SELECT') AS can_select,
        has_table_privilege('grainline_app_runtime', 'public."SellerPayoutEvent"', 'INSERT') AS can_insert,
        has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_payout_event_apply(text,bigint,bigint,text,text,integer,text,text,text)',
          'EXECUTE'
        ) AS can_apply,
        has_function_privilege(
          'public',
          'public.grainline_seller_payout_event_apply(text,bigint,bigint,text,text,integer,text,text,text)',
          'EXECUTE'
        ) AS public_can_apply
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'SellerPayoutEvent'
    `)).rows[0];
    assert.deepEqual(posture, {
      rls_enabled: false,
      rls_forced: false,
      can_select: true,
      can_insert: true,
      can_apply: true,
      public_can_apply: false,
    });
  } finally {
    await database.close();
  }
});
