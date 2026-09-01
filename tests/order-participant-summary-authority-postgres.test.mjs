import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901080000_prepare_order_participant_summary_authority/migration.sql",
  "utf8",
);
const cursorMigration = readFileSync(
  "prisma/migrations/20260901090000_prepare_order_participant_cursor_authority/migration.sql",
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
      "buyerDataPurgedAt" timestamp(3) without time zone,
      "labelCarrier" text,
      "labelTrackingNumber" text
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "listingId" text NOT NULL,
      "priceCents" integer NOT NULL,
      quantity integer NOT NULL,
      "listingSnapshot" jsonb,
      "createdAt" timestamp(3) without time zone NOT NULL
    );

    INSERT INTO public."User" (id, "deletedAt") VALUES
      ('buyer-1', NULL), ('buyer-2', NULL),
      ('seller-user-1', NULL), ('seller-user-2', NULL);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'seller-user-1'), ('seller-2', 'seller-user-2');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
      "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents",
      "fulfillmentStatus", "buyerName", "buyerEmail",
      "labelCarrier", "labelTrackingNumber"
    ) VALUES
      ('order-1', 'buyer-1', 'seller-1', '2026-08-31 11:00:00', '2026-08-31 11:01:00', 1500, 100, 50, 'SHIPPED', 'Buyer One', 'buyer1@example.test', 'UPS', 'TRACK-1'),
      ('order-2', 'buyer-2', 'seller-2', '2026-08-31 10:00:00', NULL, 900, 0, 0, 'PENDING', 'Buyer Two', 'buyer2@example.test', NULL, NULL),
      ('order-3', 'buyer-1', 'seller-1', '2026-08-31 09:00:00', '2026-08-31 09:01:00', 700, 0, 0, 'DELIVERED', 'Buyer One', 'buyer1@example.test', NULL, NULL),
      ('order-4', 'buyer-1', 'seller-1', '2026-08-31 08:00:00', '2026-08-31 08:01:00', 600, 0, 0, 'DELIVERED', 'Buyer One', 'buyer1@example.test', NULL, NULL);
  `);
  for (let index = 1; index <= 6; index += 1) {
    await database.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", "priceCents", quantity,
        "listingSnapshot", "createdAt"
      ) VALUES ($1, 'order-1', $2, 250, 1, $3, $4)
    `, [
      `item-${index}`,
      `listing-${index}`,
      JSON.stringify({
        title: `Historical item ${index}`,
        description: null,
        priceCents: 250,
        imageUrls: [`https://example.test/${index}.jpg`],
        category: "FURNITURE",
        tags: [],
        sellerName: "Maker One",
        capturedAt: "2026-08-31T11:00:00.000Z",
      }),
      `2026-08-31 11:0${index}:00`,
    ]);
  }
  await database.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "priceCents", quantity,
      "listingSnapshot", "createdAt"
    ) VALUES ('foreign-item', 'order-2', 'foreign-listing', 900, 1, '{}', '2026-08-31 10:01:00')
  `);
  await database.exec(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "priceCents", quantity,
      "listingSnapshot", "createdAt"
    ) VALUES
      ('item-order-3', 'order-3', 'listing-order-3', 700, 1,
       '{"title":"Historical three","imageUrls":[],"sellerName":"Maker One"}', '2026-08-31 09:01:00'),
      ('item-order-4', 'order-4', 'listing-order-4', 600, 1,
       '{"title":"Historical four","imageUrls":[],"sellerName":"Maker One"}', '2026-08-31 08:01:00');
  `);
  await database.exec(migration);
  await database.exec(cursorMigration);
  return database;
}

describe("Order participant summary authority", () => {
  it("returns bounded historical summaries without cross-participant rows", async () => {
    const database = await createDatabase();
    try {
      const buyer = await database.query(`
        SELECT * FROM public.grainline_order_buyer_summary_page(
          'buyer-1', 20, NULL, NULL
        )
      `);
      assert.equal(buyer.rows.length, 3);
      assert.equal(buyer.rows[0].order_id, "order-1");
      assert.equal(buyer.rows[0].item_count, 6);
      assert.equal(buyer.rows[0].items.length, 5);
      assert.equal(buyer.rows[0].items[0].title, "Historical item 1");
      assert.equal(buyer.rows[0].items[0].imageUrl, "https://example.test/1.jpg");
      assert.equal(buyer.rows[0].items[0].sellerName, "Maker One");
      assert.equal("listingSnapshot" in buyer.rows[0].items[0], false);
      assert.equal(buyer.rows[0].label_tracking_number, "TRACK-1");

      const foreign = await database.query(`
        SELECT * FROM public.grainline_order_buyer_summary_page(
          'buyer-2', 20, NULL, NULL
        )
      `);
      assert.deepEqual(foreign.rows.map((row) => row.order_id), ["order-2"]);

      const seller = await database.query(`
        SELECT * FROM public.grainline_order_seller_summary_page(
          'seller-user-1', 20, NULL, NULL
        )
      `);
      assert.deepEqual(
        seller.rows.map((row) => row.order_id),
        ["order-1", "order-3", "order-4"],
      );
      assert.equal(seller.rows[0].buyer_email, "buyer1@example.test");
    } finally {
      await database.close();
    }
  });

  it("returns exact newer pages in descending UI order without OFFSET", async () => {
    const database = await createDatabase();
    try {
      const older = await database.query(`
        SELECT * FROM public.grainline_order_buyer_summary_page(
          'buyer-1', 2, NULL, NULL
        )
      `);
      assert.deepEqual(older.rows.map((row) => row.order_id), ["order-1", "order-3"]);

      const finalPage = await database.query(`
        SELECT * FROM public.grainline_order_buyer_summary_page(
          'buyer-1', 2, 1788166800000, 'order-3'
        )
      `);
      assert.deepEqual(finalPage.rows.map((row) => row.order_id), ["order-4"]);

      const previous = await database.query(`
        SELECT * FROM public.grainline_order_buyer_summary_after_page(
          'buyer-1', 2, 1788163200000, 'order-4'
        )
      `);
      assert.deepEqual(previous.rows.map((row) => row.order_id), ["order-1", "order-3"]);

      const sellerPrevious = await database.query(`
        SELECT * FROM public.grainline_order_seller_summary_after_page(
          'seller-user-1', 2, 1788163200000, 'order-4'
        )
      `);
      assert.deepEqual(sellerPrevious.rows.map((row) => row.order_id), ["order-1", "order-3"]);
    } finally {
      await database.close();
    }
  });

  it("keeps the helper private and grants only the two fixed pages", async () => {
    const database = await createDatabase();
    try {
      for (const identity of [
        "grainline_order_summary_items(text)",
        "grainline_order_buyer_summary_page(text,integer,bigint,text)",
        "grainline_order_seller_summary_page(text,integer,bigint,text)",
        "grainline_order_buyer_summary_after_page(text,integer,bigint,text)",
        "grainline_order_seller_summary_after_page(text,integer,bigint,text)",
      ]) {
        const privileges = await database.query(`
          SELECT
            pg_catalog.has_function_privilege(
              'grainline_app_runtime', '${identity}', 'EXECUTE'
            ) AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_proc AS procedure
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
                ) AS acl
               WHERE procedure.oid = pg_catalog.to_regprocedure('${identity}')
                 AND acl.grantee = 0
                 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
        `);
        assert.equal(
          privileges.rows[0].runtime_execute,
          !identity.startsWith("grainline_order_summary_items"),
          identity,
        );
        assert.equal(privileges.rows[0].public_execute, false, identity);
      }
    } finally {
      await database.close();
    }
  });
});
