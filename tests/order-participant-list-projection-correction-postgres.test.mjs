import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const predecessor = readFileSync(
  "prisma/migrations/20260831233000_prepare_order_participant_list_authority/migration.sql",
  "utf8",
);
const correction = readFileSync(
  "prisma/migrations/20260901155000_correct_order_participant_list_projection/migration.sql",
  "utf8",
);

async function createRealSchemaDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "createdAt" timestamp(3) without time zone NOT NULL,
      "paidAt" timestamp(3) without time zone,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingTitle" varchar(200),
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      "sellerRefundAmountCents" integer,
      "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "sellerNotes" text,
      "buyerName" varchar(200),
      "buyerEmail" varchar(254),
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order"
      TO grainline_app_runtime;
    GRANT SELECT ON TABLE public."User", public."SellerProfile"
      TO grainline_app_runtime;
    INSERT INTO public."User" (id, "deletedAt") VALUES
      ('buyer-real', NULL),
      ('seller-real', NULL);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-profile-real', 'seller-real');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", currency,
      "itemsSubtotalCents", "shippingTitle", "shippingAmountCents",
      "taxAmountCents", "fulfillmentStatus", "buyerName", "buyerEmail"
    ) VALUES (
      'order-real', 'buyer-real', 'seller-profile-real',
      '2026-09-01 15:00:00.000', '2026-09-01 15:01:00.000', 'usd',
      500, 'Ground', 50, 40, 'PENDING', 'Buyer Real', 'buyer@example.test'
    );
  `);
  await database.exec(predecessor);
  return database;
}

test("real varchar Order schema reproduces the predecessor defect and correction closes it", async () => {
  const database = await createRealSchemaDatabase();
  try {
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_order_buyer_page('buyer-real', 10, NULL, NULL)",
      ),
      /structure of query does not match function result type/i,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_order_seller_page('seller-real', 10, NULL, NULL)",
      ),
      /structure of query does not match function result type/i,
    );

    await database.exec(correction);

    const buyer = await database.query(
      "SELECT * FROM public.grainline_order_buyer_page('buyer-real', 10, NULL, NULL)",
    );
    assert.equal(buyer.rows.length, 1);
    assert.equal(buyer.rows[0].shipping_title, "Ground");
    const seller = await database.query(
      "SELECT * FROM public.grainline_order_seller_page('seller-real', 10, NULL, NULL)",
    );
    assert.equal(seller.rows.length, 1);
    assert.equal(seller.rows[0].shipping_title, "Ground");
    assert.equal(seller.rows[0].buyer_name, "Buyer Real");
    assert.equal(seller.rows[0].buyer_email, "buyer@example.test");

    for (const identity of [
      "grainline_order_buyer_page(text,integer,bigint,text)",
      "grainline_order_seller_page(text,integer,bigint,text)",
    ]) {
      const acl = await database.query(`
        SELECT
          pg_catalog.has_function_privilege(
            'grainline_app_runtime', '${identity}', 'EXECUTE'
          ) AS runtime_execute,
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc AS procedure
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
                )
              ) AS exploded
             WHERE procedure.oid = pg_catalog.to_regprocedure('${identity}')
               AND exploded.grantee = 0
               AND exploded.privilege_type = 'EXECUTE'
          ) AS public_execute
      `);
      assert.equal(acl.rows[0].runtime_execute, true, identity);
      assert.equal(acl.rows[0].public_execute, false, identity);
    }
  } finally {
    await database.close();
  }
});
