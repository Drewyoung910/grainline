import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const setup = readFileSync(
  "scripts/checkout-stock-reservation-provider-fixtures-setup.sql",
  "utf8",
).replace(/^\\set[^\n]*\n/u, "");
const teardown = readFileSync(
  "scripts/checkout-stock-reservation-provider-fixtures-teardown.sql",
  "utf8",
).replace(/^\\set[^\n]*\n/u, "");

const fixtureSchema = String.raw`
  CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
  CREATE TYPE public."ListingStatus" AS ENUM (
    'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
  );
  CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');

  CREATE TABLE public."User" (
    id text PRIMARY KEY,
    "clerkId" varchar(255) NOT NULL UNIQUE,
    email varchar(254) NOT NULL UNIQUE,
    name varchar(100),
    role public."Role" NOT NULL DEFAULT 'USER',
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
    banned boolean NOT NULL DEFAULT false,
    "deletedAt" timestamp(3) without time zone
  );
  CREATE TABLE public."SellerProfile" (
    id text PRIMARY KEY,
    "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
    "displayName" varchar(100) NOT NULL,
    "displayNameNormalized" varchar(100) NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeAccountId" varchar(255) UNIQUE,
    "stripeAccountVersion" varchar(20),
    "chargesEnabled" boolean NOT NULL DEFAULT false,
    "acceptingNewOrders" boolean NOT NULL DEFAULT true,
    "vacationMode" boolean NOT NULL DEFAULT false,
    "allowLocalPickup" boolean NOT NULL DEFAULT false,
    "offersGiftWrapping" boolean NOT NULL DEFAULT false,
    "giftWrappingPriceCents" integer,
    "defaultPkgWeightGrams" integer,
    "defaultPkgLengthCm" double precision,
    "defaultPkgWidthCm" double precision,
    "defaultPkgHeightCm" double precision
  );
  CREATE TABLE public."Listing" (
    id text PRIMARY KEY,
    "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id) ON DELETE RESTRICT,
    title varchar(150) NOT NULL,
    description varchar(5000) NOT NULL,
    "priceCents" integer NOT NULL,
    "priceVersion" integer NOT NULL DEFAULT 1,
    currency varchar(3) NOT NULL DEFAULT 'usd',
    status public."ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingType" public."ListingType" NOT NULL DEFAULT 'MADE_TO_ORDER',
    "stockQuantity" integer,
    "shipsWithinDays" integer,
    "packagedWeightGrams" integer,
    "packagedLengthCm" double precision,
    "packagedWidthCm" double precision,
    "packagedHeightCm" double precision,
    "isPrivate" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE public."ListingVariantGroup" (
    id text PRIMARY KEY,
    "listingId" text NOT NULL REFERENCES public."Listing"(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    "sortOrder" integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public."ListingVariantOption" (
    id text PRIMARY KEY,
    "groupId" text NOT NULL REFERENCES public."ListingVariantGroup"(id) ON DELETE CASCADE,
    label varchar(100) NOT NULL,
    "priceAdjustCents" integer NOT NULL DEFAULT 0,
    "sortOrder" integer NOT NULL DEFAULT 0,
    "inStock" boolean NOT NULL DEFAULT true
  );
  CREATE TABLE public."CheckoutStockReservation" (
    id text PRIMARY KEY,
    "checkoutLockKey" varchar(255) NOT NULL,
    "payloadHash" varchar(64) NOT NULL,
    "buyerId" varchar(191),
    "sellerId" varchar(191),
    status varchar(32) NOT NULL DEFAULT 'RESERVED',
    "reservedItems" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

async function fixtureCount(db, table) {
  const result = await db.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."${table}"
      WHERE id LIKE 'checkout-reservation-provider-%'`,
  );
  return result.rows[0].count;
}

describe("CheckoutStockReservation provider fixtures in disposable PostgreSQL", () => {
  it("creates the exact bounded source graph and removes it without residue", async () => {
    const db = new PGlite();
    try {
      await db.exec(fixtureSchema);
      await db.exec(setup);
      assert.equal(await fixtureCount(db, "User"), 42);
      assert.equal(await fixtureCount(db, "SellerProfile"), 2);
      assert.equal(await fixtureCount(db, "Listing"), 40);
      assert.equal(await fixtureCount(db, "ListingVariantGroup"), 40);
      assert.equal(await fixtureCount(db, "ListingVariantOption"), 40);

      await db.exec(teardown);
      assert.equal(await fixtureCount(db, "User"), 0);
      assert.equal(await fixtureCount(db, "SellerProfile"), 0);
      assert.equal(await fixtureCount(db, "Listing"), 0);
      assert.equal(await fixtureCount(db, "ListingVariantGroup"), 0);
      assert.equal(await fixtureCount(db, "ListingVariantOption"), 0);
    } finally {
      await db.close();
    }
  });

  it("fails closed instead of adopting or overwriting an existing fixture set", async () => {
    const db = new PGlite();
    try {
      await db.exec(fixtureSchema);
      await db.exec(setup);
      await assert.rejects(db.exec(setup), /provider fixtures already exist/);
      await db.exec("ROLLBACK");
      assert.equal(await fixtureCount(db, "User"), 42);
      assert.equal(await fixtureCount(db, "Listing"), 40);
    } finally {
      await db.close();
    }
  });
});
