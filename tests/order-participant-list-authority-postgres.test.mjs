import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260831233000_prepare_order_participant_list_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
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
      "shippingTitle" text,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer,
      "sellerRefundAmountCents" integer,
      "fulfillmentStatus" text NOT NULL DEFAULT 'PENDING',
      "sellerNotes" text,
      "buyerName" text,
      "buyerEmail" text,
      "buyerDataPurgedAt" timestamp(3) without time zone
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Order"
      TO grainline_app_runtime;
    GRANT SELECT ON TABLE public."User", public."SellerProfile"
      TO grainline_app_runtime;

    INSERT INTO public."User" (id, "deletedAt") VALUES
      ('buyer-1', NULL),
      ('buyer-2', NULL),
      ('buyer-deleted', '2026-08-31 12:00:00.000'),
      ('seller-user-1', NULL),
      ('seller-user-2', NULL);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'),
      ('seller-2', 'seller-user-2');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt", currency,
      "itemsSubtotalCents", "shippingTitle", "shippingAmountCents",
      "taxAmountCents", "giftWrappingPriceCents", "sellerRefundAmountCents",
      "fulfillmentStatus", "sellerNotes", "buyerName", "buyerEmail",
      "buyerDataPurgedAt"
    ) VALUES
      (
        'order-1', 'buyer-1', 'seller-1',
        '2026-08-31 10:00:00.000', '2026-08-31 10:01:00.000', 'usd',
        500, 'Ground', 100, 50, NULL, NULL, 'PENDING', NULL,
        'Buyer One', 'buyer1@example.test', NULL
      ),
      (
        'order-2', 'buyer-1', 'seller-1',
        '2026-08-31 11:00:00.000', '2026-08-31 11:01:00.000', 'usd',
        700, 'Pickup', 0, 0, 25, 100, 'DELIVERED', 'Private note',
        'Buyer One', 'buyer1@example.test', NULL
      ),
      (
        'order-3', 'buyer-2', 'seller-2',
        '2026-08-31 09:00:00.000', NULL, 'usd',
        900, NULL, 0, 0, NULL, NULL, 'PENDING', NULL,
        'Buyer Two', 'buyer2@example.test', NULL
      ),
      (
        'order-4', 'buyer-deleted', 'seller-1',
        '2026-08-31 08:00:00.000', '2026-08-31 08:01:00.000', 'usd',
        300, 'Ground', 50, 20, NULL, NULL, 'SHIPPED', NULL,
        'Deleted Name', 'deleted@example.test', NULL
      );
  `);
  await database.exec(migration);
  return database;
}

describe("Order participant list authority", () => {
  it("isolates buyer counts and keyset pages with a fixed projection", async () => {
    const database = await createDatabase();
    try {
      const count = await database.query(
        "SELECT public.grainline_order_buyer_count($1) AS value",
        ["buyer-1"],
      );
      assert.equal(Number(count.rows[0].value), 2);

      const first = await database.query(`
        SELECT * FROM public.grainline_order_buyer_page(
          'buyer-1', 1, NULL, NULL
        )
      `);
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].order_id, "order-2");
      assert.deepEqual(Object.keys(first.rows[0]).sort(), [
        "created_at_epoch_millis",
        "currency",
        "fulfillment_status",
        "gift_wrapping_price_cents",
        "items_subtotal_cents",
        "order_id",
        "paid_at_epoch_millis",
        "seller_refund_amount_cents",
        "shipping_amount_cents",
        "shipping_title",
        "tax_amount_cents",
      ]);

      const second = await database.query(
        `SELECT * FROM public.grainline_order_buyer_page($1, 1, $2, $3)`,
        ["buyer-1", first.rows[0].created_at_epoch_millis, first.rows[0].order_id],
      );
      assert.equal(second.rows[0].order_id, "order-1");

      const foreign = await database.query(`
        SELECT * FROM public.grainline_order_buyer_page(
          'buyer-2', 100, NULL, NULL
        )
      `);
      assert.deepEqual(foreign.rows.map((row) => row.order_id), ["order-3"]);
    } finally {
      await database.close();
    }
  });

  it("isolates durable sellers and suppresses deleted-buyer labels", async () => {
    const database = await createDatabase();
    try {
      const count = await database.query(
        "SELECT public.grainline_order_seller_count($1) AS value",
        ["seller-user-1"],
      );
      assert.equal(Number(count.rows[0].value), 3);

      const seller = await database.query(`
        SELECT * FROM public.grainline_order_seller_page(
          'seller-user-1', 100, NULL, NULL
        )
      `);
      assert.deepEqual(Object.keys(seller.rows[0]).sort(), [
        "buyer_data_purged_at_epoch_millis",
        "buyer_deleted_at_epoch_millis",
        "buyer_email",
        "buyer_name",
        "created_at_epoch_millis",
        "currency",
        "fulfillment_status",
        "gift_wrapping_price_cents",
        "items_subtotal_cents",
        "order_id",
        "paid_at_epoch_millis",
        "seller_notes_present",
        "seller_refund_amount_cents",
        "shipping_amount_cents",
        "shipping_title",
        "tax_amount_cents",
      ]);
      assert.deepEqual(
        seller.rows.map((row) => row.order_id),
        ["order-2", "order-1", "order-4"],
      );
      assert.equal(seller.rows[0].seller_notes_present, true);
      assert.equal(seller.rows[2].buyer_name, null);
      assert.equal(seller.rows[2].buyer_email, null);

      const foreign = await database.query(`
        SELECT * FROM public.grainline_order_seller_page(
          'seller-user-2', 100, NULL, NULL
        )
      `);
      assert.deepEqual(foreign.rows.map((row) => row.order_id), ["order-3"]);
    } finally {
      await database.close();
    }
  });

  it("rejects malformed bounds and exposes EXECUTE only to runtime", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_buyer_page(
            'buyer-1', 101, NULL, NULL
          )
        `),
        /input is invalid/i,
      );
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_order_seller_page(
            'seller-user-1', 10, 1000, NULL
          )
        `),
        /input is invalid/i,
      );

      for (const identity of [
        "grainline_order_buyer_count(text)",
        "grainline_order_buyer_page(text,integer,bigint,text)",
        "grainline_order_seller_count(text)",
        "grainline_order_seller_page(text,integer,bigint,text)",
      ]) {
        const privileges = await database.query(`
          SELECT
            pg_catalog.has_function_privilege(
              'grainline_app_runtime',
              '${identity}',
              'EXECUTE'
            ) AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_proc AS procedure
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner)
                  )
                ) AS acl
               WHERE procedure.oid = pg_catalog.to_regprocedure('${identity}')
                 AND acl.grantee = 0
                 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
        `);
        assert.equal(privileges.rows[0].runtime_execute, true, identity);
        assert.equal(privileges.rows[0].public_execute, false, identity);
      }
    } finally {
      await database.close();
    }
  });
});
