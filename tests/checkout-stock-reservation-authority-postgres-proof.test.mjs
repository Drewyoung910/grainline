import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";
import {
  stripeWebhookEventFunctionSources,
} from "../scripts/stripe-webhook-event-function-source-catalog.mjs";
import {
  verifyReservationAuthorityRuntimeIdentity,
  verifyReservationSourceConsistentFunctionCatalog,
  verifyReservationCompatibleSchema,
  verifyReservationCompatibleTablePosture,
} from "../scripts/checkout-stock-reservation-authority-production-postflight.mjs";
import {
  cartCheckoutReservationSnapshotWitness,
  cartCheckoutReservationSourceWitness,
  singleCheckoutReservationSnapshotWitness,
  singleCheckoutReservationSourceWitness,
} from "../src/lib/checkoutReservationSourceState.ts";
import {
  verifyCheckoutStockReservationActivatedCatalog,
} from "../scripts/checkout-stock-reservation-activation-production-postflight.mjs";

const draft = fs.readFileSync("docs/rls-drafts/checkout-stock-reservation-authority.sql", "utf8");
const sourceConsistencyMigration = fs.readFileSync(
  "prisma/migrations/20260814053000_prepare_checkout_stock_reservation_source_consistency/migration.sql",
  "utf8",
);
const orderCheckoutSourceSnapshotCandidate = fs.readFileSync(
  "docs/rls-drafts/order-checkout-source-snapshot.sql",
  "utf8",
).replace(/^([\s\S]*?)BEGIN;\s*/, "").replace(/\s*COMMIT;\s*$/, "");
const activation = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-activation.sql",
  "utf8",
);
const activationRollback = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-activation-rollback.sql",
  "utf8",
);
const force = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-force.sql",
  "utf8",
);
const forceRollback = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-force-rollback.sql",
  "utf8",
);
const predecessorWebhookBeginSource =
  stripeWebhookEventFunctionSources().grainline_stripe_webhook_begin;
let db;
let dataDirectory;

const SOURCE_SCHEMA = String.raw`
  CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
  CREATE ROLE grainline_untrusted NOLOGIN;
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
    "displayName" varchar(100) NOT NULL DEFAULT 'Proof Seller',
    "stripeAccountId" varchar(255),
    "stripeAccountVersion" text,
    "chargesEnabled" boolean NOT NULL DEFAULT false,
    "vacationMode" boolean NOT NULL DEFAULT false,
    "acceptingNewOrders" boolean NOT NULL DEFAULT true,
    "allowLocalPickup" boolean NOT NULL DEFAULT false,
    "offersGiftWrapping" boolean NOT NULL DEFAULT false,
    "giftWrappingPriceCents" integer,
    "defaultPkgWeightGrams" integer,
    "defaultPkgLengthCm" double precision,
    "defaultPkgWidthCm" double precision,
    "defaultPkgHeightCm" double precision
  );
  CREATE TABLE public."Cart" (
    id text PRIMARY KEY,
    "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
  );
  CREATE TABLE public."Listing" (
    id text PRIMARY KEY,
    "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
    title varchar(150) NOT NULL DEFAULT 'Proof listing',
    description varchar(5000) NOT NULL DEFAULT 'Proof description',
    "priceCents" integer NOT NULL DEFAULT 10000,
    "priceVersion" integer NOT NULL DEFAULT 1,
    currency varchar(3) NOT NULL DEFAULT 'usd',
    status public."ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingType" public."ListingType" NOT NULL DEFAULT 'MADE_TO_ORDER',
    "processingTimeMinDays" integer,
    "processingTimeMaxDays" integer,
    "shipsWithinDays" integer,
    category text,
    tags text[] NOT NULL DEFAULT '{}',
    "stockQuantity" integer,
    "isPrivate" boolean NOT NULL DEFAULT false,
    "reservedForUserId" text,
    "packagedWeightGrams" integer,
    "packagedLengthCm" double precision,
    "packagedWidthCm" double precision,
    "packagedHeightCm" double precision
  );
  CREATE TABLE public."CartItem" (
    id text PRIMARY KEY,
    "cartId" text NOT NULL REFERENCES public."Cart"(id),
    "listingId" text NOT NULL REFERENCES public."Listing"(id),
    quantity integer NOT NULL DEFAULT 1,
    "priceCents" integer NOT NULL DEFAULT 10000,
    "priceVersion" integer NOT NULL DEFAULT 1,
    "selectedVariantOptionIds" text[] NOT NULL DEFAULT '{}'
  );
  CREATE TABLE public."Photo" (
    id text PRIMARY KEY,
    "listingId" text NOT NULL REFERENCES public."Listing"(id),
    url varchar(2048) NOT NULL,
    "sortOrder" integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public."ListingVariantGroup" (
    id text PRIMARY KEY,
    "listingId" text NOT NULL REFERENCES public."Listing"(id),
    name varchar(100) NOT NULL,
    "sortOrder" integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public."ListingVariantOption" (
    id text PRIMARY KEY,
    "groupId" text NOT NULL REFERENCES public."ListingVariantGroup"(id),
    label varchar(100) NOT NULL,
    "priceAdjustCents" integer NOT NULL DEFAULT 0,
    "sortOrder" integer NOT NULL DEFAULT 0,
    "inStock" boolean NOT NULL DEFAULT true
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
  CREATE INDEX "CheckoutStockReservation_checkoutLockKey_idx"
    ON public."CheckoutStockReservation" ("checkoutLockKey");
  CREATE INDEX "CheckoutStockReservation_status_expiresAt_idx"
    ON public."CheckoutStockReservation" (status, "expiresAt");
  CREATE INDEX "CheckoutStockReservation_buyerId_createdAt_idx"
    ON public."CheckoutStockReservation" ("buyerId", "createdAt");
  CREATE INDEX "CheckoutStockReservation_sellerId_createdAt_idx"
    ON public."CheckoutStockReservation" ("sellerId", "createdAt");
  CREATE INDEX "CheckoutStockReservation_buyerId_checkoutGroupId_idx"
    ON public."CheckoutStockReservation" ("buyerId", "checkoutGroupId");
  ALTER TABLE public."CheckoutStockReservation"
    ADD CONSTRAINT "CheckoutStockReservation_status_chk"
    CHECK (status IN ('RESERVED', 'SESSION_CREATED', 'COMPLETED', 'RESTORED')),
    ADD CONSTRAINT "CheckoutStockReservation_reservedItems_array_chk"
    CHECK (pg_catalog.jsonb_typeof("reservedItems") = 'array');

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

  -- Replace the readable fixture body with the exact sealed predecessor bytes
  -- so the compatible migration proves its production source pin.
  CREATE OR REPLACE FUNCTION public.grainline_stripe_webhook_begin(
    p_event_id text,
    p_event_type text
  )
  RETURNS TABLE(action text, claim_generation bigint)
  LANGUAGE plpgsql
  VOLATILE
  PARALLEL UNSAFE
  SECURITY DEFINER
  SET search_path = pg_catalog
  AS $grainline_exact_predecessor$${predecessorWebhookBeginSource}$grainline_exact_predecessor$;

  REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_begin(text, text)
    FROM PUBLIC, grainline_app_runtime;
  GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_begin(text, text)
    TO grainline_app_runtime;
  ALTER TABLE public."StripeWebhookEvent" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."StripeWebhookEvent" FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public."StripeWebhookEvent"
    FROM PUBLIC, grainline_app_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public."CheckoutStockReservation"
    TO grainline_app_runtime;
`;

function rows(result) {
  return result.rows;
}

function sourceSeller() {
  return {
    id: "source-seller",
    userId: "source-seller-user",
    displayName: "Source Shop",
    stripeAccountId: "acct_source",
    stripeAccountVersion: "v2",
    chargesEnabled: true,
    vacationMode: false,
    acceptingNewOrders: true,
    allowLocalPickup: true,
    offersGiftWrapping: true,
    giftWrappingPriceCents: 400,
    defaultPkgWeightGrams: 1200,
    defaultPkgLengthCm: 30,
    defaultPkgWidthCm: 20,
    defaultPkgHeightCm: 10,
    user: { banned: false, deletedAt: null },
  };
}

function sourceListing(overrides = {}) {
  return {
    id: "source-listing",
    sellerId: "source-seller",
    title: "Source listing",
    description: "Proof description",
    priceCents: 10500,
    priceVersion: 7,
    currency: "usd",
    status: "ACTIVE",
    listingType: "IN_STOCK",
    processingTimeMinDays: null,
    processingTimeMaxDays: null,
    shipsWithinDays: null,
    category: null,
    tags: [],
    isPrivate: false,
    reservedForUserId: null,
    packagedWeightGrams: 1100,
    packagedLengthCm: 25,
    packagedWidthCm: 15,
    packagedHeightCm: 8,
    photos: [{ url: "https://cdn.example/source.jpg" }],
    seller: sourceSeller(),
    variantGroups: [{
      id: "source-wood",
      name: "Wood",
      options: [
        { id: "source-oak", label: "Oak", priceAdjustCents: 0, inStock: true },
        { id: "source-walnut", label: "Walnut", priceAdjustCents: 500, inStock: true },
      ],
    }],
    ...overrides,
  };
}

function sourceCartItem(overrides = {}) {
  return {
    id: "source-cart-item",
    listingId: "source-listing",
    quantity: 2,
    priceCents: 11000,
    priceVersion: 7,
    selectedVariantOptionIds: ["source-walnut"],
    listing: sourceListing(),
    ...overrides,
  };
}

async function provePreflightRejection(tamperSql, expectedError) {
  const proofDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-reservation-preflight-reject-"),
  );
  const bootstrap = new PGlite({ dataDir: proofDirectory });
  try {
    await bootstrap.exec("CREATE ROLE ci SUPERUSER LOGIN");
    await bootstrap.exec("CREATE DATABASE grainline_ci OWNER ci");
  } finally {
    await bootstrap.close();
  }

  const predecessor = new PGlite({
    dataDir: proofDirectory,
    username: "ci",
    database: "grainline_ci",
  });
  try {
    await predecessor.exec(SOURCE_SCHEMA);
    await predecessor.exec(tamperSql);
    await assert.rejects(predecessor.exec(draft), expectedError);
    await predecessor.exec("ROLLBACK");

    const sourceColumn = await predecessor.query(`
      SELECT 1
        FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public."StripeWebhookEvent"'::pg_catalog.regclass
         AND attname = 'sourceObjectId'
         AND NOT attisdropped
    `);
    assert.equal(sourceColumn.rows.length, 0);
  } finally {
    await predecessor.close();
    fs.rmSync(proofDirectory, { recursive: true, force: true });
  }
}

async function proveActivationPreflightRejection(tamperSql, expectedError) {
  const proofDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-reservation-activation-reject-"),
  );
  const bootstrap = new PGlite({ dataDir: proofDirectory });
  try {
    await bootstrap.exec("CREATE ROLE ci SUPERUSER LOGIN");
    await bootstrap.exec("CREATE DATABASE grainline_ci OWNER ci");
  } finally {
    await bootstrap.close();
  }

  const predecessor = new PGlite({
    dataDir: proofDirectory,
    username: "ci",
    database: "grainline_ci",
  });
  try {
    await predecessor.exec(SOURCE_SCHEMA);
    await predecessor.exec(draft);
    await predecessor.exec(sourceConsistencyMigration);
    await predecessor.exec(tamperSql);
    await assert.rejects(predecessor.exec(activation), expectedError);
    await predecessor.exec("ROLLBACK");

    const unchanged = rows(await predecessor.query(`
      SELECT
        class.relrowsecurity AS enabled,
        class.relforcerowsecurity AS forced,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'SELECT'
        ) AS can_select,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'INSERT'
        ) AS can_insert,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'UPDATE'
        ) AS can_update,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'DELETE'
        ) AS can_delete
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(unchanged, {
      enabled: false,
      forced: false,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  } finally {
    await predecessor.close();
    fs.rmSync(proofDirectory, { recursive: true, force: true });
  }
}

async function proveForcePreflightRejection(tamperSql, expectedError) {
  const proofDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-reservation-force-reject-"),
  );
  const bootstrap = new PGlite({ dataDir: proofDirectory });
  try {
    await bootstrap.exec("CREATE ROLE ci SUPERUSER LOGIN");
    await bootstrap.exec("CREATE DATABASE grainline_ci OWNER ci");
  } finally {
    await bootstrap.close();
  }

  const predecessor = new PGlite({
    dataDir: proofDirectory,
    username: "ci",
    database: "grainline_ci",
  });
  try {
    await predecessor.exec(SOURCE_SCHEMA);
    await predecessor.exec(draft);
    await predecessor.exec(sourceConsistencyMigration);
    await predecessor.exec(activation);
    await predecessor.exec(tamperSql);
    await assert.rejects(predecessor.exec(force), expectedError);
    await predecessor.exec("ROLLBACK");

    const unchanged = rows(await predecessor.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(unchanged, { enabled: true, forced: false });
  } finally {
    await predecessor.close();
    fs.rmSync(proofDirectory, { recursive: true, force: true });
  }
}

describe("CheckoutStockReservation fixed authority in disposable PostgreSQL", () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "grainline-reservation-proof-"),
    );
    const bootstrap = new PGlite({ dataDir: dataDirectory });
    await bootstrap.exec("CREATE ROLE ci SUPERUSER LOGIN");
    await bootstrap.exec("CREATE DATABASE grainline_ci OWNER ci");
    await bootstrap.close();
    db = new PGlite({
      dataDir: dataDirectory,
      username: "ci",
      database: "grainline_ci",
    });
    await db.exec(SOURCE_SCHEMA);
    await db.exec(draft);
    await db.exec(sourceConsistencyMigration);
    await db.exec(`
      INSERT INTO public."User" (id) VALUES
        ('buyer-a'), ('buyer-b'), ('seller-user'), ('seller-user-b'),
        ('source-buyer'), ('source-seller-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "stripeAccountVersion", "chargesEnabled"
      ) VALUES
        ('seller-a', 'seller-user', 'acct_a', 'v2', true),
        ('seller-b', 'seller-user-b', 'acct_b', 'v2', true);
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "stripeAccountId", "stripeAccountVersion",
        "chargesEnabled", "vacationMode", "acceptingNewOrders",
        "allowLocalPickup", "offersGiftWrapping", "giftWrappingPriceCents",
        "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm",
        "defaultPkgHeightCm"
      ) VALUES (
        'source-seller', 'source-seller-user', 'Source Shop', 'acct_source', 'v2',
        true, false, true, true, true, 400, 1200, 30, 20, 10
      );
      INSERT INTO public."Cart" (id, "userId") VALUES
        ('cart-a', 'buyer-a'),
        ('source-cart', 'source-buyer');
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate", "reservedForUserId"
      ) VALUES
        ('listing-a', 'seller-a', 'ACTIVE', 'IN_STOCK', 8, false, NULL),
        ('listing-private', 'seller-a', 'ACTIVE', 'IN_STOCK', 3, true, 'buyer-a'),
        ('listing-mto', 'seller-a', 'ACTIVE', 'MADE_TO_ORDER', NULL, false, NULL);
      INSERT INTO public."Listing" (
        id, "sellerId", title, "priceCents", "priceVersion", currency,
        status, "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
        "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm", "packagedHeightCm"
      ) VALUES (
        'source-listing', 'source-seller', 'Source listing', 10500, 7, 'usd',
        'ACTIVE', 'IN_STOCK', 20, false, NULL, 1100, 25, 15, 8
      );
      INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity) VALUES
        ('cart-item-a', 'cart-a', 'listing-a', 2),
        ('cart-item-private', 'cart-a', 'listing-private', 1),
        ('cart-item-mto', 'cart-a', 'listing-mto', 1);
      INSERT INTO public."CartItem" (
        id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
        "selectedVariantOptionIds"
      ) VALUES (
        'source-cart-item', 'source-cart', 'source-listing', 2, 11000, 7,
        ARRAY['source-walnut']
      );
      INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
        ('source-photo', 'source-listing', 'https://cdn.example/source.jpg', 0);
      INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder") VALUES
        ('source-wood', 'source-listing', 'Wood', 0);
      INSERT INTO public."ListingVariantOption" (
        id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock"
      ) VALUES
        ('source-oak', 'source-wood', 'Oak', 0, 0, true),
        ('source-walnut', 'source-wood', 'Walnut', 500, 1, true);
    `);
  });

  after(async () => {
    await db?.close();
    if (dataDirectory) {
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
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
        ) AS can_private_bind_event,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) AS can_create_consistent_cart,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_create_single_consistent(text,text,integer,text[],text,jsonb)',
          'EXECUTE'
        ) AS can_create_consistent_single,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_listing_witness(text)',
          'EXECUTE'
        ) AS can_read_private_witness,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_variant_source_valid(text,text[],integer)',
          'EXECUTE'
        ) AS can_call_private_variant_validator
    `));
    assert.deepEqual(privileges[0], {
      can_create: true,
      can_private_restore: false,
      can_private_validate: false,
      can_begin_bound_event: true,
      can_private_bind_event: false,
      can_create_consistent_cart: true,
      can_create_consistent_single: true,
      can_read_private_witness: false,
      can_call_private_variant_validator: false,
    });
  });

  it("creates from the exact single-statement source witness as the restricted runtime", async () => {
    const witness = singleCheckoutReservationSourceWitness(
      "source-buyer",
      sourceListing(),
      1,
      ["source-walnut"],
    );
    assert.ok(witness);
    const stockBefore = Number(rows(await db.query(`
      SELECT "stockQuantity" FROM public."Listing" WHERE id = 'source-listing'
    `))[0].stockQuantity);

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const created = rows(await db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_single_consistent(
          $1, $2, $3, $4::text[], $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-listing",
        1,
        ["source-walnut"],
        "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
        witness,
      ]));
      assert.equal(created.length, 1);
      assert.deepEqual(created[0].reserved_items, [{
        listingId: "source-listing",
        sellerId: "source-seller",
        quantity: 1,
      }]);
      await db.exec("RESET ROLE");
      assert.equal(Number(rows(await db.query(`
        SELECT "stockQuantity" FROM public."Listing" WHERE id = 'source-listing'
      `))[0].stockQuantity), stockBefore - 1);
    } finally {
      await db.exec("ROLLBACK");
    }

    assert.equal(Number(rows(await db.query(`
      SELECT "stockQuantity" FROM public."Listing" WHERE id = 'source-listing'
    `))[0].stockQuantity), stockBefore);
  });

  it("atomically rolls back reservation and stock when source changes", async () => {
    const witness = singleCheckoutReservationSourceWitness(
      "source-buyer",
      sourceListing(),
      1,
      ["source-walnut"],
    );
    const stockBefore = Number(rows(await db.query(`
      SELECT "stockQuantity" FROM public."Listing" WHERE id = 'source-listing'
    `))[0].stockQuantity);
    await db.exec(`UPDATE public."Listing" SET title = 'Changed after snapshot' WHERE id = 'source-listing'`);
    await assert.rejects(
      db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_single_consistent(
          $1, $2, $3, $4::text[], $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-listing",
        1,
        ["source-walnut"],
        "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
        witness,
      ]),
      /Checkout source witness changed/,
    );
    assert.equal(Number(rows(await db.query(`
      SELECT "stockQuantity" FROM public."Listing" WHERE id = 'source-listing'
    `))[0].stockQuantity), stockBefore);
    assert.equal(Number(rows(await db.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."CheckoutStockReservation"
       WHERE "payloadHash" = 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT'
    `))[0].count), 0);
    await db.exec(`UPDATE public."Listing" SET title = 'Source listing' WHERE id = 'source-listing'`);
  });

  it("permits only quantity one for made-to-order checkout without inventing stock", async () => {
    let witness;
    await db.exec("BEGIN");
    try {
      await db.exec(`
        UPDATE public."Listing"
           SET "listingType" = 'MADE_TO_ORDER', "stockQuantity" = NULL
         WHERE id = 'source-listing'
      `);
      witness = singleCheckoutReservationSourceWitness(
        "source-buyer",
        sourceListing({ listingType: "MADE_TO_ORDER" }),
        1,
        ["source-walnut"],
      );
      assert.ok(witness);

      const created = rows(await db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_single_consistent(
          $1, $2, $3, $4::text[], $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-listing",
        1,
        ["source-walnut"],
        "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
        witness,
      ]));
      assert.deepEqual(created, []);
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("BEGIN");
    try {
      await db.exec(`
        UPDATE public."Listing"
           SET "listingType" = 'MADE_TO_ORDER', "stockQuantity" = NULL
         WHERE id = 'source-listing'
      `);
      await assert.rejects(
        db.query(`
          SELECT * FROM public.grainline_checkout_reservation_create_single_consistent(
            $1, $2, $3, $4::text[], $5, $6::jsonb
          )
        `, [
          "source-buyer",
          "source-listing",
          2,
          ["source-walnut"],
          "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN",
          witness,
        ]),
        /Checkout source witness changed/,
      );
    } finally {
      await db.exec("ROLLBACK").catch(() => {});
    }

    assert.equal(Number(rows(await db.query(`
      SELECT pg_catalog.count(*) AS count
        FROM public."CheckoutStockReservation"
       WHERE "payloadHash" IN (
         'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
         'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN'
       )
    `))[0].count), 0);
  });

  it("persists cart and made-to-order checkout source snapshots in real PostgreSQL", async () => {
    const cartWitness = cartCheckoutReservationSnapshotWitness(
      "source-buyer",
      "source-seller",
      [sourceCartItem()],
    );
    assert.ok(cartWitness);

    await db.exec("BEGIN");
    try {
      await db.exec(orderCheckoutSourceSnapshotCandidate);
      const forgedCartWitness = JSON.stringify({
        ...JSON.parse(cartWitness),
        items: [{ ...JSON.parse(cartWitness).items[0], quantity: 99 }],
      });
      await db.exec("SAVEPOINT forged_cart_source");
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(
        db.query(`
          SELECT * FROM public.grainline_checkout_reservation_create_cart_snapshot(
            $1, $2, $3, $4, $5, $6::jsonb
          )
        `, [
          "source-buyer",
          "source-cart",
          "source-seller",
          "snapshot-group",
          "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          forgedCartWitness,
        ]),
        /Checkout source witness changed/,
      );
      await db.exec("ROLLBACK TO SAVEPOINT forged_cart_source");
      await db.exec("RESET ROLE");
      assert.equal(Number(rows(await db.query(`
        SELECT pg_catalog.count(*) AS count
          FROM public."CheckoutStockReservation"
         WHERE "payloadHash" = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      `))[0].count), 0);

      const forgedHistoryWitness = JSON.stringify({
        ...JSON.parse(cartWitness),
        items: [{
          ...JSON.parse(cartWitness).items[0],
          listing: {
            ...JSON.parse(cartWitness).items[0].listing,
            description: "Description changed after checkout",
          },
        }],
      });
      await db.exec("SAVEPOINT forged_history_source");
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(
        db.query(`
          SELECT * FROM public.grainline_checkout_reservation_create_cart_snapshot(
            $1, $2, $3, $4, $5, $6::jsonb
          )
        `, [
          "source-buyer",
          "source-cart",
          "source-seller",
          "snapshot-group",
          "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
          forgedHistoryWitness,
        ]),
        /Checkout source snapshot changed/,
      );
      await db.exec("ROLLBACK TO SAVEPOINT forged_history_source");
      await db.exec("RESET ROLE");
      assert.equal(Number(rows(await db.query(`
        SELECT pg_catalog.count(*) AS count
          FROM public."CheckoutStockReservation"
         WHERE "payloadHash" = 'HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH'
      `))[0].count), 0);
      assert.equal(rows(await db.query(`
        SELECT pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_listing_snapshot_witness(text)',
          'EXECUTE'
        ) AS can_read_snapshot_witness
      `))[0].can_read_snapshot_witness, false);

      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const cartCreated = rows(await db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_cart_snapshot(
          $1, $2, $3, $4, $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-cart",
        "source-seller",
        "snapshot-group",
        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        cartWitness,
      ]));
      assert.equal(cartCreated.length, 1);

      await db.exec("RESET ROLE");
      await db.exec(`
        UPDATE public."Listing"
           SET "listingType" = 'MADE_TO_ORDER', "stockQuantity" = NULL
         WHERE id = 'source-listing'
      `);
      const madeToOrderWitness = singleCheckoutReservationSnapshotWitness(
        "source-buyer",
        sourceListing({ listingType: "MADE_TO_ORDER" }),
        1,
        ["source-walnut"],
      );
      assert.ok(madeToOrderWitness);

      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const singleCreated = rows(await db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_single_snapshot(
          $1, $2, $3, $4::text[], $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-listing",
        1,
        ["source-walnut"],
        "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        madeToOrderWitness,
      ]));
      assert.equal(singleCreated.length, 1);
      assert.deepEqual(singleCreated[0].reserved_items, []);

      await db.exec("SAVEPOINT duplicate_made_to_order");
      await assert.rejects(
        db.query(`
          SELECT * FROM public.grainline_checkout_reservation_create_single_snapshot(
            $1, $2, $3, $4::text[], $5, $6::jsonb
          )
        `, [
          "source-buyer",
          "source-listing",
          1,
          ["source-walnut"],
          "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          madeToOrderWitness,
        ]),
        /CheckoutStockReservation_active_lock_key|duplicate key/,
      );
      await db.exec("ROLLBACK TO SAVEPOINT duplicate_made_to_order");

      await db.exec("RESET ROLE");
      const persisted = rows(await db.query(`
        SELECT "payloadHash" AS payload_hash,
               "reservedItems" AS reserved_items,
               "sourceSnapshot" AS source_snapshot
          FROM public."CheckoutStockReservation"
         WHERE "payloadHash" IN (
           'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
           'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
         )
         ORDER BY "payloadHash"
      `));
      assert.equal(persisted.length, 2);
      assert.deepEqual(persisted[0].source_snapshot, JSON.parse(cartWitness));
      assert.deepEqual(persisted[1].reserved_items, []);
      assert.deepEqual(persisted[1].source_snapshot, JSON.parse(madeToOrderWitness));
    } finally {
      await db.exec("ROLLBACK").catch(() => {});
    }
  });

  it("binds the complete variant graph and validates cart price inside PostgreSQL", async () => {
    const singleWitness = singleCheckoutReservationSourceWitness(
      "source-buyer",
      sourceListing(),
      1,
      ["source-walnut"],
    );
    await db.exec(`
      INSERT INTO public."ListingVariantOption" (
        id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock"
      ) VALUES ('source-maple', 'source-wood', 'Maple', 250, 2, true)
    `);
    await assert.rejects(
      db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_single_consistent(
          $1, $2, $3, $4::text[], $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-listing",
        1,
        ["source-walnut"],
        "UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU",
        singleWitness,
      ]),
      /Checkout source witness changed/,
    );
    await db.exec(`DELETE FROM public."ListingVariantOption" WHERE id = 'source-maple'`);

    const cartWitness = cartCheckoutReservationSourceWitness(
      "source-buyer",
      "source-seller",
      [sourceCartItem()],
    );
    assert.ok(cartWitness);
    await db.exec(`UPDATE public."CartItem" SET "priceCents" = 10999 WHERE id = 'source-cart-item'`);
    await assert.rejects(
      db.query(`
        SELECT * FROM public.grainline_checkout_reservation_create_cart_consistent(
          $1, $2, $3, $4, $5, $6::jsonb
        )
      `, [
        "source-buyer",
        "source-cart",
        "source-seller",
        "source-group",
        "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",
        cartWitness,
      ]),
      /Checkout source witness changed/,
    );
    await db.exec(`UPDATE public."CartItem" SET "priceCents" = 11000 WHERE id = 'source-cart-item'`);
  });

  it("proves the source-consistent function catalog through the runtime role", async () => {
    await db.exec("SET ROLE grainline_app_runtime");
    try {
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const transaction = await db.query(`
        SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
               pg_catalog.current_setting('transaction_read_only') AS read_only
      `);
      assert.deepEqual(transaction.rows, [{
        isolation: "repeatable read",
        read_only: "on",
      }]);
      await verifyReservationAuthorityRuntimeIdentity(db, {
        databaseName: "grainline_ci",
        runtimeRole: "grainline_app_runtime",
      }, "ci", "postgres");
      await verifyReservationCompatibleTablePosture(db, "ci");
      await verifyReservationCompatibleSchema(db);
      await verifyReservationSourceConsistentFunctionCatalog(db, "ci");
      const direct = await db.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public."CheckoutStockReservation"
      `);
      assert.ok(Number.isSafeInteger(direct.rows[0]?.count));
      const fixed = await db.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public.grainline_checkout_reservation_export(
            'grainline-authority-postflight-absent-user'
          )
      `);
      assert.deepEqual(fixed.rows, [{ count: 0 }]);
      await db.exec("ROLLBACK");
    } finally {
      await db.exec("ROLLBACK").catch(() => {});
      await db.exec("RESET ROLE");
    }
  });

  it("pins the complete function catalog and runtime/PUBLIC ACL partition", async () => {
    const catalogRows = rows(await db.query(`
      SELECT
        procedure.proname AS name,
        pg_catalog.oidvectortypes(procedure.proargtypes) AS "argumentTypes",
        procedure.prosecdef AS "securityDefiner",
        procedure.provolatile AS volatility,
        procedure.proparallel AS "parallelSafety",
        procedure.proconfig AS configuration,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', procedure.oid, 'EXECUTE'
        ) AS "runtimeExecute",
        pg_catalog.has_function_privilege(
          'grainline_untrusted', procedure.oid, 'EXECUTE'
        ) AS "publicExecute"
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = ANY($1::text[])
    `, [[...new Set(
      CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.map((entry) => entry.name),
    )]]));
    const expectedKeys = new Set(
      CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.map(
        (entry) => `${entry.name}(${entry.argumentTypes})`,
      ),
    );
    const reviewedRows = catalogRows.filter((entry) => (
      expectedKeys.has(`${entry.name}(${entry.argumentTypes})`)
    ));

    assert.deepEqual(
      reviewedRows
        .map((entry) => ({
          ...entry,
          configuration: [...(entry.configuration ?? [])],
        }))
        .sort((left, right) => (
          `${left.name}(${left.argumentTypes})`
            .localeCompare(`${right.name}(${right.argumentTypes})`)
        )),
      CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS
        .map((entry) => ({
          name: entry.name,
          argumentTypes: entry.argumentTypes,
          securityDefiner: true,
          volatility: entry.volatility,
          parallelSafety: entry.parallelSafety,
          configuration: ["search_path=pg_catalog"],
          runtimeExecute: entry.runtimeExecute,
          publicExecute: false,
        }))
        .sort((left, right) => (
          `${left.name}(${left.argumentTypes})`
            .localeCompare(`${right.name}(${right.argumentTypes})`)
        )),
    );
  });

  it("preserves predecessor direct CRUD through private trigger and check helpers", async () => {
    await db.exec("BEGIN");
    try {
      await db.exec(`
        SET LOCAL ROLE grainline_app_runtime;
        INSERT INTO public."CheckoutStockReservation" (
          id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId", status,
          "reservedItems", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          'predecessor-direct-crud', 'checkout:predecessor:direct-crud',
          'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'buyer-a', 'seller-a', 'RESERVED',
          '[{"listingId":"listing-a","sellerId":"seller-a","quantity":1}]',
          CURRENT_TIMESTAMP + interval '31 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        UPDATE public."CheckoutStockReservation"
           SET "restoreReason" = 'session_retrieve_failed'
         WHERE id = 'predecessor-direct-crud';
      `);
      const normalized = rows(await db.query(`
        SELECT "restoreReason", "restoredAt", "lastRepairError",
               "lastRepairAttemptAt" IS NOT NULL AS attempted
          FROM public."CheckoutStockReservation"
         WHERE id = 'predecessor-direct-crud'
      `))[0];
      assert.deepEqual(normalized, {
        restoreReason: null,
        restoredAt: null,
        lastRepairError: "session_retrieve_failed",
        attempted: true,
      });
      await db.exec(`
        DELETE FROM public."CheckoutStockReservation"
         WHERE id = 'predecessor-direct-crud'
      `);
    } finally {
      await db.exec("ROLLBACK");
    }
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

  it("activates, FORCE-hardens, rolls FORCE back, and rolls Phase A back database-first", async () => {
    // PGlite RESET ROLE returns to its internal bootstrap superuser even when
    // the proof connection was opened with username=ci. Re-enter the exact
    // migration-owner identity before exercising the owner-bound activation.
    await db.exec("SET ROLE ci");
    const predecessor = rows(await db.query(`
      SELECT
        CURRENT_USER AS current_user_name,
        pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
        class.relrowsecurity AS enabled,
        class.relforcerowsecurity AS forced
      FROM pg_catalog.pg_class AS class
      WHERE class.oid =
            'public."CheckoutStockReservation"'::pg_catalog.regclass
    `));
    assert.deepEqual(predecessor, [{
      current_user_name: "ci",
      owner_name: "ci",
      enabled: false,
      forced: false,
    }]);
    await db.exec(activation);

    const activated = rows(await db.query(`
      SELECT
        class.relrowsecurity AS enabled,
        class.relforcerowsecurity AS forced,
        (
          SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = class.oid
        ) AS policy_count,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ) AS runtime_table_authority
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(activated, {
      enabled: true,
      forced: false,
      policy_count: 0,
      runtime_table_authority: false,
    });

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(
        db.query('SELECT id FROM public."CheckoutStockReservation" LIMIT 1'),
        /permission denied for table CheckoutStockReservation/,
      );
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await verifyCheckoutStockReservationActivatedCatalog(db, "ci");
      const fixedRead = rows(await db.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public.grainline_checkout_reservation_export('buyer-a')
      `))[0];
      assert.equal(fixedRead.count, 0);
      await assert.rejects(
        db.query(`
          SELECT public.grainline_checkout_reservation_restore_items('[]'::jsonb)
        `),
        /permission denied for function grainline_checkout_reservation_restore_items/,
      );
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("SET ROLE ci");
    await db.exec(force);
    const forced = rows(await db.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = class.oid) AS policy_count
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(forced, {
      enabled: true,
      forced: true,
      policy_count: 0,
    });

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await verifyCheckoutStockReservationActivatedCatalog(db, "ci", true);
      await assert.rejects(
        db.query('SELECT id FROM public."CheckoutStockReservation" LIMIT 1'),
        /permission denied for table CheckoutStockReservation/,
      );
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const fixedRead = rows(await db.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public.grainline_checkout_reservation_export('buyer-a')
      `))[0];
      assert.equal(fixedRead.count, 0);
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("SET ROLE ci");
    await db.exec(forceRollback);
    const phaseARestored = rows(await db.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(phaseARestored, { enabled: true, forced: false });

    await db.exec(activationRollback);
    const restored = rows(await db.query(`
      SELECT
        class.relrowsecurity AS enabled,
        class.relforcerowsecurity AS forced,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'SELECT'
        ) AS can_select,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'INSERT'
        ) AS can_insert,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'UPDATE'
        ) AS can_update,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', class.oid, 'DELETE'
        ) AS can_delete
        FROM pg_catalog.pg_class AS class
       WHERE class.oid =
             'public."CheckoutStockReservation"'::pg_catalog.regclass
    `))[0];
    assert.deepEqual(restored, {
      enabled: false,
      forced: false,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  });
});

describe("CheckoutStockReservation FORCE preflight in disposable PostgreSQL", () => {
  it("fails closed without partially forcing on post-Phase-A function drift", async () => {
    await proveForcePreflightRejection(
      `ALTER FUNCTION public.grainline_checkout_reservation_export(text)
         RENAME TO grainline_checkout_reservation_export_drifted`,
      /CheckoutStockReservation FORCE function catalog drifted/,
    );
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

  it("pins the complete signature-level runtime/private partition", () => {
    const runtime = CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS
      .filter((entry) => entry.runtimeExecute);
    const privateHelpers = CHECKOUT_STOCK_RESERVATION_BASE_AUTHORITY_FUNCTIONS
      .filter((entry) => !entry.runtimeExecute);
    assert.equal(runtime.length, 16);
    assert.equal(privateHelpers.length, 4);
    assert.equal(
      runtime.filter((entry) => entry.name.startsWith("grainline_checkout_reservation_")).length,
      15,
    );
    assert.deepEqual(
      privateHelpers.map((entry) => entry.name).sort(),
      [
        "grainline_checkout_reservation_items_valid",
        "grainline_checkout_reservation_normalize_write",
        "grainline_checkout_reservation_restore_items",
        "grainline_stripe_webhook_bind_source",
      ],
    );
  });

  it("refuses to collapse the separate StripeWebhookEvent FORCE boundary", async () => {
    const predecessor = new PGlite();
    try {
      const notForced = SOURCE_SCHEMA
        .replace('  ALTER TABLE public."StripeWebhookEvent" ENABLE ROW LEVEL SECURITY;\n', "")
        .replace('  ALTER TABLE public."StripeWebhookEvent" FORCE ROW LEVEL SECURITY;\n', "")
        .replace(
          '  REVOKE ALL ON TABLE public."StripeWebhookEvent"\n    FROM PUBLIC, grainline_app_runtime;\n',
          '  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."StripeWebhookEvent" TO grainline_app_runtime;\n',
        );
      await predecessor.exec(notForced);
      await assert.rejects(
        predecessor.exec(draft),
        /requires the exact FORCE-hardened StripeWebhookEvent predecessor/,
      );
      await predecessor.exec("ROLLBACK");
      const column = await predecessor.query(`
        SELECT 1
          FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public."StripeWebhookEvent"'::pg_catalog.regclass
           AND attname = 'sourceObjectId'
           AND NOT attisdropped
      `);
      assert.equal(column.rows.length, 0);
    } finally {
      await predecessor.close();
    }
  });

  it("fails closed on unsafe runtime posture and unreviewed membership", async (context) => {
    await context.test("rejects runtime INHERIT", async () => {
      await provePreflightRejection(
        "ALTER ROLE grainline_app_runtime INHERIT",
        /runtime role posture is not reservation-authority safe/,
      );
    });
    await context.test("rejects an unreviewed role membership edge", async () => {
      await provePreflightRejection(`
        CREATE ROLE grainline_shadow NOLOGIN;
        GRANT grainline_app_runtime TO grainline_shadow;
      `, /runtime role retains unreviewed membership/);
    });
    await context.test("rejects one missing required CRUD privilege", async () => {
      await provePreflightRejection(`
        REVOKE DELETE
          ON TABLE public."CheckoutStockReservation"
          FROM grainline_app_runtime;
      `, /predecessor CRUD grants drifted/);
    });
    await context.test("rejects a missing validated predecessor constraint", async () => {
      await provePreflightRejection(`
        ALTER TABLE public."CheckoutStockReservation"
          DROP CONSTRAINT "CheckoutStockReservation_reservedItems_array_chk";
      `, /validated predecessor constraints drifted/);
    });
  });

  it("fails closed on residual PUBLIC/column authority and predecessor source drift", async (context) => {
    await context.test("rejects PUBLIC column authority", async () => {
      await provePreflightRejection(`
        GRANT SELECT ("buyerId")
          ON TABLE public."CheckoutStockReservation"
          TO PUBLIC;
      `, /predecessor retains unreviewed PUBLIC or column authority/);
    });
    await context.test("rejects source-only drift in the predecessor webhook function", async () => {
      await provePreflightRejection(`
        CREATE OR REPLACE FUNCTION public.grainline_stripe_webhook_begin(
          p_event_id text,
          p_event_type text
        )
        RETURNS TABLE(action text, claim_generation bigint)
        LANGUAGE plpgsql
        VOLATILE
        PARALLEL UNSAFE
        SECURITY DEFINER
        SET search_path = pg_catalog
        AS $grainline_drifted_predecessor$
${predecessorWebhookBeginSource}
        -- Deliberate source-only drift: behavior and catalog attributes stay unchanged.
        $grainline_drifted_predecessor$;
      `, /predecessor webhook begin function drifted/);
    });
  });
});

describe("CheckoutStockReservation activation preflight in disposable PostgreSQL", () => {
  it("fails closed without partially activating on authority drift", async (context) => {
    await context.test("rejects an explicit runtime column ACL", async () => {
      await proveActivationPreflightRejection(`
        GRANT SELECT ("buyerId")
          ON TABLE public."CheckoutStockReservation"
          TO grainline_app_runtime;
      `, /activation predecessor retains PUBLIC or column authority/);
    });

    await context.test("rejects a lifecycle-invalid ledger row", async () => {
      await proveActivationPreflightRejection(`
        ALTER TABLE public."CheckoutStockReservation"
          DISABLE TRIGGER "CheckoutStockReservation_normalize_write";
        INSERT INTO public."CheckoutStockReservation" (
          id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId",
          "stripeSessionId", status, "reservedItems", "expiresAt",
          "createdAt", "updatedAt"
        ) VALUES (
          'activation-invalid', 'checkout:activation:invalid',
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'buyer-a', 'seller-a',
          'cs_activation_invalid', 'RESERVED', '[]'::jsonb,
          CURRENT_TIMESTAMP + interval '30 minutes',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        ALTER TABLE public."CheckoutStockReservation"
          ENABLE TRIGGER "CheckoutStockReservation_normalize_write";
      `, /activation found 1 invalid rows/);
    });

    await context.test("rejects an extra unreviewed trigger", async () => {
      await proveActivationPreflightRejection(`
        CREATE FUNCTION public.grainline_unreviewed_reservation_trigger()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $grainline_unreviewed_reservation_trigger$
        BEGIN
          RETURN NEW;
        END
        $grainline_unreviewed_reservation_trigger$;
        CREATE TRIGGER "CheckoutStockReservation_unreviewed"
          BEFORE INSERT ON public."CheckoutStockReservation"
          FOR EACH ROW
          EXECUTE FUNCTION public.grainline_unreviewed_reservation_trigger();
      `, /trigger catalog drifted: actual 2, accepted 1/);
    });

    await context.test("rejects a name-only index lookalike", async () => {
      await proveActivationPreflightRejection(`
        DROP INDEX public."CheckoutStockReservation_checkoutLockKey_idx";
        CREATE INDEX "CheckoutStockReservation_checkoutLockKey_idx"
          ON public."CheckoutStockReservation"("buyerId");
      `, /index catalog drifted: actual 9, accepted 8/);
    });

    await context.test("rejects a name-only constraint lookalike", async () => {
      await proveActivationPreflightRejection(`
        ALTER TABLE public."CheckoutStockReservation"
          DROP CONSTRAINT "CheckoutStockReservation_status_chk";
        ALTER TABLE public."CheckoutStockReservation"
          ADD CONSTRAINT "CheckoutStockReservation_status_chk"
          CHECK (true);
      `, /constraint catalog drifted: actual 5, accepted 4/);
    });

    await context.test("rejects leaked private-helper EXECUTE", async () => {
      await proveActivationPreflightRejection(`
        GRANT EXECUTE ON FUNCTION
          public.grainline_checkout_reservation_restore_items(jsonb)
          TO grainline_app_runtime;
      `, /activation function catalog drifted: actual 25, accepted 24/);
    });
  });
});
