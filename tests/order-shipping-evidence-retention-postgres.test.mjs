import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const PREDECESSOR_PATH =
  "prisma/migrations/20260901160000_correct_case_order_invariants/migration.sql";
const ACCOUNT_DELETION_PATH =
  "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql";
const STAFF_MUTATION_PATH =
  "prisma/migrations/20260905090000_prepare_order_staff_mutation_authority/migration.sql";
const MIGRATION_PATH =
  "prisma/migrations/20261002030000_preserve_order_shipping_dispute_evidence/migration.sql";

function extractFunction(sql, functionName) {
  const replaceMarker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const createMarker = `CREATE FUNCTION public.${functionName}(`;
  const start = Math.max(sql.indexOf(replaceMarker), sql.indexOf(createMarker));
  assert.ok(start >= 0, `${functionName} start is missing`);
  const delimiter = `$${functionName}$;`;
  const end = sql.indexOf(delimiter, start);
  assert.ok(end > start, `${functionName} end is missing`);
  return sql.slice(start, end + delimiter.length);
}

async function predecessorDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP',
      'DELIVERED', 'PICKED_UP', 'CANCELLED'
    );
    CREATE TYPE public."CaseStatus" AS ENUM (
      'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW',
      'RESOLVED', 'CLOSED'
    );
    CREATE TYPE public."OrderDisputeRecoveryStatus" AS ENUM (
      'REVERSAL_PENDING', 'REVERSING', 'REVERSED', 'RESTORE_PENDING',
      'RESTORING', 'RESTORED', 'NO_REVERSAL_REQUIRED', 'MANUAL_REVIEW'
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text,
      "sellerProfileId" text,
      "paidAt" timestamp(3) without time zone,
      "buyerEmail" varchar(254),
      "buyerName" varchar(200),
      "shipToLine1" varchar(200),
      "shipToLine2" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "pickedUpAt" timestamp(3) without time zone,
      "deliveredAt" timestamp(3) without time zone,
      "sellerNotes" varchar(2000),
      "estimatedDeliveryDate" timestamp(3) without time zone,
      "quotedToLine1" varchar(200),
      "quotedToLine2" varchar(200),
      "quotedToCity" varchar(100),
      "quotedToState" varchar(50),
      "quotedToPostalCode" varchar(20),
      "quotedToCountry" varchar(2),
      "quotedToName" varchar(200),
      "quotedToPhone" varchar(30),
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "paymentOpenDisputeBlocked" boolean NOT NULL DEFAULT false,
      "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100),
      "shippoShipmentId" varchar(255),
      "shippoRateObjectId" varchar(255),
      "shippoTransactionId" varchar(255),
      "labelUrl" varchar(2048),
      "labelCarrier" varchar(100),
      "labelTrackingNumber" varchar(100),
      "labelClawbackStatus" varchar(50),
      "giftNote" varchar(500),
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "chargedTotalCents" integer,
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role text NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE
    );
    CREATE TABLE public."Case" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL UNIQUE,
      status public."CaseStatus" NOT NULL
    );
    CREATE TABLE public."OrderShippingRateQuote" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL
    );
    CREATE TABLE public."OrderDisputeRecovery" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      status public."OrderDisputeRecoveryStatus" NOT NULL
    );
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY,
      "adminId" text NOT NULL,
      action text NOT NULL,
      "targetType" text NOT NULL,
      "targetId" text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const predecessor = readFileSync(PREDECESSOR_PATH, "utf8");
  await database.exec(extractFunction(
    predecessor,
    "grainline_order_buyer_pii_prune_batch",
  ));
  await database.exec(`
    REVOKE ALL ON FUNCTION
      public.grainline_order_buyer_pii_prune_batch(integer)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_order_buyer_pii_prune_batch(integer)
      TO grainline_app_runtime;
  `);
  const accountDeletion = readFileSync(ACCOUNT_DELETION_PATH, "utf8");
  await database.exec(extractFunction(
    accountDeletion,
    "grainline_order_account_deletion_blockers",
  ));
  const staffMutation = readFileSync(STAFF_MUTATION_PATH, "utf8");
  await database.exec(extractFunction(
    staffMutation,
    "grainline_order_staff_mark_reviewed",
  ));
  await database.exec(`
    REVOKE ALL ON FUNCTION
      public.grainline_order_account_deletion_blockers(text)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION
      public.grainline_order_account_deletion_blockers(text)
      TO grainline_app_runtime;
    REVOKE ALL ON FUNCTION
      public.grainline_order_staff_mark_reviewed(text, text)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_order_staff_mark_reviewed(text, text)
      TO grainline_staff_read_runtime;
    CREATE FUNCTION public.grainline_test_order_review_needed(text)
      RETURNS boolean
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS 'SELECT "reviewNeeded" FROM public."Order" WHERE id = $1';
    REVOKE ALL ON FUNCTION public.grainline_test_order_review_needed(text)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.grainline_test_order_review_needed(text)
      TO grainline_staff_read_runtime;
  `);
  return database;
}

test("shipping evidence stays available through the dispute window and manual review", async () => {
  const database = await predecessorDatabase();
  try {
    await database.exec(readFileSync(MIGRATION_PATH, "utf8"));
    await database.exec(`
      INSERT INTO public."Order" (
        id, "paidAt", "buyerEmail", "buyerName",
        "shipToLine1", "shipToCity", "shipToState", "shipToPostalCode",
        "shipToCountry", "fulfillmentStatus", "deliveredAt",
        "estimatedDeliveryDate", "sellerNotes", "giftNote",
        "quotedToLine1", "quotedToCity", "quotedToState",
        "quotedToPostalCode", "quotedToCountry", "quotedToName",
        "quotedToPhone", "trackingCarrier", "trackingNumber",
        "shippoShipmentId", "shippoRateObjectId", "shippoTransactionId",
        "labelUrl", "labelCarrier", "labelTrackingNumber",
        "labelClawbackStatus", "reviewNeeded", "paymentOpenDisputeBlocked"
      ) VALUES
        (
          'pii-95', CURRENT_TIMESTAMP - INTERVAL '100 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '95 days',
          CURRENT_TIMESTAMP - INTERVAL '90 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-pii-95', 'shipment-pii-95', 'rate-pii-95',
          'transaction-pii-95', 'https://label.example/pii-95', 'UPS',
          'label-pii-95', NULL, false, false
        ),
        (
          'evidence-181', CURRENT_TIMESTAMP - INTERVAL '200 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '190 days',
          CURRENT_TIMESTAMP - INTERVAL '181 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-evidence-181', 'shipment-evidence-181',
          'rate-evidence-181', 'transaction-evidence-181',
          'https://label.example/evidence-181', 'UPS', 'label-evidence-181',
          NULL, false, false
        ),
        (
          'recent-estimate', CURRENT_TIMESTAMP - INTERVAL '200 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '190 days',
          CURRENT_TIMESTAMP - INTERVAL '100 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-recent-estimate', 'shipment-recent-estimate',
          'rate-recent-estimate', 'transaction-recent-estimate',
          'https://label.example/recent-estimate', 'UPS',
          'label-recent-estimate', NULL, false, false
        ),
        (
          'manual-review', CURRENT_TIMESTAMP - INTERVAL '220 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-manual', 'shipment-manual', 'rate-manual',
          'transaction-manual', 'https://label.example/manual', 'UPS',
          'label-manual', 'MANUAL_REVIEW', false, false
        ),
        (
          'open-dispute', CURRENT_TIMESTAMP - INTERVAL '220 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-dispute', 'shipment-dispute', 'rate-dispute',
          'transaction-dispute', 'https://label.example/dispute', 'UPS',
          'label-dispute', NULL, false, true
        ),
        (
          'active-case', CURRENT_TIMESTAMP - INTERVAL '220 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-case', 'shipment-case', 'rate-case',
          'transaction-case', 'https://label.example/case', 'UPS',
          'label-case', NULL, false, false
        ),
        (
          'review-hold', CURRENT_TIMESTAMP - INTERVAL '220 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-review', 'shipment-review', 'rate-review',
          'transaction-review', 'https://label.example/review', 'UPS',
          'label-review', NULL, true, false
        ),
        (
          'active-recovery', CURRENT_TIMESTAMP - INTERVAL '220 days',
          'buyer@example.com', 'Buyer', '1 Main', 'Austin', 'TX', '78701',
          'US', 'DELIVERED', CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days', 'note', 'gift',
          '1 Main', 'Austin', 'TX', '78701', 'US', 'Buyer', '5551112222',
          'UPS', 'tracking-recovery', 'shipment-recovery', 'rate-recovery',
          'transaction-recovery', 'https://label.example/recovery', 'UPS',
          'label-recovery', NULL, false, false
        );

      INSERT INTO public."Case" (id, "orderId", status)
      VALUES ('case-active', 'active-case', 'OPEN');

      INSERT INTO public."OrderDisputeRecovery" (id, "orderId", status)
      VALUES ('recovery-active', 'active-recovery', 'RESTORE_PENDING');

      INSERT INTO public."OrderShippingRateQuote" (id, "orderId")
      SELECT 'quote-' || id, id FROM public."Order";
    `);

    await database.exec("SET ROLE grainline_app_runtime");
    const first = await database.query(
      "SELECT * FROM public.grainline_order_buyer_pii_prune_batch(1000)",
    );
    await database.exec("RESET ROLE");
    assert.equal(Number(first.rows[0].purged), 5);

    const rows = await database.query(`
      SELECT
        id,
        "buyerEmail" AS buyer_email,
        "shipToLine1" AS ship_to_line1,
        "trackingNumber" AS tracking_number,
        "shippoTransactionId" AS shippo_transaction_id,
        "labelUrl" AS label_url,
        "buyerDataPurgedAt" AS buyer_data_purged_at
      FROM public."Order"
      ORDER BY id
    `);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    for (const id of [
      "pii-95",
      "evidence-181",
      "recent-estimate",
      "manual-review",
      "active-recovery",
    ]) {
      assert.equal(byId.get(id).buyer_email, null);
      assert.equal(byId.get(id).ship_to_line1, null);
      assert.ok(byId.get(id).buyer_data_purged_at instanceof Date);
    }
    for (const id of [
      "pii-95",
      "recent-estimate",
      "manual-review",
      "active-recovery",
    ]) {
      assert.notEqual(byId.get(id).tracking_number, null);
      assert.notEqual(byId.get(id).shippo_transaction_id, null);
      assert.notEqual(byId.get(id).label_url, null);
    }
    assert.equal(byId.get("evidence-181").tracking_number, null);
    assert.equal(byId.get("evidence-181").shippo_transaction_id, null);
    assert.equal(byId.get("evidence-181").label_url, null);

    for (const id of ["open-dispute", "active-case", "review-hold"]) {
      assert.notEqual(byId.get(id).buyer_email, null);
      assert.notEqual(byId.get(id).tracking_number, null);
      assert.equal(byId.get(id).buyer_data_purged_at, null);
    }

    const quotes = await database.query(`
      SELECT "orderId" AS order_id
        FROM public."OrderShippingRateQuote"
       ORDER BY "orderId"
    `);
    assert.deepEqual(
      quotes.rows.map((row) => row.order_id),
      ["active-case", "open-dispute", "review-hold"],
    );

    await database.exec(`
      UPDATE public."Order"
         SET "labelClawbackStatus" = 'REVERSED'
       WHERE id = 'manual-review'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const released = await database.query(
      "SELECT * FROM public.grainline_order_buyer_pii_prune_batch(1000)",
    );
    await database.exec("RESET ROLE");
    assert.equal(Number(released.rows[0].purged), 1);
    const manual = await database.query(`
      SELECT "trackingNumber" AS tracking_number,
             "shippoTransactionId" AS shippo_transaction_id,
             "labelUrl" AS label_url
        FROM public."Order"
       WHERE id = 'manual-review'
    `);
    assert.deepEqual(manual.rows[0], {
      tracking_number: null,
      shippo_transaction_id: null,
      label_url: null,
    });

    await database.exec(`
      UPDATE public."OrderDisputeRecovery"
         SET status = 'RESTORED'
       WHERE id = 'recovery-active'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const recoveryReleased = await database.query(
      "SELECT * FROM public.grainline_order_buyer_pii_prune_batch(1000)",
    );
    await database.exec("RESET ROLE");
    assert.equal(Number(recoveryReleased.rows[0].purged), 1);
    const recovered = await database.query(`
      SELECT "trackingNumber" AS tracking_number,
             "shippoTransactionId" AS shippo_transaction_id,
             "labelUrl" AS label_url
        FROM public."Order"
       WHERE id = 'active-recovery'
    `);
    assert.deepEqual(recovered.rows[0], {
      tracking_number: null,
      shippo_transaction_id: null,
      label_url: null,
    });

    await database.exec(`
      INSERT INTO public."User" (id, role) VALUES
        ('delete-buyer', 'USER'),
        ('old-buyer', 'USER'),
        ('manual-buyer', 'USER'),
        ('seller-user', 'USER'),
        ('staff-user', 'ADMIN');
      INSERT INTO public."SellerProfile" (id, "userId")
      VALUES ('seller-profile', 'seller-user');
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "paidAt", "fulfillmentStatus",
        "deliveredAt", "estimatedDeliveryDate", "trackingCarrier",
        "trackingNumber", "shippoTransactionId", "labelUrl",
        "labelClawbackStatus", "reviewNeeded", "paymentOpenDisputeBlocked"
      ) VALUES
        (
          'deletion-window', 'delete-buyer', NULL,
          CURRENT_TIMESTAMP - INTERVAL '100 days', 'DELIVERED',
          CURRENT_TIMESTAMP - INTERVAL '95 days',
          CURRENT_TIMESTAMP - INTERVAL '90 days',
          'UPS', 'tracking-deletion-window', 'transaction-deletion-window',
          'https://label.example/deletion-window', NULL, false, false
        ),
        (
          'deletion-old', 'old-buyer', NULL,
          CURRENT_TIMESTAMP - INTERVAL '220 days', 'DELIVERED',
          CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days',
          'UPS', 'tracking-deletion-old', 'transaction-deletion-old',
          'https://label.example/deletion-old', NULL, false, false
        ),
        (
          'deletion-manual', 'manual-buyer', NULL,
          CURRENT_TIMESTAMP - INTERVAL '220 days', 'DELIVERED',
          CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days',
          'UPS', 'tracking-deletion-manual', 'transaction-deletion-manual',
          'https://label.example/deletion-manual', 'MANUAL_REVIEW', true, false
        ),
        (
          'seller-window', NULL, 'seller-profile',
          CURRENT_TIMESTAMP - INTERVAL '100 days', 'DELIVERED',
          CURRENT_TIMESTAMP - INTERVAL '95 days',
          CURRENT_TIMESTAMP - INTERVAL '90 days',
          'UPS', 'tracking-seller-window', 'transaction-seller-window',
          'https://label.example/seller-window', NULL, false, false
        ),
        (
          'staff-manual', NULL, NULL,
          CURRENT_TIMESTAMP - INTERVAL '220 days', 'DELIVERED',
          CURRENT_TIMESTAMP - INTERVAL '210 days',
          CURRENT_TIMESTAMP - INTERVAL '200 days',
          NULL, NULL, NULL, NULL, 'MANUAL_REVIEW', true, false
        );
    `);

    async function deletionBlockers(actor) {
      await database.exec(`SET app.user_id = '${actor}'; SET ROLE grainline_app_runtime`);
      const result = await database.query(
        "SELECT * FROM public.grainline_order_account_deletion_blockers($1)",
        [actor],
      );
      await database.exec("RESET ROLE; RESET app.user_id");
      return result.rows[0];
    }
    assert.deepEqual(await deletionBlockers("delete-buyer"), {
      buyer_order_count: 1,
      seller_order_count: 0,
    });
    assert.deepEqual(await deletionBlockers("old-buyer"), {
      buyer_order_count: 0,
      seller_order_count: 0,
    });
    assert.deepEqual(await deletionBlockers("manual-buyer"), {
      buyer_order_count: 1,
      seller_order_count: 0,
    });
    assert.deepEqual(await deletionBlockers("seller-user"), {
      buyer_order_count: 0,
      seller_order_count: 1,
    });

    await database.exec("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    const reviewed = await database.query(
      "SELECT public.grainline_order_staff_mark_reviewed($1, $2) AS status",
      ["staff-user", "staff-manual"],
    );
    await database.exec("RESET SESSION AUTHORIZATION");
    assert.equal(reviewed.rows[0].status, "unchanged");
    const manualReview = await database.query(
      "SELECT public.grainline_test_order_review_needed($1) AS review_needed",
      ["staff-manual"],
    );
    assert.equal(manualReview.rows[0].review_needed, true);

    const catalog = await database.query(`
      SELECT
        routine.prosecdef AS security_definer,
        routine.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', routine.oid, 'EXECUTE'
        ) AS runtime_execute,
        EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                routine.proacl,
                pg_catalog.acldefault('f', routine.proowner)
              )
            ) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid =
        'public.grainline_order_buyer_pii_prune_batch(integer)'::pg_catalog.regprocedure
    `);
    assert.deepEqual(catalog.rows[0], {
      security_definer: true,
      function_config: ["search_path=pg_catalog"],
      runtime_execute: true,
      public_execute: false,
    });
  } finally {
    await database.close();
  }
});
