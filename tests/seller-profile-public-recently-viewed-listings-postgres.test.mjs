import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235920_prepare_seller_profile_public_recently_viewed_listings/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'HIDDEN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(200) NOT NULL,
      "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp without time zone
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL,
      "blockedId" text NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('viewer', false, NULL),
      ('banned-viewer', true, NULL),
      ('seller-user', false, NULL),
      ('blocked-user', false, NULL),
      ('blocking-user', false, NULL),
      ('vacation-user', false, NULL),
      ('inactive-user', false, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerImageUrl",
      "ownerAccountActive", "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller', 'seller-user', 'Main Shop', NULL, 'https://example.test/owner.jpg', true, true, true, false),
      ('blocked', 'blocked-user', 'Blocked Shop', NULL, NULL, true, true, true, false),
      ('blocking', 'blocking-user', 'Blocking Shop', NULL, NULL, true, true, true, false),
      ('vacation', 'vacation-user', 'Vacation Shop', NULL, NULL, true, true, true, true),
      ('inactive', 'inactive-user', 'Inactive Shop', NULL, NULL, false, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", title, "priceCents", currency, status, "isPrivate", "archivedAt"
    ) VALUES
      ('active', 'seller', 'Active listing', 12500, 'usd', 'ACTIVE', false, NULL),
      ('active-two', 'seller', 'Second listing', 8000, 'usd', 'ACTIVE', false, NULL),
      ('sold-out', 'seller', 'Sold out', 9000, 'usd', 'SOLD_OUT', false, NULL),
      ('private', 'seller', 'Private', 9000, 'usd', 'ACTIVE', true, NULL),
      ('archived', 'seller', 'Archived', 9000, 'usd', 'ACTIVE', false, CURRENT_TIMESTAMP),
      ('blocked-listing', 'blocked', 'Blocked', 9000, 'usd', 'ACTIVE', false, NULL),
      ('blocking-listing', 'blocking', 'Blocking', 9000, 'usd', 'ACTIVE', false, NULL),
      ('vacation-listing', 'vacation', 'Vacation', 9000, 'usd', 'ACTIVE', false, NULL),
      ('inactive-listing', 'inactive', 'Inactive', 9000, 'usd', 'ACTIVE', false, NULL);
    INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
      ('photo-later', 'active', 'https://example.test/later.jpg', 2),
      ('photo-first', 'active', 'https://example.test/first.jpg', 1);
    INSERT INTO public."Block" (id, "blockerId", "blockedId") VALUES
      ('viewer-blocks', 'viewer', 'blocked-user'),
      ('seller-blocks-viewer', 'blocking-user', 'viewer');
  `);
  await database.exec(migration);
  return database;
}

test("recently-viewed authority preserves public eligibility and reciprocal blocks", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_recently_viewed_listings(
          ARRAY['active-two', 'sold-out', 'active', 'vacation-listing']::text[]
        )
    `)).rows, [
      {
        id: "active-two",
        title: "Second listing",
        priceCents: 8000,
        currency: "usd",
        photoUrl: null,
        sellerDisplayName: "Main Shop",
        sellerAvatarImageUrl: "https://example.test/owner.jpg",
      },
      {
        id: "active",
        title: "Active listing",
        priceCents: 12500,
        currency: "usd",
        photoUrl: "https://example.test/first.jpg",
        sellerDisplayName: "Main Shop",
        sellerAvatarImageUrl: "https://example.test/owner.jpg",
      },
    ]);
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(`
      SELECT id
        FROM public.grainline_seller_public_recently_viewed_listings(
          ARRAY['active', 'blocked-listing', 'blocking-listing']::text[]
        )
    `)).rows, [{ id: "active" }]);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("recently-viewed authority validates inputs, actor context and exact grants", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    for (const input of ["ARRAY[]::text[]", "ARRAY['bad id']::text[]"]) {
      await assert.rejects(
        database.query(`SELECT * FROM public.grainline_seller_public_recently_viewed_listings(${input})`),
        (error) => error?.code === "22023",
      );
    }
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'banned-viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_recently_viewed_listings(ARRAY['active']::text[])
      `),
      (error) => error?.code === "42501",
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', '', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_recently_viewed_listings(ARRAY['active']::text[])
      `),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
