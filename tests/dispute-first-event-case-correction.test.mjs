import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  buildDisputeFirstEventCaseCorrection,
  verifyDisputeFirstEventCaseCorrection,
} from "../scripts/build-dispute-first-event-case-correction.mjs";
import { disputeFirstEventRecoveryCandidateSummary } from "../scripts/dispute-first-event-case-production-inspect.mjs";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

function extractFunction(path, signature, delimiter) {
  const migration = readFileSync(path, "utf8");
  const start = migration.indexOf(signature);
  const end = migration.indexOf(delimiter, start);
  assert.ok(start >= 0 && end >= 0, `${signature} is missing`);
  return migration.slice(start, end + delimiter.length);
}

const predecessorRelationship = extractFunction(
  "prisma/migrations/20260730010000_enforce_case_message_invariants/migration.sql",
  "CREATE FUNCTION public.grainline_case_relationship_valid()",
  "$grainline_case_relationship_valid$;",
);
const predecessorCaseApply = extractFunction(
  "prisma/migrations/20260901160000_correct_case_order_invariants/migration.sql",
  "CREATE OR REPLACE FUNCTION public.grainline_case_stripe_dispute_apply(",
  "$grainline_case_stripe_dispute_apply$;",
);
const predecessorDispute = extractFunction(
  process.env.CASE_REFUND_FOLLOWUP_MIGRATION_PATH?.trim() ||
    "prisma/migrations/20261016011000_correct_case_refund_followup_deadends/migration.sql",
  "CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_dispute_apply(",
  "$grainline_order_payment_signed_dispute_apply$;",
);
const predecessorNotification = extractFunction(
  sellerProfilePrivateMigrationPath(
    "20261013200000_move_final_seller_private_sql_callers",
  ),
  "CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(",
  "$grainline_notification_create_core$;",
);

async function createDatabase({ corrected }) {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."CaseReason" AS ENUM (
      'NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'WRONG_ITEM', 'OTHER'
    );
    CREATE TYPE public."CaseStatus" AS ENUM (
      'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'
    );
    CREATE TYPE public."CaseResolution" AS ENUM (
      'REFUND_FULL', 'REFUND_PARTIAL', 'DISMISSED'
    );
    CREATE TYPE public."NotificationType" AS ENUM (
      'NEW_MESSAGE', 'NEW_ORDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
      'CASE_OPENED', 'CASE_MESSAGE', 'CASE_RESOLVED', 'REFUND_ISSUED',
      'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK', 'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED', 'BACK_IN_STOCK', 'NEW_REVIEW', 'LOW_STOCK',
      'NEW_FAVORITE', 'NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY', 'NEW_FOLLOWER',
      'FOLLOWED_MAKER_NEW_LISTING', 'FOLLOWED_MAKER_NEW_BLOG',
      'SELLER_BROADCAST', 'COMMISSION_INTEREST', 'LISTING_APPROVED',
      'LISTING_REJECTED', 'ACCOUNT_WARNING', 'LISTING_FLAGGED_BY_USER',
      'PAYMENT_DISPUTE', 'PAYOUT_FAILED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("blockerId", "blockedId")
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "stripeChargeId" varchar(255) UNIQUE,
      "sellerRefundId" varchar(255),
      "sellerRefundLockedAt" timestamp(3) without time zone,
      "refundClaimId" varchar(255),
      "caseResolutionClaimId" varchar(255),
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" varchar(2000)
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id)
    );
    CREATE TABLE public."StripeWebhookEvent" (
      id varchar(255) PRIMARY KEY,
      type varchar(100) NOT NULL,
      "sourceObjectId" varchar(255),
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "processingStartedAt" timestamp(3) without time zone,
      "processedAt" timestamp(3) without time zone,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "stripeEventId" varchar(255) NOT NULL UNIQUE,
      "stripeObjectId" varchar(255),
      "stripeObjectType" varchar(100),
      "eventType" varchar(100) NOT NULL,
      "amountCents" integer,
      currency varchar(3) NOT NULL,
      status varchar(100),
      reason varchar(255),
      description varchar(5000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "stripeEventCreatedSeconds" bigint,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, "orderId")
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL UNIQUE REFERENCES public."Order"(id),
      "buyerId" text REFERENCES public."User"(id),
      "sellerId" text NOT NULL REFERENCES public."User"(id),
      reason public."CaseReason" NOT NULL,
      description varchar(5000) NOT NULL,
      status public."CaseStatus" NOT NULL,
      resolution public."CaseResolution",
      "refundAmountCents" integer,
      "stripeRefundId" varchar(255),
      "sellerRespondBy" timestamp(3) without time zone NOT NULL,
      "buyerMarkedResolved" boolean NOT NULL DEFAULT false,
      "sellerMarkedResolved" boolean NOT NULL DEFAULT false,
      "resolvedAt" timestamp(3) without time zone,
      "resolvedById" text REFERENCES public."User"(id),
      "openedByPaymentEventId" text UNIQUE REFERENCES public."OrderPaymentEvent"(id),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, "orderId")
    );
    CREATE TABLE public."CaseStripeDisputeApplication" (
      "paymentEventId" text PRIMARY KEY,
      "caseId" text NOT NULL,
      "orderId" text NOT NULL,
      action varchar(10) NOT NULL,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("paymentEventId", "orderId")
        REFERENCES public."OrderPaymentEvent"(id, "orderId"),
      FOREIGN KEY ("caseId", "orderId") REFERENCES public."Case"(id, "orderId")
    );
    CREATE TABLE public."SystemAuditLog" (
      id text PRIMARY KEY,
      "actorType" varchar(40) NOT NULL,
      "actorId" varchar(255),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      reason varchar(1000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Notification" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      "relatedUserId" text,
      type public."NotificationType" NOT NULL,
      title varchar(200) NOT NULL,
      body varchar(1000) NOT NULL,
      link varchar(2048),
      "sourceType" varchar(80),
      "sourceId" varchar(191),
      "dedupKey" varchar(64) NOT NULL,
      read boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", type, "dedupKey")
    );
    ${predecessorNotification}
    REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
      text, text, public."NotificationType", text, text, text
    ) FROM PUBLIC, grainline_app_runtime;
  `);

  await database.exec(`
    ${predecessorRelationship}
    ${predecessorCaseApply}
    ${predecessorDispute}
    REVOKE ALL ON FUNCTION public.grainline_case_relationship_valid()
      FROM PUBLIC, grainline_app_runtime;
    REVOKE ALL ON FUNCTION public.grainline_case_stripe_dispute_apply(text)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_case_stripe_dispute_apply(text)
      TO grainline_app_runtime;
    REVOKE ALL ON FUNCTION
      public.grainline_order_payment_signed_dispute_apply(
        text, bigint, text, text, bigint, integer, text, text, text
      ) FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_order_payment_signed_dispute_apply(
        text, bigint, text, text, bigint, integer, text, text, text
      ) TO grainline_app_runtime;
  `);

  if (corrected) await database.exec(buildDisputeFirstEventCaseCorrection());

  await database.exec(`
    CREATE TRIGGER grainline_case_relationship_valid
    BEFORE INSERT OR UPDATE OF
      "orderId", "buyerId", "sellerId", "openedByPaymentEventId", reason
    ON public."Case"
    FOR EACH ROW
    EXECUTE FUNCTION public.grainline_case_relationship_valid();
  `);

  await database.exec(`
    INSERT INTO public."User" (id)
      VALUES ('buyer-1'), ('seller-user-1');
    INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-1', 'seller-user-1');
    INSERT INTO public."Listing" (id, "sellerId")
      VALUES ('listing-1', 'seller-1');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "stripeChargeId"
    ) VALUES ('order-1', 'buyer-1', 'seller-1', 'ch_1');
    INSERT INTO public."OrderItem" (id, "orderId", "listingId")
      VALUES ('item-1', 'order-1', 'listing-1');
  `);
  return database;
}

async function seedLease(database, { eventId, type, disputeId = "du_1" }) {
  await database.query(
    `
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
  `,
    [eventId, type, disputeId],
  );
}

async function applyDispute(
  database,
  {
    eventId,
    created,
    status = "needs_response",
    disputeId = "du_1",
    amount = 11800,
  },
) {
  return (
    await database.query(
      `
    SELECT *
      FROM public.grainline_order_payment_signed_dispute_apply(
        $1, 1, 'ch_1', $2, $3, $4, 'usd', 'fraudulent', $5
      )
  `,
      [eventId, disputeId, created, amount, status],
    )
  ).rows[0];
}

async function caseCount(database) {
  return Number(
    (
      await database.query(`
    SELECT pg_catalog.count(*)::integer AS count FROM public."Case"
  `)
    ).rows[0]?.count ?? 0,
  );
}

async function createDisputeNotification(database, eventId, notificationId) {
  return (
    (
      await database.query(
        `
    SELECT public.grainline_notification_create_core(
      $1, 'seller-user-1', 'PAYMENT_DISPUTE'::public."NotificationType",
      'order_payment', $2, 'buyer-1'
    ) AS id
  `,
        [notificationId, eventId],
      )
    ).rows[0]?.id ?? null
  );
}

async function functionCatalog(database) {
  return (
    await database.query(`
    SELECT
      routine.proname,
      pg_catalog.pg_get_userbyid(routine.proowner) AS owner,
      routine.prosecdef,
      routine.provolatile,
      routine.proparallel,
      routine.proconfig,
      COALESCE(
        pg_catalog.string_agg(
          pg_catalog.pg_get_userbyid(acl.grantor)
            || '>' || pg_catalog.pg_get_userbyid(acl.grantee)
            || ':' || acl.privilege_type
            || ':' || acl.is_grantable::text,
          ',' ORDER BY acl.grantor, acl.grantee, acl.privilege_type
        ),
        ''
      ) AS acl
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    LEFT JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) AS acl ON true
    WHERE namespace.nspname = 'public'
      AND (
        routine.proname = 'grainline_case_relationship_valid'
        OR routine.proname = 'grainline_case_stripe_dispute_apply'
        OR routine.proname = 'grainline_order_payment_signed_dispute_apply'
        OR routine.proname = 'grainline_notification_create_core'
      )
    GROUP BY
      routine.proname,
      routine.proowner,
      routine.prosecdef,
      routine.provolatile,
      routine.proparallel,
      routine.proconfig
    ORDER BY routine.proname
  `)
  ).rows;
}

test("#662 predecessor reproduces funds-withdrawn first with no Case or seller alert", async () => {
  const database = await createDatabase({ corrected: false });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await seedLease(database, {
      eventId: "evt_funds_first",
      type: "charge.dispute.funds_withdrawn",
    });
    const fundsFirst = await applyDispute(database, {
      eventId: "evt_funds_first",
      created,
    });
    assert.equal(fundsFirst.action, "applied");
    assert.equal(fundsFirst.caseId, null);
    assert.equal(fundsFirst.notificationAuthorized, false);
    assert.equal(
      await createDisputeNotification(
        database,
        "evt_funds_first",
        "00000000-0000-4000-8000-000000000001",
      ),
      null,
    );
    assert.equal(
      (await database.query(`SELECT * FROM public."Notification"`)).rows.length,
      0,
    );

    await seedLease(database, {
      eventId: "evt_created_second",
      type: "charge.dispute.created",
    });
    const createdSecond = await applyDispute(database, {
      eventId: "evt_created_second",
      created,
    });
    assert.equal(createdSecond.action, "conflict_recorded");
    assert.equal(createdSecond.notificationAuthorized, false);
    assert.equal(await caseCount(database), 0);
  } finally {
    await database.close();
  }
});

test("#662 migration repairs one retained predecessor funds-first gap exactly once", async () => {
  const database = await createDatabase({ corrected: false });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await seedLease(database, {
      eventId: "evt_historical_funds",
      type: "charge.dispute.funds_withdrawn",
    });
    await applyDispute(database, {
      eventId: "evt_historical_funds",
      created,
    });
    await seedLease(database, {
      eventId: "evt_historical_created",
      type: "charge.dispute.created",
    });
    await applyDispute(database, {
      eventId: "evt_historical_created",
      created,
    });
    assert.equal(await caseCount(database), 0);

    await database.exec(buildDisputeFirstEventCaseCorrection());

    assert.equal(await caseCount(database), 1);
    assert.equal(
      (
        await database.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."CaseStripeDisputeApplication"
    `)
      ).rows[0].count,
      1,
    );
    assert.deepEqual(
      (
        await database.query(`
      SELECT type::text, "sourceId", "userId", "relatedUserId"
        FROM public."Notification"
    `)
      ).rows,
      [
        {
          type: "PAYMENT_DISPUTE",
          sourceId: "evt_historical_funds",
          userId: "seller-user-1",
          relatedUserId: "buyer-1",
        },
      ],
    );
  } finally {
    await database.close();
  }
});

test("#662 Production preflight rejects gaps with lost retained authority", async () => {
  const database = await createDatabase({ corrected: false });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await seedLease(database, {
      eventId: "evt_preflight_funds",
      type: "charge.dispute.funds_withdrawn",
    });
    await applyDispute(database, {
      eventId: "evt_preflight_funds",
      created,
    });

    assert.deepEqual(
      await disputeFirstEventRecoveryCandidateSummary(database),
      { candidateCount: 1, unrepairableCount: 0 },
    );

    await database.query(`
      UPDATE public."Order"
         SET "buyerId" = NULL
       WHERE id = 'order-1'
    `);
    assert.deepEqual(
      await disputeFirstEventRecoveryCandidateSummary(database),
      { candidateCount: 1, unrepairableCount: 1 },
    );

    await database.query(`
      UPDATE public."Order"
         SET "buyerId" = 'buyer-1',
             "sellerProfileId" = NULL
       WHERE id = 'order-1'
    `);
    assert.deepEqual(
      await disputeFirstEventRecoveryCandidateSummary(database),
      { candidateCount: 1, unrepairableCount: 1 },
    );
  } finally {
    await database.close();
  }
});

test("#662 correction opens one Case and authorizes one alert from funds-withdrawn first", async () => {
  const database = await createDatabase({ corrected: true });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await seedLease(database, {
      eventId: "evt_funds_first",
      type: "charge.dispute.funds_withdrawn",
    });
    const fundsFirst = await applyDispute(database, {
      eventId: "evt_funds_first",
      created,
    });
    assert.equal(fundsFirst.action, "applied");
    assert.equal(fundsFirst.caseAction, "create");
    assert.equal(fundsFirst.notificationAuthorized, true);
    assert.match(fundsFirst.caseId ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(
      await createDisputeNotification(
        database,
        "evt_funds_first",
        "00000000-0000-4000-8000-000000000002",
      ),
      "00000000-0000-4000-8000-000000000002",
    );
    assert.deepEqual(
      (
        await database.query(`
      SELECT type::text, "sourceType", "sourceId", "userId", "relatedUserId"
        FROM public."Notification"
    `)
      ).rows,
      [
        {
          type: "PAYMENT_DISPUTE",
          sourceType: "order_payment",
          sourceId: "evt_funds_first",
          userId: "seller-user-1",
          relatedUserId: "buyer-1",
        },
      ],
    );

    await seedLease(database, {
      eventId: "evt_created_second",
      type: "charge.dispute.created",
    });
    const createdSecond = await applyDispute(database, {
      eventId: "evt_created_second",
      created,
    });
    assert.equal(createdSecond.action, "same_second_recorded");
    assert.equal(createdSecond.caseId, null);
    assert.equal(createdSecond.notificationAuthorized, false);
    assert.equal(await caseCount(database), 1);

    await seedLease(database, {
      eventId: "evt_conflicting_same_second",
      type: "charge.dispute.updated",
    });
    const conflicting = await applyDispute(database, {
      eventId: "evt_conflicting_same_second",
      created,
      amount: 11799,
    });
    assert.equal(conflicting.action, "conflict_recorded");
    assert.equal(conflicting.notificationAuthorized, false);
    assert.equal(await caseCount(database), 1);

    await seedLease(database, {
      eventId: "evt_created_later",
      type: "charge.dispute.created",
    });
    const createdLater = await applyDispute(database, {
      eventId: "evt_created_later",
      created: created + 1,
    });
    assert.equal(createdLater.action, "applied");
    assert.equal(createdLater.caseId, null);
    assert.equal(createdLater.notificationAuthorized, false);
    assert.equal(await caseCount(database), 1);

    const paymentIds = Object.fromEntries(
      (
        await database.query(`
      SELECT "stripeEventId", id FROM public."OrderPaymentEvent"
       WHERE "stripeEventId" IN ('evt_funds_first', 'evt_created_later')
    `)
      ).rows.map((row) => [row.stripeEventId, row.id]),
    );
    const replay = (
      await database.query(
        `
      SELECT * FROM public.grainline_case_stripe_dispute_apply($1)
    `,
        [paymentIds.evt_funds_first],
      )
    ).rows[0];
    assert.equal(replay.action, "replay");
    await assert.rejects(
      database.query(
        `
        SELECT * FROM public.grainline_case_stripe_dispute_apply($1)
      `,
        [paymentIds.evt_created_later],
      ),
      /Case Stripe dispute source is invalid/,
    );

    await database.query(
      `
      UPDATE public."Case" SET "buyerId" = NULL WHERE id = $1
    `,
      [fundsFirst.caseId],
    );

    const opening = (
      await database.query(`
      SELECT
        case_row.status::text,
        payment.metadata->>'stripeEventType' AS event_type
      FROM public."Case" AS case_row
      JOIN public."OrderPaymentEvent" AS payment
        ON payment.id = case_row."openedByPaymentEventId"
    `)
    ).rows[0];
    assert.deepEqual(opening, {
      status: "UNDER_REVIEW",
      event_type: "charge.dispute.funds_withdrawn",
    });
  } finally {
    await database.close();
  }
});

test("#662 correction reopens an existing Case on a dispute's first nonterminal event", async () => {
  const database = await createDatabase({ corrected: true });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await database.exec(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, resolution, "sellerRespondBy", "resolvedAt", "resolvedById"
      ) VALUES (
        'case-existing', 'order-1', 'buyer-1', 'seller-user-1',
        'NOT_RECEIVED', 'Previously resolved buyer Case.',
        'RESOLVED', 'DISMISSED', CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, 'seller-user-1'
      )
    `);
    await seedLease(database, {
      eventId: "evt_funds_reopen",
      type: "charge.dispute.funds_withdrawn",
      disputeId: "du_reopen",
    });
    const reopened = await applyDispute(database, {
      eventId: "evt_funds_reopen",
      created,
      disputeId: "du_reopen",
    });
    assert.equal(reopened.caseId, "case-existing");
    assert.equal(reopened.caseAction, "reopen");
    assert.equal(reopened.notificationAuthorized, true);

    const state = (
      await database.query(`
      SELECT status::text, resolution::text, "resolvedAt", "resolvedById"
        FROM public."Case"
       WHERE id = 'case-existing'
    `)
    ).rows[0];
    assert.deepEqual(state, {
      status: "UNDER_REVIEW",
      resolution: null,
      resolvedAt: null,
      resolvedById: null,
    });
  } finally {
    await database.close();
  }
});

test("#662 correction preserves created-first and terminal-first behavior", async () => {
  const createdDatabase = await createDatabase({ corrected: true });
  const terminalDatabase = await createDatabase({ corrected: true });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await seedLease(createdDatabase, {
      eventId: "evt_created_first",
      type: "charge.dispute.created",
    });
    const createdFirst = await applyDispute(createdDatabase, {
      eventId: "evt_created_first",
      created,
    });
    assert.equal(createdFirst.caseAction, "create");
    assert.equal(createdFirst.notificationAuthorized, true);
    assert.equal(await caseCount(createdDatabase), 1);

    await seedLease(createdDatabase, {
      eventId: "evt_funds_same_second",
      type: "charge.dispute.funds_withdrawn",
    });
    const fundsSameSecond = await applyDispute(createdDatabase, {
      eventId: "evt_funds_same_second",
      created,
    });
    assert.equal(fundsSameSecond.action, "same_second_recorded");
    assert.equal(fundsSameSecond.caseId, null);
    assert.equal(fundsSameSecond.notificationAuthorized, false);
    assert.equal(await caseCount(createdDatabase), 1);

    await seedLease(terminalDatabase, {
      eventId: "evt_terminal_first",
      type: "charge.dispute.funds_reinstated",
    });
    const terminalFirst = await applyDispute(terminalDatabase, {
      eventId: "evt_terminal_first",
      created,
      status: "won",
    });
    assert.equal(terminalFirst.action, "applied");
    assert.equal(terminalFirst.caseId, null);
    assert.equal(terminalFirst.notificationAuthorized, false);
    assert.equal(await caseCount(terminalDatabase), 0);

    await seedLease(terminalDatabase, {
      eventId: "evt_updated_after_terminal",
      type: "charge.dispute.updated",
    });
    const updatedAfterTerminal = await applyDispute(terminalDatabase, {
      eventId: "evt_updated_after_terminal",
      created: created + 1,
      status: "needs_response",
    });
    assert.equal(updatedAfterTerminal.action, "applied");
    assert.equal(updatedAfterTerminal.caseId, null);
    assert.equal(updatedAfterTerminal.notificationAuthorized, false);
    assert.equal(await caseCount(terminalDatabase), 0);

    await seedLease(terminalDatabase, {
      eventId: "evt_created_after_terminal",
      type: "charge.dispute.created",
    });
    const createdAfterTerminal = await applyDispute(terminalDatabase, {
      eventId: "evt_created_after_terminal",
      created: created + 2,
      status: "needs_response",
    });
    assert.equal(createdAfterTerminal.action, "applied");
    assert.equal(createdAfterTerminal.caseAction, "create");
    assert.equal(createdAfterTerminal.notificationAuthorized, true);
    assert.equal(await caseCount(terminalDatabase), 1);
  } finally {
    await createdDatabase.close();
    await terminalDatabase.close();
  }
});

test("#662 migration preserves predecessor owner, ACL and function configuration", async () => {
  const database = await createDatabase({ corrected: false });
  try {
    const before = await functionCatalog(database);
    await database.exec(buildDisputeFirstEventCaseCorrection());
    const after = await functionCatalog(database);
    assert.deepEqual(after, before);
    assert.equal(before.length, 4);
    for (const routine of after) {
      assert.equal(routine.owner, "postgres");
      assert.equal(routine.prosecdef, true);
      assert.equal(routine.provolatile, "v");
      assert.equal(routine.proparallel, "u");
      assert.deepEqual(routine.proconfig, ["search_path=pg_catalog"]);
      assert.doesNotMatch(routine.acl, />PUBLIC:EXECUTE/);
    }
    for (const internal of after.filter(
      (routine) =>
        routine.proname === "grainline_case_relationship_valid" ||
        routine.proname === "grainline_notification_create_core",
    )) {
      assert.doesNotMatch(internal.acl, />grainline_app_runtime:EXECUTE/);
    }
    for (const callable of after.filter(
      (routine) =>
        routine.proname === "grainline_case_stripe_dispute_apply" ||
        routine.proname === "grainline_order_payment_signed_dispute_apply",
    )) {
      assert.match(callable.acl, />grainline_app_runtime:EXECUTE:false/);
    }
  } finally {
    await database.close();
  }
});

test("#662 Case authority rejects a later non-created event when called directly", async () => {
  const database = await createDatabase({ corrected: true });
  const created = Math.floor(Date.now() / 1000) - 6;
  try {
    await seedLease(database, {
      eventId: "evt_created_first",
      type: "charge.dispute.created",
    });
    await applyDispute(database, {
      eventId: "evt_created_first",
      created,
    });

    await seedLease(database, {
      eventId: "evt_updated_later",
      type: "charge.dispute.updated",
    });
    const updated = await applyDispute(database, {
      eventId: "evt_updated_later",
      created: created + 1,
      status: "under_review",
    });
    assert.equal(updated.action, "applied");
    assert.equal(updated.caseAction, null);
    assert.equal(updated.notificationAuthorized, false);

    await assert.rejects(
      database.query(
        `
        SELECT *
          FROM public.grainline_case_stripe_dispute_apply($1)
      `,
        [updated.paymentEventId],
      ),
      /Case Stripe dispute source is invalid/,
    );
    assert.equal(await caseCount(database), 1);
  } finally {
    await database.close();
  }
});

test("#662 recovery aborts before writes when the exact candidate set exceeds 100", async () => {
  const database = await createDatabase({ corrected: false });
  const created = Math.floor(Date.now() / 1000) - 5;
  try {
    await database.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "stripeChargeId"
      )
      SELECT
        'order-cap-' || generated.n::text,
        'buyer-1',
        'seller-1',
        'ch_cap_' || generated.n::text
      FROM pg_catalog.generate_series(1, 101) AS generated(n)
    `);
    await database.query(
      `
      INSERT INTO public."OrderPaymentEvent" (
        id,
        "orderId",
        "stripeEventId",
        "stripeObjectId",
        "stripeObjectType",
        "eventType",
        "amountCents",
        currency,
        status,
        reason,
        metadata,
        "stripeEventCreatedSeconds"
      )
      SELECT
        'payment-cap-' || generated.n::text,
        'order-cap-' || generated.n::text,
        'evt_cap_' || generated.n::text,
        'du_cap_' || generated.n::text,
        'dispute',
        'DISPUTE',
        11800,
        'usd',
        'needs_response',
        'fraudulent',
        pg_catalog.jsonb_build_object(
          'chargeId', 'ch_cap_' || generated.n::text,
          'disputeId', 'du_cap_' || generated.n::text,
          'stripeEventType', 'charge.dispute.funds_withdrawn',
          'stripeEventCreated', $1::text,
          'orderingAction', 'applied'
        ),
        $1::bigint
      FROM pg_catalog.generate_series(1, 101) AS generated(n)
    `,
      [created],
    );

    await assert.rejects(
      database.exec(buildDisputeFirstEventCaseCorrection()),
      /Dispute first-event recovery candidate cap exceeded: 101/,
    );
    await database.exec("ROLLBACK");

    assert.equal(await caseCount(database), 0);
    assert.equal(
      (
        await database.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."CaseStripeDisputeApplication"
    `)
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await database.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."Notification"
    `)
      ).rows[0].count,
      0,
    );
  } finally {
    await database.close();
  }
});

test("#662 migration remains byte-pinned to reviewed predecessor functions", () => {
  const verified = verifyDisputeFirstEventCaseCorrection();
  assert.equal(
    verified.sha256,
    "714c73d9321b60e6deda6b6300ac1b4cd04f71555bbe962f7edd5c0243945505",
  );
  const migration = readFileSync(verified.migrationPath, "utf8");
  assert.match(migration, /is_first_dispute_event AND NOT is_terminal/);
  assert.match(
    migration,
    /"CaseStripeDisputeApplication" AS prior_application/,
  );
  assert.match(
    migration,
    /CREATE TEMP TABLE\s+pg_temp\.grainline_dispute_first_event_case_candidates/,
  );
  assert.match(
    migration,
    /SELECT candidates\.\*\s+FROM pg_temp\.grainline_dispute_first_event_case_candidates AS candidates/,
  );
  assert.doesNotMatch(
    migration,
    /equal_payment\.metadata->>'stripeEventType'\s+IS DISTINCT FROM source_event\.type/,
  );
});

test("#662 builder reads the preserved SellerProfile predecessor source", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "grainline-dispute-first-event-"),
  );
  const temporaryMigrations = path.join(
    temporaryRoot,
    "prisma/migrations",
  );
  const preservedMigrations = path.join(temporaryRoot, "preserved");
  const previousPreservedDirectory =
    process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR;

  const copyMigration = (source, destinationRoot, migration) => {
    const destination = path.join(
      destinationRoot,
      migration,
      "migration.sql",
    );
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  };

  try {
    copyMigration(
      "prisma/migrations/20260730010000_enforce_case_message_invariants/migration.sql",
      temporaryMigrations,
      "20260730010000_enforce_case_message_invariants",
    );
    copyMigration(
      "prisma/migrations/20260901160000_correct_case_order_invariants/migration.sql",
      temporaryMigrations,
      "20260901160000_correct_case_order_invariants",
    );
    if (!process.env.CASE_REFUND_FOLLOWUP_MIGRATION_PATH?.trim()) {
      copyMigration(
        "prisma/migrations/20261016011000_correct_case_refund_followup_deadends/migration.sql",
        temporaryMigrations,
        "20261016011000_correct_case_refund_followup_deadends",
      );
    }
    copyMigration(
      sellerProfilePrivateMigrationPath(
        "20261013200000_move_final_seller_private_sql_callers",
      ),
      preservedMigrations,
      "20261013200000_move_final_seller_private_sql_callers",
    );
    process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR =
      preservedMigrations;

    assert.match(
      buildDisputeFirstEventCaseCorrection(temporaryRoot),
      /CREATE OR REPLACE FUNCTION public\.grainline_notification_create_core\(/,
    );
  } finally {
    if (previousPreservedDirectory === undefined) {
      delete process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR;
    } else {
      process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR =
        previousPreservedDirectory;
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
