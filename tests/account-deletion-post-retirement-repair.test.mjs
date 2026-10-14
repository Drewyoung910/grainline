import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  inspectFunctionDefinitions,
} from "../scripts/seller-profile-retired-function-reference-postgres-proof.mjs";
import {
  REPAIR_CHECKSUM,
  REPAIR_MIGRATION,
} from "../scripts/account-deletion-post-retirement-production-inspect.mjs";

const repair = readFileSync(
  "prisma/migrations/20261015013000_repair_account_deletion_after_seller_profile_retirement/migration.sql",
  "utf8",
);

async function createRetiredFixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public._prisma_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      finished_at timestamp with time zone,
      migration_name text NOT NULL,
      logs text,
      rolled_back_at timestamp with time zone,
      started_at timestamp with time zone NOT NULL,
      applied_steps_count integer NOT NULL
    );
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, started_at, applied_steps_count
    ) VALUES (
      'retirement',
      'd111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a',
      CURRENT_TIMESTAMP,
      '20261015010000_retire_seller_profile_private_predecessor',
      CURRENT_TIMESTAMP,
      1
    );

    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'PICKED_UP', 'CANCELED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL,
      email varchar(254) NOT NULL,
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
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "shipFromName" varchar(100),
      "shipFromLine1" varchar(200),
      "shipFromLine2" varchar(200),
      "shipFromCity" varchar(100),
      "shipFromState" varchar(50),
      "shipFromPostal" varchar(20),
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL,
      kind varchar(40) NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      attempts integer NOT NULL DEFAULT 0,
      "claimGeneration" bigint NOT NULL DEFAULT 0,
      "claimToken" uuid,
      "processingStartedAt" timestamp(3) without time zone,
      "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
      "processedAt" timestamp(3) without time zone,
      "lastError" varchar(1000),
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE public."OrderShippingRateQuote" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE
    );

    CREATE FUNCTION public.grainline_account_deletion_redact_text_core(
      p_body text,
      p_sensitive_values text[]
    ) RETURNS text
    LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
    AS 'SELECT p_body';

    CREATE FUNCTION public.grainline_order_account_deletion_blockers(
      p_actor_user_id text
    ) RETURNS TABLE(buyer_order_count bigint, seller_order_count bigint)
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
    AS 'SELECT 0::bigint, 0::bigint';

    CREATE FUNCTION public.grainline_account_deletion_side_effect_claim(text)
    RETURNS TABLE(
      action text, side_effect_id text, user_id text, effect_kind text,
      effect_payload jsonb, attempt_count integer, claim_generation bigint,
      claim_token text
    ) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
    AS 'BEGIN RETURN; END';

    CREATE FUNCTION public.grainline_order_account_deletion_scrub(text, text[])
    RETURNS TABLE(
      review_notes_redacted bigint, buyer_orders_scrubbed bigint,
      seller_orders_scrubbed bigint, shipping_quotes_deleted bigint
    ) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
    AS 'BEGIN RETURN; END';
  `);
  await database.exec(repair);
  return database;
}

test("post-retirement repair restores varchar claim results and buyer/seller scrubs", async () => {
  const database = await createRetiredFixture();
  try {
    await database.exec(`
      INSERT INTO public."User" (id, "clerkId", email, name) VALUES
        ('buyer-repair', 'clerk-buyer-repair', 'buyer@example.test', 'Buyer Repair'),
        ('seller-repair', 'clerk-seller-repair', 'seller@example.test', 'Seller Repair');
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", city, state, tagline
      ) VALUES (
        'seller-profile-repair', 'seller-repair', 'Seller Repair Shop',
        'Austin', 'TX', 'Repair tagline'
      );
      INSERT INTO public."SellerProfilePrivate" (
        "sellerProfileId", "shipFromName", "shipFromLine1", "shipFromCity",
        "shipFromState", "shipFromPostal"
      ) VALUES (
        'seller-profile-repair', 'Seller Repair', '2 Seller Lane', 'Austin',
        'TX', '78702'
      );
      INSERT INTO public."AccountDeletionSideEffect" (
        id, "userId", kind, payload
      ) VALUES (
        'effect-repair', 'buyer-repair', 'LOCAL_ANONYMIZE', '{}'::jsonb
      );
    `);

    const claim = await database.query(`
      SELECT *
        FROM public.grainline_account_deletion_side_effect_claim('effect-repair')
    `);
    assert.equal(claim.rows[0].action, "process");
    assert.equal(claim.rows[0].user_id, "buyer-repair");
    assert.equal(claim.rows[0].effect_kind, "LOCAL_ANONYMIZE");

    for (const actor of ["buyer-repair", "seller-repair"]) {
      await database.exec("BEGIN");
      try {
        await database.query(
          "SELECT pg_catalog.set_config('app.user_id', $1, true)",
          [actor],
        );
        const scrub = await database.query(
          "SELECT * FROM public.grainline_order_account_deletion_scrub($1, ARRAY[]::text[])",
          [actor],
        );
        assert.equal(scrub.rows.length, 1);
        assert.equal(Number(scrub.rows[0].buyer_orders_scrubbed), 0);
        assert.equal(Number(scrub.rows[0].seller_orders_scrubbed), 0);
        await database.exec("COMMIT");
      } catch (error) {
        await database.exec("ROLLBACK");
        throw error;
      }
    }

    const definitions = await database.query(`
      SELECT procedure.oid::regprocedure::text AS identity,
             pg_catalog.pg_get_functiondef(procedure.oid) AS definition
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid IN (
         'public.grainline_account_deletion_side_effect_claim(text)'::regprocedure,
         'public.grainline_order_account_deletion_scrub(text,text[])'::regprocedure
       )
       ORDER BY identity
    `);
    assert.match(definitions.rows[0].definition, /"userId"::text/u);
    assert.match(definitions.rows[0].definition, /kind::text/u);
    assert.doesNotMatch(definitions.rows[1].definition, /SellerProfile"%ROWTYPE/u);
    assert.match(definitions.rows[1].definition, /SellerProfilePrivate/u);
  } finally {
    await database.close();
  }
});

test("legacy Order inspection reads authoritative private shipping fields", () => {
  const source = readFileSync(
    "scripts/order-payment-shipping-legacy-inspect.mjs",
    "utf8",
  );
  const candidateStart = source.indexOf("label_package_candidates AS (");
  const candidateEnd = source.indexOf("), label_package_rollup AS (", candidateStart);
  const candidate = source.slice(candidateStart, candidateEnd);
  assert.match(candidate, /JOIN public\."SellerProfilePrivate" AS seller_private/u);
  assert.match(candidate, /seller_private\."shipFromLine1"/u);
  assert.match(candidate, /seller_private\."shipFromCountry"/u);
  assert.doesNotMatch(candidate, /seller\."shipFrom/u);
});

test("vacation-mode update does not return retired SellerProfile columns", () => {
  const source = readFileSync(
    "src/app/api/seller/vacation/route.ts",
    "utf8",
  );
  assert.match(
    source,
    /prisma\.sellerProfile\.update\(\{[\s\S]*?data: \{ vacationMode, vacationReturnDate, vacationMessage \},[\s\S]*?select: \{ id: true \}/u,
  );
});

test("signature-keyed catalog scan rejects retired public SellerProfile references", () => {
  const offenders = inspectFunctionDefinitions([
    {
      identity: "grainline_bad_rowtype(text)",
      definition: `
        CREATE FUNCTION public.grainline_bad_rowtype(text) RETURNS text
        LANGUAGE plpgsql AS $$
        DECLARE source_seller public."SellerProfile"%ROWTYPE;
        BEGIN RETURN source_seller."shipFromName"; END
        $$;
      `,
    },
    {
      identity: "grainline_bad_alias(text)",
      definition: `
        CREATE FUNCTION public.grainline_bad_alias(text) RETURNS text
        LANGUAGE sql AS $$
          SELECT seller."stripeAccountId"
            FROM public."SellerProfile" AS seller
        $$;
      `,
    },
    {
      identity: "grainline_private_ok(text)",
      definition: `
        CREATE FUNCTION public.grainline_private_ok(text) RETURNS text
        LANGUAGE sql AS $$
          SELECT seller_private."shipFromName"
            FROM public."SellerProfilePrivate" AS seller_private
        $$;
      `,
    },
  ]);
  assert.deepEqual(offenders, [
    {
      identity: "grainline_bad_rowtype(text)",
      references: ["source_seller.shipFromName"],
    },
    {
      identity: "grainline_bad_alias(text)",
      references: ["seller.stripeAccountId"],
    },
  ]);
});

test("CI proves the repair on PostgreSQL after retirement and before convergence", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const retirement = ci.indexOf(
    "Apply SellerProfile private predecessor retirement in disposable PostgreSQL",
  );
  const repairApply = ci.indexOf(
    "Apply account-deletion post-retirement repair in disposable PostgreSQL",
  );
  const deletionProof = ci.indexOf(
    "Prove complete buyer and seller deletion after retirement",
  );
  const catalogProof = ci.indexOf(
    "Reject retired SellerProfile references in every live function signature",
  );
  const grants = ci.indexOf(
    "Converge runtime grants after SellerProfile private boundary",
  );
  const build = ci.indexOf("Production build");
  assert.ok(
    retirement >= 0 &&
      repairApply > retirement &&
      deletionProof > repairApply &&
      catalogProof > deletionProof &&
      grants > catalogProof &&
      build > grants,
  );
  assert.match(ci, new RegExp(REPAIR_MIGRATION, "u"));
  assert.match(
    ci,
    /ACCOUNT_DELETION_POST_RETIREMENT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/u,
  );
  assert.match(
    ci,
    /SELLER_PROFILE_RETIRED_FUNCTION_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/u,
  );
});

test("production inspector pins the exact repair and retains aggregate evidence only", () => {
  const source = readFileSync(
    "scripts/account-deletion-post-retirement-production-inspect.mjs",
    "utf8",
  );
  assert.match(source, new RegExp(REPAIR_MIGRATION, "u"));
  assert.equal(REPAIR_CHECKSUM, "c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368");
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /GROUP BY status, kind/u);
  assert.match(source, /aggregateRowsOnly: true/u);
  assert.match(source, /identifiers: false/u);
  assert.doesNotMatch(source, /SELECT\s+id,\s*"userId"/u);
});
