import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  buildFixtureIds,
  seedBuyerFixture,
  seedOrderFixtures,
} from "../scripts/order-authenticated-route-smoke.mjs";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
    );
    CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');
    CREATE TYPE public."FulfillmentMethod" AS ENUM ('PICKUP', 'SHIPPING');
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'SHIPPED', 'DELIVERED'
    );
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE TYPE public."EmailSuppressionReason" AS ENUM (
      'BOUNCE', 'COMPLAINT', 'MANUAL', 'INVALID'
    );

    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role public."Role" NOT NULL DEFAULT 'USER',
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3),
      "termsAcceptedAt" timestamp(3),
      "termsVersion" varchar(50),
      "ageAttestedAt" timestamp(3),
      "emailPreferenceOptInAt" timestamp(3),
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      "displayNameNormalized" varchar(100) NOT NULL,
      "stripeAccountId" varchar(255) UNIQUE,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "shipFromName" varchar(100),
      "shipFromLine1" varchar(200),
      "shipFromCity" varchar(100),
      "shipFromState" varchar(50),
      "shipFromPostal" varchar(20),
      "shipFromCountry" varchar(2) DEFAULT 'US',
      "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision,
      "useCalculatedShipping" boolean NOT NULL DEFAULT false,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "onboardingComplete" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(150) NOT NULL,
      description varchar(5000) NOT NULL,
      "priceCents" integer NOT NULL,
      "priceVersion" integer NOT NULL DEFAULT 1,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status public."ListingStatus" NOT NULL DEFAULT 'ACTIVE',
      "listingType" public."ListingType" NOT NULL DEFAULT 'MADE_TO_ORDER',
      "stockQuantity" integer,
      "shipsWithinDays" integer,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text REFERENCES public."User"(id),
      "packagedWeightGrams" integer,
      "packagedLengthCm" double precision,
      "packagedWidthCm" double precision,
      "packagedHeightCm" double precision,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, "sellerId")
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "paidAt" timestamp(3),
      currency varchar(3) NOT NULL DEFAULT 'usd',
      "chargedTotalCents" integer,
      "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "taxAmountCents" integer NOT NULL DEFAULT 0,
      "buyerName" varchar(200),
      "shipToLine1" varchar(200),
      "shipToCity" varchar(100),
      "shipToState" varchar(50),
      "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2),
      "fulfillmentMethod" public."FulfillmentMethod",
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
      "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100),
      "sellerNotes" varchar(2000),
      "shippedAt" timestamp(3),
      "deliveredAt" timestamp(3),
      "labelStatus" public."LabelStatus",
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, "sellerProfileId")
    );
    CREATE TABLE public."OrderItem" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL,
      "listingId" text NOT NULL,
      "sellerProfileId" text NOT NULL,
      quantity integer NOT NULL DEFAULT 1,
      "priceCents" integer NOT NULL,
      "listingSnapshot" jsonb,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("orderId", "sellerProfileId")
        REFERENCES public."Order"(id, "sellerProfileId"),
      FOREIGN KEY ("listingId", "sellerProfileId")
        REFERENCES public."Listing"(id, "sellerId")
    );
    CREATE TABLE public."EmailSuppression" (
      id text PRIMARY KEY,
      email varchar(254) NOT NULL UNIQUE,
      reason public."EmailSuppressionReason" NOT NULL,
      source varchar(100),
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

function nodePostgresAdapter(database) {
  return {
    query: async (...args) => {
      const result = await database.query(...args);
      return {
        ...result,
        rowCount: Number.isInteger(result.affectedRows)
          ? result.affectedRows
          : result.rows.length,
      };
    },
  };
}

test("raw authenticated Order fixture SQL is valid, exact and restart-safe", async () => {
  const database = await createDatabase();
  const owner = nodePostgresAdapter(database);
  const marker = "d".repeat(32);
  const fixtureIds = buildFixtureIds(marker);
  const state = {
    marker,
    fixtureIds,
    canary: { userId: "canary-user", clerkUserId: "clerk-canary" },
    checkoutSeller: { sellerProfileId: "checkout-seller" },
    checkout: {
      redisKeys: ["account-state:vercel-production:clerk:clerk-canary"],
    },
  };
  await database.exec(`
    INSERT INTO public."User" (id, "clerkId", email, name)
    VALUES
      ('canary-user', 'clerk-canary', 'canary@example.test', 'Canary'),
      ('checkout-seller-user', 'clerk-checkout-seller', 'seller@example.test', 'Seller');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized", "chargesEnabled",
      "useCalculatedShipping", "acceptingNewOrders", "onboardingComplete"
    ) VALUES (
      'checkout-seller', 'checkout-seller-user', 'Checkout Seller', 'checkout seller',
      true, true, true, true
    );
  `);
  const deletedKeys = [];
  const redis = { del: async (key) => { deletedKeys.push(key); return 1; } };
  try {
    await seedBuyerFixture(owner, redis, state);
    await seedOrderFixtures(owner, state);
    await seedBuyerFixture(owner, redis, state);
    await seedOrderFixtures(owner, state);
    assert.deepEqual(deletedKeys, [
      "account-state:vercel-production:clerk:clerk-canary",
      "account-state:vercel-production:clerk:clerk-canary",
    ]);
    const listing = await database.query(`
      SELECT status::text, "stockQuantity" AS stock, "reservedForUserId" AS buyer
        FROM public."Listing" WHERE id = $1
    `, [fixtureIds.checkoutListingId]);
    assert.deepEqual(listing.rows, [{ status: "ACTIVE", stock: 5, buyer: "canary-user" }]);

    await database.query(`UPDATE public."Listing" SET title = 'foreign-row' WHERE id = $1`,
      [fixtureIds.labelListingId]);
    await assert.rejects(() => seedOrderFixtures(owner, state));
  } finally {
    await database.close();
  }
});
