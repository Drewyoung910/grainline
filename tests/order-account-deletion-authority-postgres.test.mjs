import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'PICKED_UP', 'CANCELED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      "deletedAt" timestamp(3) without time zone,
      "shippingName" varchar(100),
      "shippingLine1" varchar(200),
      "shippingLine2" varchar(200),
      "shippingCity" varchar(100),
      "shippingState" varchar(50),
      "shippingPostalCode" varchar(20),
      "shippingPhone" varchar(30)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      city varchar(100),
      state varchar(50),
      "shipFromName" varchar(100),
      "shipFromLine1" varchar(200),
      "shipFromLine2" varchar(200),
      "shipFromCity" varchar(100),
      "shipFromState" varchar(50),
      "shipFromPostal" varchar(20),
      tagline varchar(140),
      "bannerImageUrl" varchar(2048),
      "avatarImageUrl" varchar(2048),
      "workshopImageUrl" varchar(2048),
      "instagramUrl" varchar(2048),
      "facebookUrl" varchar(2048),
      "pinterestUrl" varchar(2048),
      "tiktokUrl" varchar(2048),
      "websiteUrl" varchar(2048)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
      "deliveredAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone,
      "sellerRefundId" varchar(255),
      "sellerRefundAmountCents" integer,
      "chargedTotalCents" integer,
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "reviewNote" varchar(10000),
      "buyerEmail" varchar(254),
      "buyerName" varchar(200),
      "shipToLine1" varchar(200),
      "shipToLine2" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "quotedToLine1" varchar(200),
      "quotedToLine2" varchar(200),
      "quotedToCity" varchar(100),
      "quotedToState" varchar(50),
      "quotedToPostalCode" varchar(20),
      "quotedToCountry" varchar(2),
      "quotedToName" varchar(200),
      "quotedToPhone" varchar(30),
      "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100),
      "sellerNotes" varchar(2000),
      "shippoShipmentId" varchar(255),
      "shippoRateObjectId" varchar(255),
      "shippoTransactionId" varchar(255),
      "labelUrl" varchar(2048),
      "labelCarrier" varchar(100),
      "labelTrackingNumber" varchar(100),
      "giftNote" varchar(500),
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE INDEX "Order_buyerId_idx" ON public."Order"("buyerId");
    CREATE INDEX "Order_sellerProfileId_idx" ON public."Order"("sellerProfileId");
    CREATE TABLE public."OrderShippingRateQuote" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE
    );
    CREATE INDEX "OrderShippingRateQuote_orderId_idx"
      ON public."OrderShippingRateQuote"("orderId");

    CREATE FUNCTION public.grainline_account_deletion_redact_text_core(
      p_body text,
      p_sensitive_values text[]
    ) RETURNS text
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
    AS $redact$
    DECLARE value text; result text := p_body;
    BEGIN
      IF p_body IS NULL THEN RETURN NULL; END IF;
      FOREACH value IN ARRAY COALESCE(p_sensitive_values, ARRAY[]::text[]) LOOP
        result := pg_catalog.replace(result, value, '[deleted account]');
      END LOOP;
      RETURN result;
    END
    $redact$;
    REVOKE ALL ON FUNCTION public.grainline_account_deletion_redact_text_core(text, text[])
      FROM PUBLIC, grainline_app_runtime;

    INSERT INTO public."User" (
      id, "clerkId", email, name, "shippingName", "shippingLine1",
      "shippingCity", "shippingState", "shippingPostalCode", "shippingPhone"
    ) VALUES
      ('buyer-1', 'clerk-buyer-1', 'buyer@example.test', 'Buyer One', 'Buyer One',
       '1 Private Lane', 'Austin', 'TX', '78701', '5125550100'),
      ('seller-user-1', 'clerk-seller-1', 'seller@example.test', 'Seller One', NULL,
       NULL, NULL, NULL, NULL, NULL),
      ('other-1', 'clerk-other-1', 'other@example.test', 'Other One', NULL,
       NULL, NULL, NULL, NULL, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", city, state, "shipFromName", "shipFromLine1",
      "shipFromCity", "shipFromState", "shipFromPostal", tagline
    ) VALUES (
      'seller-1', 'seller-user-1', 'Seller One Shop', 'Austin', 'TX', 'Seller One',
      '2 Seller Lane', 'Austin', 'TX', '78702', 'Private seller tagline'
    );
  `);
  await database.exec(migration);
  return database;
}

async function asActor(database, actor, sql, params = []) {
  await database.exec("SET ROLE grainline_app_runtime");
  await database.exec("BEGIN");
  try {
    await database.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [actor]);
    const result = await database.query(sql, params);
    await database.exec("COMMIT");
    return result;
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  } finally {
    await database.exec("RESET ROLE");
  }
}

describe("Order account-deletion PostgreSQL authority", () => {
  it("denies PUBLIC and forged actor context", async () => {
    const database = await createDatabase();
    try {
      const privileges = await database.query(`
        SELECT
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc AS procedure
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
                )
              ) AS privilege
             WHERE procedure.oid = 'public.grainline_order_account_deletion_blockers(text)'::regprocedure
               AND privilege.grantee = 0
               AND privilege.privilege_type = 'EXECUTE'
          ) AS public_blockers,
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc AS procedure
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
                )
              ) AS privilege
             WHERE procedure.oid = 'public.grainline_order_account_deletion_scrub(text,text[])'::regprocedure
               AND privilege.grantee = 0
               AND privilege.privilege_type = 'EXECUTE'
          ) AS public_scrub,
          pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            'public.grainline_order_account_deletion_blockers(text)',
            'EXECUTE'
          ) AS runtime_blockers
      `);
      assert.deepEqual(privileges.rows[0], {
        public_blockers: false,
        public_scrub: false,
        runtime_blockers: true,
      });
      await assert.rejects(
        asActor(
          database,
          "buyer-1",
          "SELECT * FROM public.grainline_order_account_deletion_blockers($1)",
          ["other-1"],
        ),
        /actor context is invalid/i,
      );
    } finally {
      await database.close();
    }
  });

  it("uses durable participants and provider-signed charged totals", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        INSERT INTO public."Order" (
          id, "buyerId", "sellerProfileId", "fulfillmentStatus",
          "sellerRefundId", "sellerRefundAmountCents", "chargedTotalCents",
          "itemsSubtotalCents", "shippingAmountCents", "giftWrappingPriceCents",
          "taxAmountCents"
        ) VALUES
          ('signed-full-refund', 'buyer-1', 'seller-1', 'SHIPPED',
           're_signed', 500, 500, 500, 100, 0, 0),
          ('legacy-under-refund', 'buyer-1', 'seller-1', 'SHIPPED',
           're_legacy', 500, NULL, 500, 100, 0, 0),
          ('pending-refund', 'other-1', 'seller-1', 'SHIPPED',
           'pending', 600, 600, 600, 0, 0, 0),
          ('other-order', 'other-1', NULL, 'SHIPPED',
           NULL, NULL, 500, 500, 0, 0, 0);
      `);
      const buyer = await asActor(
        database,
        "buyer-1",
        "SELECT * FROM public.grainline_order_account_deletion_blockers($1)",
        ["buyer-1"],
      );
      assert.equal(Number(buyer.rows[0].buyer_order_count), 1);
      assert.equal(Number(buyer.rows[0].seller_order_count), 0);

      const seller = await asActor(
        database,
        "seller-user-1",
        "SELECT * FROM public.grainline_order_account_deletion_blockers($1)",
        ["seller-user-1"],
      );
      assert.equal(Number(seller.rows[0].buyer_order_count), 0);
      assert.equal(Number(seller.rows[0].seller_order_count), 2);
    } finally {
      await database.close();
    }
  });

  it("rechecks blockers and scrubs only the actor's durable Order family", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        INSERT INTO public."Order" (
          id, "buyerId", "sellerProfileId", "fulfillmentStatus", "deliveredAt",
          "chargedTotalCents", "itemsSubtotalCents", "reviewNote", "buyerEmail",
          "buyerName", "shipToLine1", "trackingNumber", "sellerNotes",
          "shippoShipmentId", "labelUrl", "giftNote"
        ) VALUES
          ('blocked', 'buyer-1', 'seller-1', 'PENDING', NULL,
           500, 500, 'Buyer One at 1 Private Lane', 'buyer@example.test',
           'Buyer One', '1 Private Lane', 'track-private', 'seller note',
           'ship-private', 'https://private.test/label', 'gift private'),
          ('other', 'other-1', NULL, 'DELIVERED', '2026-01-01',
           500, 500, 'Other One', 'other@example.test', 'Other One', NULL,
           'other-track', 'other note', NULL, NULL, NULL);
        INSERT INTO public."OrderShippingRateQuote" (id, "orderId") VALUES
          ('quote-blocked', 'blocked'), ('quote-other', 'other');
      `);
      await assert.rejects(
        asActor(
          database,
          "buyer-1",
          "SELECT * FROM public.grainline_order_account_deletion_scrub($1, $2::text[])",
          ["buyer-1", ["track-private"]],
        ),
        /obligations changed/i,
      );
      const unchanged = await database.query(
        `SELECT "buyerEmail" FROM public."Order" WHERE id = 'blocked'`,
      );
      assert.equal(unchanged.rows[0].buyerEmail, "buyer@example.test");

      await database.exec(`
        UPDATE public."Order"
           SET "fulfillmentStatus" = 'DELIVERED', "deliveredAt" = '2026-01-01'
         WHERE id = 'blocked';
      `);
      const scrub = await asActor(
        database,
        "buyer-1",
        "SELECT * FROM public.grainline_order_account_deletion_scrub($1, $2::text[])",
        ["buyer-1", ["track-private"]],
      );
      assert.equal(Number(scrub.rows[0].review_notes_redacted), 1);
      assert.equal(Number(scrub.rows[0].buyer_orders_scrubbed), 1);
      assert.equal(Number(scrub.rows[0].shipping_quotes_deleted), 1);

      const rows = await database.query(`
        SELECT id, "reviewNote", "buyerEmail", "trackingNumber", "buyerDataPurgedAt"
          FROM public."Order"
         ORDER BY id
      `);
      const actorOrder = rows.rows.find((row) => row.id === "blocked");
      const otherOrder = rows.rows.find((row) => row.id === "other");
      assert.equal(actorOrder.buyerEmail, null);
      assert.equal(actorOrder.trackingNumber, null);
      assert.match(actorOrder.reviewNote, /\[deleted account\]/);
      assert.ok(actorOrder.buyerDataPurgedAt);
      assert.equal(otherOrder.buyerEmail, "other@example.test");
      assert.equal(otherOrder.trackingNumber, "other-track");
      const quotes = await database.query(
        `SELECT id FROM public."OrderShippingRateQuote" ORDER BY id`,
      );
      assert.deepEqual(quotes.rows, [{ id: "quote-other" }]);
    } finally {
      await database.close();
    }
  });
});
