import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235940_prepare_seller_profile_public_follower_listing_target/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'HIDDEN');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(150) NOT NULL,
      "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp without time zone
    );
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller', 'seller-user', 'Main Shop', true, true, true, false),
      ('vacation', 'vacation-user', 'Vacation Shop', true, true, true, true),
      ('inactive', 'inactive-user', 'Inactive Shop', false, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", title, "priceCents", currency, status, "isPrivate", "archivedAt"
    ) VALUES
      ('active', 'seller', 'Current title', 12500, 'usd', 'ACTIVE', false, NULL),
      ('sold-out', 'seller', 'Sold out', 9000, 'usd', 'SOLD_OUT', false, NULL),
      ('private', 'seller', 'Private', 9000, 'usd', 'ACTIVE', true, NULL),
      ('archived', 'seller', 'Archived', 9000, 'usd', 'ACTIVE', false, CURRENT_TIMESTAMP),
      ('vacation-listing', 'vacation', 'Vacation', 9000, 'usd', 'ACTIVE', false, NULL),
      ('inactive-listing', 'inactive', 'Inactive', 9000, 'usd', 'ACTIVE', false, NULL);
  `);
  await database.exec(migration);
  return database;
}

test("follower-listing target returns only the fresh public listing and exact maker", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_follower_listing_target('active','seller')
    `)).rows, [{
      listingId: "active",
      title: "Current title",
      priceCents: 12500,
      currency: "usd",
      sellerProfileId: "seller",
      sellerUserId: "seller-user",
      sellerDisplayName: "Main Shop",
    }]);
    for (const [listingId, sellerProfileId] of [
      ["active", "inactive"],
      ["sold-out", "seller"],
      ["private", "seller"],
      ["archived", "seller"],
      ["vacation-listing", "vacation"],
      ["inactive-listing", "inactive"],
    ]) {
      assert.deepEqual((await database.query(
        "SELECT * FROM public.grainline_seller_public_follower_listing_target($1,$2)",
        [listingId, sellerProfileId],
      )).rows, []);
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("follower-listing target validates ids and grants only the runtime role", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follower_listing_target('bad id','seller')",
      ),
      (error) => error?.code === "22023",
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follower_listing_target('active','seller')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
