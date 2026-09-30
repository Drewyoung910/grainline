import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { paidCheckoutFixtureSql, provider } from "./helpers/order-paid-checkout-fixture.mjs";

function migrationSource(candidates, label) {
  const path = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(path, `${label} migration source must be available`);
  return fs.readFileSync(path, "utf8");
}

const predecessor = migrationSource([
  process.env.ORDER_PRIVATE_CUSTOM_PAID_STATE_MIGRATION_PATH,
  "prisma/migrations/20260930031000_mark_paid_private_listing_sold/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-private-custom-paid-state/migration.sql`
    : null,
], "paid-checkout predecessor");
const correction = migrationSource([
  process.env.ORDER_BLOCKED_PAIR_CHECKOUT_MIGRATION_PATH,
  "prisma/migrations/20260930032000_block_checkout_user_pairs/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-blocked-pair-checkout/migration.sql`
    : null,
], "blocked-pair checkout");

function paidDefinition(sql) {
  const name = "grainline_stripe_checkout_order_create";
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0);
  const marker = `$${name}$;`;
  const end = sql.indexOf(marker, start);
  assert.ok(end > start);
  return sql.slice(start, end + marker.length);
}

function functionDefinition(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0);
  const marker = `$${name}$;`;
  const end = sql.indexOf(marker, start);
  assert.ok(end > start);
  return sql.slice(start, end + marker.length);
}

it("holds either reciprocal block as a durable review/refund Order", async () => {
  const db = new PGlite();
  try {
    await db.exec(paidCheckoutFixtureSql());
    await db.exec(`
      CREATE TABLE public."Block" (
        id text PRIMARY KEY,
        "blockerId" text NOT NULL REFERENCES public."User"(id),
        "blockedId" text NOT NULL REFERENCES public."User"(id),
        UNIQUE ("blockerId", "blockedId")
      );
    `);
    await db.exec(predecessor);
    await db.exec(paidDefinition(correction));

    const paidAt = (await db.query(
      `SELECT (CURRENT_TIMESTAMP - interval '1 minute')::timestamp AS paid_at`,
    )).rows[0].paid_at;

    for (const [blockerId, blockedId] of [
      ["buyer-1", "seller-user"],
      ["seller-user", "buyer-1"],
    ]) {
      await db.exec("BEGIN");
      try {
        await db.query(
          `INSERT INTO public."Block" (id, "blockerId", "blockedId") VALUES ($1, $2, $3)`,
          [`block-${blockerId}`, blockerId, blockedId],
        );
        await db.exec("SET LOCAL ROLE grainline_app_runtime");
        const result = (await db.query(`
          SELECT * FROM public.grainline_stripe_checkout_order_create(
            'evt_paid_order', 1, 'reservation-1', 'cs_test_proof',
            $1::timestamp, $2::jsonb
          )
        `, [paidAt, JSON.stringify(provider())])).rows[0];
        assert.equal(result.outcome, "created");
        assert.match(result.invalid_reason, /could not transact at payment completion/u);
        assert.deepEqual(result.invalid_seller_user_ids, []);
        await db.exec("RESET ROLE");

        const order = (await db.query(`
          SELECT "reviewNeeded" AS review_needed, "reviewNote" AS review_note
            FROM public."Order" WHERE id = $1
        `, [result.order_id])).rows[0];
        assert.equal(order.review_needed, true);
        assert.match(order.review_note, /could not transact at payment completion/u);
      } finally {
        await db.exec("ROLLBACK");
      }
    }
  } finally {
    await db.close();
  }
});

it("rolls back cart and single reservations for either reciprocal block direction", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TABLE public."User" (id text PRIMARY KEY);
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id)
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
        "listingType" text NOT NULL
      );
      CREATE TABLE public."Block" (
        id text PRIMARY KEY,
        "blockerId" text NOT NULL REFERENCES public."User"(id),
        "blockedId" text NOT NULL REFERENCES public."User"(id),
        UNIQUE ("blockerId", "blockedId")
      );
      CREATE TABLE public."CheckoutStockReservation" (
        id text PRIMARY KEY,
        "checkoutLockKey" text,
        "payloadHash" text,
        "buyerId" text,
        "sellerId" text,
        status text,
        "reservedItems" jsonb,
        "sourceSnapshot" jsonb,
        "stripeSessionId" text,
        "expiresAt" timestamp(3) without time zone,
        "createdAt" timestamp(3) without time zone,
        "updatedAt" timestamp(3) without time zone
      );
      INSERT INTO public."User" (id) VALUES ('buyer-1'), ('seller-user');
      INSERT INTO public."SellerProfile" (id, "userId") VALUES ('seller-1', 'seller-user');
      INSERT INTO public."Listing" (id, "sellerId", "listingType")
      VALUES ('listing-1', 'seller-1', 'IN_STOCK');

      CREATE FUNCTION public.grainline_checkout_reservation_listing_snapshot_witness(text)
      RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
      AS $$ SELECT '{}'::jsonb $$;

      CREATE FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
        text, text, text, text, text, jsonb
      ) RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
      BEGIN
        PERFORM actor.id FROM public."User" AS actor
         WHERE actor.id IN ($1, 'seller-user') ORDER BY actor.id FOR SHARE;
        INSERT INTO public."CheckoutStockReservation" (
          id, "payloadHash", "buyerId", "sellerId", status, "reservedItems", "expiresAt"
        ) VALUES ('cart-reservation', $5, $1, $3, 'RESERVED', '[]'::jsonb, CURRENT_TIMESTAMP);
        RETURN QUERY SELECT 'cart-reservation'::text, '[]'::jsonb, CURRENT_TIMESTAMP::timestamp(3);
      END $$;

      CREATE FUNCTION public.grainline_checkout_reservation_create_single_consistent(
        text, text, integer, text[], text, jsonb
      ) RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
      BEGIN
        PERFORM actor.id FROM public."User" AS actor
         WHERE actor.id IN ($1, 'seller-user') ORDER BY actor.id FOR SHARE;
        INSERT INTO public."CheckoutStockReservation" (
          id, "payloadHash", "buyerId", "sellerId", status, "reservedItems", "expiresAt"
        ) VALUES ('single-reservation', $5, $1, 'seller-1', 'RESERVED', '[]'::jsonb, CURRENT_TIMESTAMP);
        RETURN QUERY SELECT 'single-reservation'::text, '[]'::jsonb, CURRENT_TIMESTAMP::timestamp(3);
      END $$;
    `);

    for (const name of [
      "grainline_checkout_reservation_create_cart_snapshot",
      "grainline_checkout_reservation_create_single_snapshot",
    ]) {
      await db.exec(functionDefinition(correction, name));
    }
    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
        text, text, text, text, text, jsonb
      ) TO grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_single_snapshot(
        text, text, integer, text[], text, jsonb
      ) TO grainline_app_runtime;
    `);

    const cartSource = {
      seller: {},
      items: [{ listingId: "listing-1", listing: {} }],
    };
    const singleSource = {
      seller: {},
      item: { listing: {} },
    };
    const cases = [
      {
        blockerId: "buyer-1",
        blockedId: "seller-user",
        reservationId: "cart-reservation",
        query: `SELECT * FROM public.grainline_checkout_reservation_create_cart_snapshot(
          'buyer-1', 'cart-1', 'seller-1', '00000000-0000-0000-0000-000000000001',
          'payload-cart', $1::jsonb
        )`,
        source: cartSource,
      },
      {
        blockerId: "seller-user",
        blockedId: "buyer-1",
        reservationId: "single-reservation",
        query: `SELECT * FROM public.grainline_checkout_reservation_create_single_snapshot(
          'buyer-1', 'listing-1', 1, ARRAY[]::text[], 'payload-single', $1::jsonb
        )`,
        source: singleSource,
      },
    ];

    for (const item of cases) {
      await db.query(
        `INSERT INTO public."Block" (id, "blockerId", "blockedId") VALUES ($1, $2, $3)`,
        [`block-${item.reservationId}`, item.blockerId, item.blockedId],
      );
      await db.exec("SET ROLE grainline_app_runtime");
      await assert.rejects(
        db.query(item.query, [JSON.stringify(item.source)]),
        /Checkout source witness changed/u,
      );
      await db.exec("RESET ROLE");
      assert.equal((await db.query(
        `SELECT count(*)::integer AS n FROM public."CheckoutStockReservation" WHERE id = $1`,
        [item.reservationId],
      )).rows[0].n, 0);
      await db.query(`DELETE FROM public."Block" WHERE id = $1`, [`block-${item.reservationId}`]);
    }
  } finally {
    await db.close();
  }
});
