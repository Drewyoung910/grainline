import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const candidate = fs.readFileSync(
  "docs/rls-drafts/order-paid-checkout-authority.sql",
  "utf8",
);
const rows = (result) => result.rows;
let db;
let dataDirectory;
let paidAt;

function sourceSnapshot() {
  return {
    seller: {
      id: "seller-1",
      userId: "seller-user",
      displayName: "Proof Shop",
      stripeAccountId: "acct_proof",
      stripeAccountVersion: "v2",
      chargesEnabled: true,
      vacationMode: false,
      acceptingNewOrders: true,
      allowLocalPickup: false,
      offersGiftWrapping: false,
      giftWrappingPriceCents: null,
      defaultPkgWeightGrams: 1000,
      defaultPkgLengthCm: 30,
      defaultPkgWidthCm: 20,
      defaultPkgHeightCm: 10,
      userBanned: false,
      userDeleted: false,
    },
    item: {
      quantity: 1,
      selectedVariantOptionIds: [],
      listing: {
        id: "listing-1",
        sellerId: "seller-1",
        title: "Checkout title",
        description: "Checkout description",
        priceCents: 500,
        priceVersion: 1,
        currency: "usd",
        status: "ACTIVE",
        listingType: "IN_STOCK",
        processingTimeMinDays: null,
        processingTimeMaxDays: null,
        shipsWithinDays: 2,
        category: null,
        tags: ["proof"],
        isPrivate: false,
        reservedForUserId: null,
        packagedWeightGrams: 900,
        packagedLengthCm: 20,
        packagedWidthCm: 10,
        packagedHeightCm: 5,
        imageUrl: "https://cdn.example/proof.jpg",
        imageUrls: ["https://cdn.example/proof.jpg"],
        variantGroups: [],
      },
    },
  };
}

function provider(overrides = {}) {
  return {
    currency: "usd",
    chargedTotalCents: 650,
    itemsSubtotalCents: 500,
    shippingTitle: "Ground",
    shippingAmountCents: 100,
    taxAmountCents: 50,
    buyerEmail: "buyer@example.com",
    buyerName: "Proof Buyer",
    shipToLine1: "1 Main St",
    shipToLine2: null,
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    stripePaymentIntentId: "pi_proof",
    stripeChargeId: "ch_proof",
    stripeApplicationFeeId: "fee_proof",
    stripeTransferId: "tr_proof",
    shippingCarrier: "USPS",
    shippingService: "Ground Advantage",
    quotedToLine1: "1 Main St",
    quotedToLine2: null,
    quotedToCity: "Austin",
    quotedToState: "TX",
    quotedToPostalCode: "78701",
    quotedToCountry: "US",
    quotedToName: "Proof Buyer",
    quotedToPhone: null,
    quotedShippingAmountCents: 100,
    shippoShipmentId: "ship_proof",
    shippoRateObjectId: "rate_proof",
    giftNote: null,
    giftWrapping: false,
    giftWrappingPriceCents: 0,
    estDays: 3,
    paidItems: [{
      sourceKey: "single:listing-1",
      listingId: "listing-1",
      variantKey: "",
      quantity: 1,
      unitAmountCents: 500,
    }],
    ...overrides,
  };
}

async function apply(eventId, generation, projection = provider()) {
  return rows(await db.query(`
    SELECT * FROM public.grainline_stripe_checkout_order_create(
      $1, $2, 'reservation-1', 'cs_test_proof',
      $3::timestamp,
      $4::jsonb
    )
  `, [eventId, generation, paidAt, JSON.stringify(projection)]));
}

describe("Order paid-checkout authority", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-paid-order-"));
    db = new PGlite({ dataDir: dataDirectory });
    await db.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
      CREATE TYPE public."FulfillmentStatus" AS ENUM (
        'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
      );
      CREATE TYPE public."ListingStatus" AS ENUM (
        'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
      );
      CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');

      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL REFERENCES public."User"(id),
        "stripeAccountId" varchar(255),
        "stripeAccountVersion" text,
        "chargesEnabled" boolean NOT NULL,
        "vacationMode" boolean NOT NULL,
        "acceptingNewOrders" boolean NOT NULL
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
        status public."ListingStatus" NOT NULL,
        "listingType" public."ListingType" NOT NULL,
        "stockQuantity" integer,
        "isPrivate" boolean NOT NULL,
        "reservedForUserId" text
      );
      CREATE TABLE public."CartItem" (id text PRIMARY KEY);
      CREATE TABLE public."StripeWebhookEvent" (
        id varchar(255) PRIMARY KEY,
        type varchar(100) NOT NULL,
        "sourceObjectId" varchar(255),
        "claimGeneration" bigint NOT NULL,
        "processingStartedAt" timestamp(3) without time zone,
        "processedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."CheckoutStockReservation" (
        id text PRIMARY KEY,
        "stripeSessionId" varchar(255) UNIQUE,
        status varchar(32) NOT NULL,
        "buyerId" text,
        "sellerId" text,
        "sourceSnapshot" jsonb
      );
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "buyerId" text,
        "sellerProfileId" text,
        "createdAt" timestamp(3) without time zone NOT NULL,
        "paidAt" timestamp(3) without time zone,
        "stripeSessionId" varchar(255) UNIQUE,
        currency varchar(3) NOT NULL,
        "chargedTotalCents" integer,
        "itemsSubtotalCents" integer NOT NULL,
        "shippingTitle" varchar(200),
        "shippingAmountCents" integer NOT NULL,
        "taxAmountCents" integer NOT NULL,
        "buyerEmail" varchar(254), "buyerName" varchar(200),
        "shipToLine1" varchar(200), "shipToLine2" varchar(200),
        "shipToCity" varchar(100), "shipToState" varchar(50),
        "shipToPostalCode" varchar(20), "shipToCountry" varchar(2),
        "stripePaymentIntentId" varchar(255), "stripeChargeId" varchar(255),
        "stripeApplicationFeeId" varchar(255), "stripeTransferId" varchar(255),
        "fulfillmentMethod" public."FulfillmentMethod",
        "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
        "estimatedDeliveryDate" timestamp(3) without time zone,
        "processingDeadline" timestamp(3) without time zone,
        "shippingCarrier" varchar(100), "shippingService" varchar(100),
        "quotedShippingAmountCents" integer,
        "reviewNeeded" boolean NOT NULL, "reviewNote" varchar(10000),
        "quotedToLine1" varchar(200), "quotedToLine2" varchar(200),
        "quotedToCity" varchar(100), "quotedToState" varchar(50),
        "quotedToPostalCode" varchar(20), "quotedToCountry" varchar(2),
        "quotedToName" varchar(200), "quotedToPhone" varchar(30),
        "shippoShipmentId" varchar(255), "shippoRateObjectId" varchar(255),
        "giftNote" varchar(500), "giftWrapping" boolean NOT NULL,
        "giftWrappingPriceCents" integer,
        "buyerDataPurgedAt" timestamp(3) without time zone
      );
      CREATE TABLE public."OrderItem" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES public."Order"(id),
        "listingId" text NOT NULL REFERENCES public."Listing"(id),
        "sellerProfileId" text,
        quantity integer NOT NULL,
        "priceCents" integer NOT NULL,
        "listingSnapshot" jsonb,
        "selectedVariants" jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY, "actorType" varchar(40) NOT NULL,
        "actorId" varchar(255), action varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL, "targetId" varchar(255) NOT NULL,
        reason varchar(1000), metadata jsonb NOT NULL,
        "createdAt" timestamp(3) without time zone NOT NULL
      );

      CREATE FUNCTION public.grainline_checkout_reservation_complete(
        p_event_id text, p_generation bigint, p_reservation_id text, p_session_id text
      ) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
      BEGIN
        IF p_reservation_id = 'reservation-rollback' THEN RETURN 'broken'; END IF;
        UPDATE public."CheckoutStockReservation"
           SET status = 'COMPLETED'
         WHERE id = p_reservation_id
           AND "stripeSessionId" = p_session_id
           AND status = 'RESERVED';
        IF NOT FOUND THEN RETURN 'already_completed'; END IF;
        RETURN 'completed';
      END; $f$;

      INSERT INTO public."User" (id) VALUES ('buyer-1'), ('seller-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "stripeAccountVersion",
        "chargesEnabled", "vacationMode", "acceptingNewOrders"
      ) VALUES ('seller-1', 'seller-user', 'acct_proof', 'v2', true, false, true);
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate"
      ) VALUES ('listing-1', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false);
      INSERT INTO public."CartItem" (id) VALUES ('unrelated-cart-item');
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_paid_order', 'checkout.session.completed', 'cs_test_proof', 1,
        CURRENT_TIMESTAMP
      );
      INSERT INTO public."CheckoutStockReservation" (
        id, "stripeSessionId", status, "buyerId", "sellerId", "sourceSnapshot"
      ) VALUES (
        'reservation-1', 'cs_test_proof', 'RESERVED', 'buyer-1', 'seller-1',
        '${JSON.stringify(sourceSnapshot()).replaceAll("'", "''")}'::jsonb
      );

      REVOKE ALL ON public."Order", public."OrderItem" FROM grainline_app_runtime;
    `).catch((error) => {
      error.message = `proof schema setup failed: ${error.message}`;
      throw error;
    });
    await db.exec(candidate).catch((error) => {
      error.message = `paid-checkout candidate failed to install: ${error.message}; position=${error.position ?? "unknown"}; where=${error.where ?? "unknown"}`;
      throw error;
    });
    paidAt = rows(await db.query(`
      SELECT (CURRENT_TIMESTAMP - interval '1 minute')::timestamp AS paid_at
    `))[0].paid_at;
  });

  after(async () => {
    await db?.close();
    if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("rejects forged provider and retained-source projections before writing", async () => {
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(
        apply("evt_paid_order", 1n, { ...provider(), unexpected: true }),
        /provider projection is invalid/,
      );
      await assert.rejects(
        apply("evt_paid_order", 1n, provider({ chargedTotalCents: 651 })),
        /amount projection is invalid/,
      );
      await assert.rejects(
        apply("evt_paid_order", 1n, provider({
          paidItems: [{
            ...provider().paidItems[0],
            unitAmountCents: 499,
          }],
        })),
        /provider price is invalid/,
      );
      await assert.rejects(
        apply("evt_paid_order", 1n, provider({ currency: "cad" })),
        /retained item is invalid/,
      );
      await assert.rejects(
        apply("evt_paid_order", 1n, provider({ shipToLine1: null })),
        /fulfillment projection is invalid/,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.equal(Number(rows(await db.query(`
      SELECT pg_catalog.count(*) AS count FROM public."Order"
    `))[0].count), 0);

    await db.exec("BEGIN");
    try {
      await db.exec(`
        UPDATE public."CheckoutStockReservation"
           SET "sourceSnapshot" = pg_catalog.jsonb_set(
             "sourceSnapshot", '{item,listing,sellerId}', '"other-seller"'::jsonb
           )
         WHERE id = 'reservation-1';
        SET LOCAL ROLE grainline_app_runtime;
      `);
      await assert.rejects(
        apply("evt_paid_order", 1n),
        /retained item is invalid/,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => {});
    }
  });

  it("creates one source-derived Order and item as restricted runtime", async () => {
    let created;
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      created = await apply("evt_paid_order", 1n);
    } finally {
      await db.exec("RESET ROLE");
    }
    assert.equal(created.length, 1);
    assert.equal(created[0].outcome, "created");
    assert.equal(created[0].invalid_reason, null);
    assert.equal(created[0].listing_visibility_changed, true);

    const order = rows(await db.query(`
      SELECT "buyerId" AS buyer_id, "sellerProfileId" AS seller_id,
             "quotedToLine1" AS quoted_line_1, "reviewNeeded" AS review_needed,
             "stripeTransferId" AS transfer_id
        FROM public."Order"
    `))[0];
    assert.deepEqual(order, {
      buyer_id: "buyer-1",
      seller_id: "seller-1",
      quoted_line_1: "1 Main St",
      review_needed: false,
      transfer_id: "tr_proof",
    });
    const item = rows(await db.query(`
      SELECT "priceCents" AS price_cents,
             "listingSnapshot"->>'description' AS description,
             "listingSnapshot"->'imageUrls' AS image_urls,
             "listingSnapshot"->'tags' AS tags,
             "listingSnapshot"->>'capturedAt' AS captured_at
        FROM public."OrderItem"
    `))[0];
    assert.equal(item.price_cents, 500);
    assert.equal(item.description, "Checkout description");
    assert.deepEqual(item.image_urls, ["https://cdn.example/proof.jpg"]);
    assert.deepEqual(item.tags, ["proof"]);
    assert.match(item.captured_at, /Z$/);
    assert.equal(rows(await db.query(`
      SELECT status FROM public."CheckoutStockReservation"
    `))[0].status, "COMPLETED");
    assert.equal(rows(await db.query(`SELECT status FROM public."Listing"`))[0].status, "SOLD_OUT");
  });

  it("replays the exact tuple and rejects drift without duplicate rows", async () => {
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      const replay = await apply("evt_paid_order", 1n);
      assert.equal(replay[0].outcome, "replayed");
      await assert.rejects(
        apply("evt_paid_order", 1n, provider({
          chargedTotalCents: 651,
          taxAmountCents: 51,
        })),
        /Paid checkout replay drifted|Paid checkout source subtotal is invalid/,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.equal(Number(rows(await db.query(`SELECT pg_catalog.count(*) AS count FROM public."Order"`))[0].count), 1);
    assert.equal(Number(rows(await db.query(`SELECT pg_catalog.count(*) AS count FROM public."OrderItem"`))[0].count), 1);
  });

  it("keeps direct tables closed and rejects a forged event generation", async () => {
    const privileges = rows(await db.query(`
      SELECT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Order"', 'INSERT') AS can_insert,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime',
               'public.grainline_stripe_checkout_order_create(text,bigint,text,text,timestamp without time zone,jsonb)',
               'EXECUTE'
             ) AS can_execute
    `))[0];
    assert.deepEqual(privileges, { can_insert: false, can_execute: true });
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(apply("evt_paid_order", 2n), /event authority is invalid/);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  });

  it("rolls every derived write back when reservation completion fails", async () => {
    const snapshot = structuredClone(sourceSnapshot());
    snapshot.item.listing.id = "listing-rollback";
    await db.exec(`
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate"
      ) VALUES ('listing-rollback', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false);
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_paid_rollback', 'checkout.session.completed', 'cs_test_rollback', 1,
        CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      INSERT INTO public."CheckoutStockReservation" (
        id, "stripeSessionId", status, "buyerId", "sellerId", "sourceSnapshot"
      ) VALUES (
        'reservation-rollback', 'cs_test_rollback', 'RESERVED',
        'buyer-1', 'seller-1', $1::jsonb
      )
    `, [JSON.stringify(snapshot)]);
    const rollbackProvider = provider({
      paidItems: [{
        ...provider().paidItems[0],
        sourceKey: "single:listing-rollback",
        listingId: "listing-rollback",
      }],
    });
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await assert.rejects(db.query(`
        SELECT * FROM public.grainline_stripe_checkout_order_create(
          'evt_paid_rollback', 1, 'reservation-rollback', 'cs_test_rollback',
          $1::timestamp, $2::jsonb
        )
      `, [paidAt, JSON.stringify(rollbackProvider)]), /reservation completion failed/);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.equal(Number(rows(await db.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."Order" WHERE "stripeSessionId" = 'cs_test_rollback'
    `))[0].count), 0);
    assert.equal(rows(await db.query(`
      SELECT status FROM public."CheckoutStockReservation"
       WHERE id = 'reservation-rollback'
    `))[0].status, "RESERVED");
    assert.equal(rows(await db.query(`
      SELECT status FROM public."Listing" WHERE id = 'listing-rollback'
    `))[0].status, "ACTIVE");
  });

  it("creates a complete cart order and deletes only retained source cart items", async () => {
    const first = structuredClone(sourceSnapshot().item);
    const second = structuredClone(sourceSnapshot().item);
    first.listing.id = "listing-cart-a";
    second.listing.id = "listing-cart-b";
    const snapshot = {
      seller: sourceSnapshot().seller,
      items: [
        {
          cartItemId: "cart-item-a",
          listingId: "listing-cart-a",
          storedPriceCents: 500,
          storedPriceVersion: 1,
          ...first,
        },
        {
          cartItemId: "cart-item-b",
          listingId: "listing-cart-b",
          storedPriceCents: 500,
          storedPriceVersion: 1,
          ...second,
        },
      ],
    };
    await db.exec(`
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate"
      ) VALUES
        ('listing-cart-a', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false),
        ('listing-cart-b', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false);
      INSERT INTO public."CartItem" (id) VALUES ('cart-item-a'), ('cart-item-b');
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES (
        'evt_paid_cart', 'checkout.session.async_payment_succeeded',
        'cs_test_cart', 4, CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      INSERT INTO public."CheckoutStockReservation" (
        id, "stripeSessionId", status, "buyerId", "sellerId", "sourceSnapshot"
      ) VALUES (
        'reservation-cart', 'cs_test_cart', 'RESERVED',
        'buyer-1', 'seller-1', $1::jsonb
      )
    `, [JSON.stringify(snapshot)]);
    const cartProvider = provider({
      chargedTotalCents: 1150,
      itemsSubtotalCents: 1000,
      paidItems: [
        {
          sourceKey: "cart-item-a", listingId: "listing-cart-a",
          variantKey: "", quantity: 1, unitAmountCents: 500,
        },
        {
          sourceKey: "cart-item-b", listingId: "listing-cart-b",
          variantKey: "", quantity: 1, unitAmountCents: 500,
        },
      ],
    });
    let created;
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      created = rows(await db.query(`
        SELECT * FROM public.grainline_stripe_checkout_order_create(
          'evt_paid_cart', 4, 'reservation-cart', 'cs_test_cart',
          $1::timestamp, $2::jsonb
        )
      `, [paidAt, JSON.stringify(cartProvider)]));
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
    assert.equal(created[0].outcome, "created");
    assert.equal(Number(rows(await db.query(`
      SELECT pg_catalog.count(*) AS count FROM public."OrderItem"
       WHERE "orderId" = $1
    `, [created[0].order_id]))[0].count), 2);
    assert.deepEqual(rows(await db.query(`
      SELECT id FROM public."CartItem" ORDER BY id
    `)), [{ id: "unrelated-cart-item" }]);
  });
});
