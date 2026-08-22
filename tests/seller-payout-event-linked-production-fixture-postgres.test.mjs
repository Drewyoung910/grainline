import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCleanupSnapshot,
  cleanupExactRows,
  createDisposableDatabaseFixture,
  disposableDatabaseIdentity,
  readCleanupSnapshot,
} from "../scripts/seller-payout-event-linked-production-proof.mjs";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

function proofState(overrides = {}) {
  const identity = disposableDatabaseIdentity(ATTEMPT_ID);
  return {
    attemptId: ATTEMPT_ID,
    sellerId: identity.sellerId,
    sellerUserId: identity.userId,
    canaryClerkId: identity.clerkId,
    canaryEmail: identity.email,
    stripeAccountId: "acct_disposable_linked_test",
    eventId: "evt_disposable_linked_test",
    payoutId: "po_disposable_linked_test",
    payoutEventId: "spe_disposable_linked_test",
    notificationId: "notification_disposable_linked_test",
    ...overrides,
  };
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role public."Role" NOT NULL DEFAULT 'USER',
      "deletedAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL,
      "displayNameNormalized" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255) UNIQUE,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountVersion" varchar(20),
      "stripeControllerType" varchar(100),
      "vacationMode" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 1,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(2000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerPayoutEvent" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
      "stripePayoutId" varchar(255) NOT NULL UNIQUE,
      "stripeEventId" varchar(255),
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      type text NOT NULL,
      "sourceType" varchar(100),
      "sourceId" varchar(255),
      "relatedUserId" text
    );
  `);
  return database;
}

async function seedDelivery(database, state) {
  await database.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "processedAt", "lastError"
    ) VALUES ($1, 'payout.failed', $2, CURRENT_TIMESTAMP, NULL)
  `, [state.eventId, state.payoutId]);
  await database.query(`
    INSERT INTO public."SellerPayoutEvent" (
      id, "sellerProfileId", "stripePayoutId", "stripeEventId"
    ) VALUES ($1, $2, $3, $4)
  `, [state.payoutEventId, state.sellerId, state.payoutId, state.eventId]);
  await database.query(`
    INSERT INTO public."Notification" (
      id, "userId", type, "sourceType", "sourceId", "relatedUserId"
    ) VALUES ($1, $2, 'PAYOUT_FAILED', 'stripe_payout_failure', $3, NULL)
  `, [state.notificationId, state.sellerUserId, state.payoutEventId]);
}

test("disposable PostgreSQL restart-safely creates and exactly removes the linked canary", async () => {
  const database = await createDatabase();
  const state = proofState();
  try {
    await createDisposableDatabaseFixture(database, state);
    await createDisposableDatabaseFixture(database, state);
    const counts = (await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User") AS users,
        (SELECT count(*)::integer FROM public."SellerProfile") AS sellers
    `)).rows[0];
    assert.deepEqual(counts, { sellers: 1, users: 1 });

    await seedDelivery(database, state);
    await cleanupExactRows(database, state);
    assert.deepEqual(
      assertCleanupSnapshot(await readCleanupSnapshot(database, state)),
      {
        userCount: 0,
        sellerCount: 0,
        webhookCount: 1,
        webhookProcessed: true,
        payoutCount: 0,
        notificationCount: 0,
      },
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL refuses a colliding user or cleanup relationship", async () => {
  const database = await createDatabase();
  const state = proofState();
  try {
    await database.query(`
      INSERT INTO public."User" (id, "clerkId", email, "updatedAt")
      VALUES ($1, 'different-clerk', 'different@example.invalid', CURRENT_TIMESTAMP)
    `, [state.sellerUserId]);
    await assert.rejects(
      createDisposableDatabaseFixture(database, state),
      /fixture identity collided/,
    );
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL refuses to cascade an unexpected canary dependent", async () => {
  const database = await createDatabase();
  const state = proofState();
  try {
    await createDisposableDatabaseFixture(database, state);
    await seedDelivery(database, state);
    await database.exec(`
      CREATE TABLE public."UnexpectedCanaryDependent" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE
      )
    `);
    await database.query(`
      INSERT INTO public."UnexpectedCanaryDependent" (id, "userId") VALUES ('unexpected', $1)
    `, [state.sellerUserId]);
    await assert.rejects(
      cleanupExactRows(database, state),
      /unexpected dependent row/,
    );
    const retained = (await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id = $1) AS users,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $2) AS sellers,
        (SELECT count(*)::integer FROM public."SellerPayoutEvent" WHERE id = $3) AS payouts,
        (SELECT count(*)::integer FROM public."Notification" WHERE id = $4) AS notifications
    `, [
      state.sellerUserId,
      state.sellerId,
      state.payoutEventId,
      state.notificationId,
    ])).rows[0];
    assert.deepEqual(retained, { notifications: 1, payouts: 1, sellers: 1, users: 1 });
  } finally {
    await database.close();
  }
});
