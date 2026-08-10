import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync("docs/rls-drafts/checkout-stock-reservation-authority.sql", "utf8");
let db;

const SOURCE_SCHEMA = String.raw`
  CREATE ROLE grainline_app_runtime NOLOGIN;
  CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED');
  CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');

  CREATE TABLE public."User" (
    id text PRIMARY KEY,
    "deletedAt" timestamp(3) without time zone,
    banned boolean NOT NULL DEFAULT false
  );
  CREATE TABLE public."SellerProfile" (
    id text PRIMARY KEY,
    "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
    "stripeAccountId" varchar(255),
    "stripeAccountVersion" text,
    "chargesEnabled" boolean NOT NULL DEFAULT false,
    "vacationMode" boolean NOT NULL DEFAULT false,
    "acceptingNewOrders" boolean NOT NULL DEFAULT true
  );
  CREATE TABLE public."Cart" (
    id text PRIMARY KEY,
    "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
  );
  CREATE TABLE public."Listing" (
    id text PRIMARY KEY,
    "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
    status public."ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingType" public."ListingType" NOT NULL DEFAULT 'MADE_TO_ORDER',
    "stockQuantity" integer,
    "isPrivate" boolean NOT NULL DEFAULT false,
    "reservedForUserId" text
  );
  CREATE TABLE public."CartItem" (
    id text PRIMARY KEY,
    "cartId" text NOT NULL REFERENCES public."Cart"(id),
    "listingId" text NOT NULL REFERENCES public."Listing"(id),
    quantity integer NOT NULL DEFAULT 1
  );
  CREATE TABLE public."StripeWebhookEvent" (
    id varchar(255) PRIMARY KEY,
    type varchar(100) NOT NULL,
    "claimGeneration" bigint NOT NULL DEFAULT 0,
    "processingStartedAt" timestamp(3) without time zone,
    "processedAt" timestamp(3) without time zone,
    "lastError" varchar(2000),
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE public."Order" (
    id text PRIMARY KEY,
    "buyerId" text,
    "sellerProfileId" text,
    "stripeSessionId" varchar(255) UNIQUE
  );
  CREATE TABLE public."CheckoutStockReservation" (
    id text PRIMARY KEY,
    "checkoutLockKey" varchar(255) NOT NULL,
    "checkoutGroupId" varchar(100),
    "payloadHash" varchar(64) NOT NULL,
    "buyerId" varchar(191),
    "sellerId" varchar(191),
    "stripeSessionId" varchar(255) UNIQUE,
    status varchar(32) NOT NULL DEFAULT 'RESERVED',
    "reservedItems" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "restoredAt" timestamp(3) without time zone,
    "restoreReason" varchar(100),
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Exact predecessor lease primitive consumed by the compatible bound-begin
  -- overload in the authority draft.
  CREATE FUNCTION public.grainline_stripe_webhook_begin(
    p_event_id text,
    p_event_type text
  )
  RETURNS TABLE(action text, claim_generation bigint)
  LANGUAGE plpgsql
  VOLATILE
  PARALLEL UNSAFE
  SECURITY DEFINER
  SET search_path = pg_catalog
  AS $grainline_stripe_webhook_begin$
  DECLARE
    source_event public."StripeWebhookEvent"%ROWTYPE;
    source_now timestamp(3) without time zone :=
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
    inserted_count integer;
  BEGIN
    IF p_event_id IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) = 0
       OR pg_catalog.char_length(p_event_id) > 255 THEN
      RAISE EXCEPTION 'Stripe webhook event id is invalid'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_event_type IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_event_type)) = 0
       OR pg_catalog.char_length(p_event_type) > 100 THEN
      RAISE EXCEPTION 'Stripe webhook event type is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public."StripeWebhookEvent" (
      id, type, "claimGeneration", "processingStartedAt", "createdAt", "updatedAt"
    ) VALUES (
      p_event_id, p_event_type, 1, source_now, source_now, source_now
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count = 1 THEN
      RETURN QUERY SELECT 'process'::text, 1::bigint;
      RETURN;
    END IF;

    SELECT event.*
      INTO STRICT source_event
      FROM public."StripeWebhookEvent" AS event
     WHERE event.id = p_event_id
     FOR UPDATE;

    IF source_event.type IS DISTINCT FROM p_event_type THEN
      RAISE EXCEPTION 'Stripe webhook event type is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
    IF source_event."processedAt" IS NOT NULL THEN
      RETURN QUERY SELECT 'processed'::text, source_event."claimGeneration";
      RETURN;
    END IF;
    IF source_event."processingStartedAt" IS NOT NULL
       AND source_event."processingStartedAt" >= source_now - interval '2 minutes' THEN
      RETURN QUERY SELECT 'in_progress'::text, source_event."claimGeneration";
      RETURN;
    END IF;

    UPDATE public."StripeWebhookEvent" AS event
       SET "claimGeneration" = event."claimGeneration" + 1,
           "processingStartedAt" = source_now,
           "lastError" = NULL,
           "updatedAt" = source_now
     WHERE event.id = p_event_id
    RETURNING event.* INTO STRICT source_event;

    RETURN QUERY SELECT 'process'::text, source_event."claimGeneration";
  END
  $grainline_stripe_webhook_begin$;
`;

function rows(result) {
  return result.rows;
}

describe("CheckoutStockReservation fixed authority in disposable PostgreSQL", () => {
  before(async () => {
    db = new PGlite();
    await db.exec(SOURCE_SCHEMA);
    await db.exec(draft);
    await db.exec(`
      INSERT INTO public."User" (id) VALUES ('buyer-a'), ('buyer-b'), ('seller-user'), ('seller-user-b');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "stripeAccountVersion", "chargesEnabled"
      ) VALUES
        ('seller-a', 'seller-user', 'acct_a', 'v2', true),
        ('seller-b', 'seller-user-b', 'acct_b', 'v2', true);
      INSERT INTO public."Cart" (id, "userId") VALUES ('cart-a', 'buyer-a');
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate", "reservedForUserId"
      ) VALUES
        ('listing-a', 'seller-a', 'ACTIVE', 'IN_STOCK', 8, false, NULL),
        ('listing-private', 'seller-a', 'ACTIVE', 'IN_STOCK', 3, true, 'buyer-a'),
        ('listing-mto', 'seller-a', 'ACTIVE', 'MADE_TO_ORDER', NULL, false, NULL);
      INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity) VALUES
        ('cart-item-a', 'cart-a', 'listing-a', 2),
        ('cart-item-private', 'cart-a', 'listing-private', 1),
        ('cart-item-mto', 'cart-a', 'listing-mto', 1);
    `);
  });

  after(async () => {
    await db?.close();
  });

  it("keeps private helpers inaccessible and grants only fixed runtime operations", async () => {
    const privileges = rows(await db.query(`
      SELECT
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_create_cart(text,text,text,text,text)',
          'EXECUTE'
        ) AS can_create,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_restore_items(jsonb)',
          'EXECUTE'
        ) AS can_private_restore,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_items_valid(jsonb,text,text)',
          'EXECUTE'
        ) AS can_private_validate,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_stripe_webhook_begin(text,text,text)',
          'EXECUTE'
        ) AS can_begin_bound_event,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_stripe_webhook_bind_source(text,text,bigint,text)',
          'EXECUTE'
        ) AS can_private_bind_event
    `));
    assert.deepEqual(privileges[0], {
      can_create: true,
      can_private_restore: false,
      can_private_validate: false,
      can_begin_bound_event: true,
      can_private_bind_event: false,
    });
  });

  it("acquires and source-binds a webhook lease in one fixed operation", async () => {
    const lease = rows(await db.query(`
      SELECT * FROM public.grainline_stripe_webhook_begin(
        'evt_bound_begin', 'checkout.session.expired', 'cs_test_boundBegin'
      )
    `))[0];
    assert.equal(lease.action, "process");
    assert.equal(Number(lease.claim_generation), 1);

    const event = rows(await db.query(`
      SELECT type, "claimGeneration", "sourceObjectId", "processingStartedAt" IS NOT NULL AS processing
        FROM public."StripeWebhookEvent"
       WHERE id = 'evt_bound_begin'
    `))[0];
    assert.deepEqual(event, {
      type: "checkout.session.expired",
      claimGeneration: 1,
      sourceObjectId: "cs_test_boundBegin",
      processing: true,
    });
  });

  it("derives cart items, seller and lock key while decrementing only in-stock sources", async () => {
    const created = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_create_cart(
        'buyer-a', 'cart-a', 'seller-a', 'group-a', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      )
    `));
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].reserved_items, [
      { listingId: "listing-a", quantity: 2, sellerId: "seller-a" },
      { listingId: "listing-private", quantity: 1, sellerId: "seller-a" },
    ]);

    const state = rows(await db.query(`
      SELECT "checkoutLockKey", "buyerId", "sellerId", status
        FROM public."CheckoutStockReservation"
       WHERE id = $1
    `, [created[0].reservation_id]))[0];
    assert.deepEqual(state, {
      checkoutLockKey: "checkout:cart:cart-a:seller:seller-a",
      buyerId: "buyer-a",
      sellerId: "seller-a",
      status: "RESERVED",
    });

    const stocks = rows(await db.query(`
      SELECT id, "stockQuantity" FROM public."Listing"
       WHERE id IN ('listing-a', 'listing-private', 'listing-mto') ORDER BY id
    `));
    assert.deepEqual(stocks, [
      { id: "listing-a", stockQuantity: 6 },
      { id: "listing-mto", stockQuantity: null },
      { id: "listing-private", stockQuantity: 2 },
    ]);
  });

  it("rejects forged cart ownership and active lock replay", async () => {
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_create_cart(
        'buyer-b', 'cart-a', 'seller-a', 'group-b', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      )`),
      /Cart checkout source is unavailable/,
    );
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_create_cart(
        'buyer-a', 'cart-a', 'seller-a', 'group-b', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      )`),
      /CheckoutStockReservation_active_lock_key/,
    );
  });

  it("locks account lifecycle rows and revalidates seller orderability", async () => {
    const normalizedDraft = draft.replace(/\s+/g, " ");
    assert.match(
      normalizedDraft,
      /FROM public\."User" AS actor WHERE actor\.id IN \(p_buyer_id, source_seller_user_id\) ORDER BY actor\.id FOR KEY SHARE/,
    );

    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_create_single(
        'seller-user', 'listing-a', 1, 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
      )`),
      /Single checkout seller is unavailable/,
    );

    await db.exec(`UPDATE public."SellerProfile" SET "vacationMode" = true WHERE id = 'seller-a'`);
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_create_single(
        'buyer-b', 'listing-a', 1, 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
      )`),
      /Single checkout seller is unavailable/,
    );
    await db.exec(`UPDATE public."SellerProfile" SET "vacationMode" = false WHERE id = 'seller-a'`);

    await db.exec(`UPDATE public."User" SET banned = true WHERE id = 'buyer-b'`);
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_create_single(
        'buyer-b', 'listing-a', 1, 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'
      )`),
      /Single checkout buyer is unavailable/,
    );
    await db.exec(`UPDATE public."User" SET banned = false WHERE id = 'buyer-b'`);
  });

  it("binds exactly once and refuses checkout abort after a session exists", async () => {
    const reservation = rows(await db.query(`
      SELECT id FROM public."CheckoutStockReservation"
       WHERE "checkoutLockKey" = 'checkout:cart:cart-a:seller:seller-a'
    `))[0];
    const bound = rows(await db.query(`
      SELECT public.grainline_checkout_reservation_bind_session(
        $1, 'buyer-a', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'cs_test_boundA'
      ) AS result
    `, [reservation.id]))[0];
    assert.equal(bound.result, true);
    const rebound = rows(await db.query(`
      SELECT public.grainline_checkout_reservation_bind_session(
        $1, 'buyer-a', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'cs_test_boundB'
      ) AS result
    `, [reservation.id]))[0];
    assert.equal(rebound.result, false);

    const aborted = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_checkout_abort(
        $1, 'buyer-a', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      )
    `, [reservation.id]))[0];
    assert.equal(aborted.result, "retained");
  });

  it("requires an exact active webhook generation plus matching durable Order to complete", async () => {
    const reservation = rows(await db.query(`
      SELECT id FROM public."CheckoutStockReservation" WHERE "stripeSessionId" = 'cs_test_boundA'
    `))[0];
    await db.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "claimGeneration", "processingStartedAt"
      ) VALUES
        ('evt_complete_a', 'checkout.session.completed', 3, CURRENT_TIMESTAMP),
        ('evt_complete_other', 'checkout.session.completed', 1, CURRENT_TIMESTAMP);
    `);
    await db.query(`SELECT public.grainline_stripe_webhook_bind_source(
      'evt_complete_a', 'checkout.session.completed', 3, 'cs_test_boundA'
    )`);
    await db.query(`SELECT public.grainline_stripe_webhook_bind_source(
      'evt_complete_other', 'checkout.session.completed', 1, 'cs_test_other'
    )`);
    await assert.rejects(
      db.query(`SELECT public.grainline_stripe_webhook_bind_source(
        'evt_complete_other', 'checkout.session.completed', 1, 'cs_test_boundA'
      )`),
      /source object is immutable/,
    );
    await assert.rejects(
      db.query(`SELECT public.grainline_checkout_reservation_complete(
        'evt_complete_other', 1, $1, 'cs_test_boundA'
      )`, [reservation.id]),
      /webhook claim is invalid/,
    );
    await assert.rejects(
      db.query(`SELECT public.grainline_checkout_reservation_complete(
        'evt_complete_a', 2, $1, 'cs_test_boundA'
      )`, [reservation.id]),
      /webhook claim is invalid/,
    );
    await assert.rejects(
      db.query(`SELECT public.grainline_checkout_reservation_complete(
        'evt_complete_a', 3, $1, 'cs_test_boundA'
      )`, [reservation.id]),
      /missing its durable order/,
    );
    await db.query(`
      INSERT INTO public."Order" (id, "buyerId", "sellerProfileId", "stripeSessionId")
      VALUES ('order-a', 'buyer-a', 'seller-a', 'cs_test_boundA')
    `);
    const completed = rows(await db.query(`
      SELECT public.grainline_checkout_reservation_complete(
        'evt_complete_a', 3, $1, 'cs_test_boundA'
      ) AS result
    `, [reservation.id]))[0];
    assert.equal(completed.result, "completed");
  });

  it("binds signed restore authority to the exact Checkout Session object", async () => {
    const reservation = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_create_single(
        'buyer-a', 'listing-a', 1, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      )
    `))[0];
    await db.query(`SELECT public.grainline_checkout_reservation_bind_session(
      $1, 'buyer-a', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'cs_test_webhookExpired'
    )`, [reservation.reservation_id]);
    await db.exec(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "claimGeneration", "processingStartedAt"
      ) VALUES ('evt_expired_a', 'checkout.session.expired', 4, CURRENT_TIMESTAMP);
    `);
    await db.query(`SELECT public.grainline_stripe_webhook_bind_source(
      'evt_expired_a', 'checkout.session.expired', 4, 'cs_test_webhookExpired'
    )`);

    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_webhook_restore(
        'evt_expired_a', 4, 'cs_test_sellerExpired'
      )`),
      /webhook claim is invalid/,
    );
    const restored = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_webhook_restore(
        'evt_expired_a', 4, 'cs_test_webhookExpired'
      )
    `))[0];
    assert.equal(restored.result, "restored");
  });

  it("separates buyer-confirmed and seller-confirmed provider expiry authority", async () => {
    const buyerReservation = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_create_single(
        'buyer-a', 'listing-a', 1, 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
      )
    `))[0];
    await db.query(`SELECT public.grainline_checkout_reservation_bind_session(
      $1, 'buyer-a', 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'cs_test_buyerExpired'
    )`, [buyerReservation.reservation_id]);
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_buyer_expired_restore(
        'buyer-b', 'cs_test_buyerExpired'
      )`),
      /authority does not match reservation/,
    );
    const buyerRestored = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_buyer_expired_restore(
        'buyer-a', 'cs_test_buyerExpired'
      )
    `))[0];
    assert.equal(buyerRestored.result, "restored");

    const sellerReservation = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_create_single(
        'buyer-a', 'listing-private', 1, 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'
      )
    `))[0];
    await db.query(`SELECT public.grainline_checkout_reservation_bind_session(
      $1, 'buyer-a', 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', 'cs_test_sellerExpired'
    )`, [sellerReservation.reservation_id]);
    await assert.rejects(
      db.query(`SELECT * FROM public.grainline_checkout_reservation_seller_expired_restore(
        'seller-b', 'cs_test_sellerExpired'
      )`),
      /authority does not match reservation/,
    );
    const sellerRestored = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_seller_expired_restore(
        'seller-a', 'cs_test_sellerExpired'
      )
    `))[0];
    assert.equal(sellerRestored.result, "restored");
  });

  it("normalizes predecessor repair diagnostics away from terminal restore evidence", async () => {
    await db.exec(`
      INSERT INTO public."CheckoutStockReservation" (
        id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId", status,
        "reservedItems", "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        'legacy-diagnostic', 'checkout:legacy:diagnostic',
        'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'buyer-a', 'seller-a', 'RESERVED',
        '[{"listingId":"listing-a","sellerId":"seller-a","quantity":1}]',
        CURRENT_TIMESTAMP - interval '3 hours', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      UPDATE public."CheckoutStockReservation"
         SET "restoreReason" = 'session_retrieve_failed'
       WHERE id = 'legacy-diagnostic';
    `);
    const state = rows(await db.query(`
      SELECT "restoreReason", "lastRepairError", "lastRepairAttemptAt" IS NOT NULL AS attempted
        FROM public."CheckoutStockReservation" WHERE id = 'legacy-diagnostic'
    `))[0];
    assert.deepEqual(state, {
      restoreReason: null,
      lastRepairError: "session_retrieve_failed",
      attempted: true,
    });
  });

  it("fences stale repair generations and restores once", async () => {
    const firstClaim = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_repair_claim_batch(10)
       WHERE reservation_id = 'legacy-diagnostic'
    `))[0];
    assert.equal(Number(firstClaim.repair_generation), 1);
    await db.exec(`
      UPDATE public."CheckoutStockReservation"
         SET "repairClaimedAt" = CURRENT_TIMESTAMP - interval '6 minutes'
       WHERE id = 'legacy-diagnostic';
    `);
    const secondClaim = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_repair_claim_batch(10)
       WHERE reservation_id = 'legacy-diagnostic'
    `))[0];
    assert.equal(Number(secondClaim.repair_generation), 2);

    const stale = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_repair_finalize(
        'legacy-diagnostic', 1, 'NO_SESSION_RESTORE'
      )
    `))[0];
    assert.equal(stale.result, "superseded");
    const restored = rows(await db.query(`
      SELECT * FROM public.grainline_checkout_reservation_repair_finalize(
        'legacy-diagnostic', 2, 'NO_SESSION_RESTORE'
      )
    `))[0];
    assert.equal(restored.result, "restored");

    const listing = rows(await db.query(`
      SELECT "stockQuantity" FROM public."Listing" WHERE id = 'listing-a'
    `))[0];
    assert.equal(listing.stockQuantity, 7);
  });

  it("scrubs only terminal account rows into the exact deletion sentinel", async () => {
    const count = rows(await db.query(`
      SELECT public.grainline_checkout_reservation_account_scrub('buyer-a') AS count
    `))[0];
    assert.equal(Number(count.count), 5);
    const scrubbed = rows(await db.query(`
      SELECT "payloadHash", "checkoutLockKey", "buyerId", "sellerId", "reservedItems"
        FROM public."CheckoutStockReservation"
       WHERE id = 'legacy-diagnostic'
    `))[0];
    assert.deepEqual(scrubbed, {
      payloadHash: "deleted",
      checkoutLockKey: "deleted:legacy-diagnostic",
      buyerId: null,
      sellerId: null,
      reservedItems: [{ listingId: "listing-a", quantity: 1 }],
    });
  });
});

describe("CheckoutStockReservation authority draft static contract", () => {
  it("has fifteen runtime operations and no generic target or reason inputs", () => {
    const operations = [
      "create_cart", "create_single", "bind_session", "complete", "checkout_abort",
      "webhook_restore", "buyer_expired_restore", "seller_expired_restore",
      "repair_claim_batch", "account_claim_batch", "repair_finalize", "prune_batch",
      "resume", "export", "account_scrub",
    ];
    for (const operation of operations) {
      assert.match(draft, new RegExp(`CREATE FUNCTION public\\.grainline_checkout_reservation_${operation}\\(`));
    }
    assert.doesNotMatch(draft, /p_restore_reason|p_checkout_lock_key/);
    assert.doesNotMatch(draft, /EXECUTE\s+(?:format|p_)/i);
    assert.match(draft, /LEAST\(p_limit, 50\)/);
    assert.match(draft, /LEAST\(p_limit, 100\)/);
    assert.match(draft, /FOR UPDATE SKIP LOCKED/);
    assert.match(draft, /grainline_stripe_webhook_bind_source/);
    assert.match(draft, /grainline_stripe_webhook_begin\(text, text, text\)/);
    assert.doesNotMatch(
      draft.slice(draft.lastIndexOf("GRANT EXECUTE")),
      /GRANT EXECUTE ON FUNCTION public\.grainline_stripe_webhook_bind_source/,
    );
    assert.match(draft, /event\."sourceObjectId" = p_session_id/);
    for (const operation of ["complete", "webhook_restore"]) {
      const start = draft.indexOf(`CREATE FUNCTION public.grainline_checkout_reservation_${operation}(`);
      const end = draft.indexOf("CREATE FUNCTION public.", start + 20);
      const block = draft.slice(start, end === -1 ? draft.length : end);
      assert.match(block, /FROM public\."StripeWebhookEvent" AS event[\s\S]*FOR UPDATE/);
    }
  });
});
