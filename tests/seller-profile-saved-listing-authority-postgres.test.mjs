import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020040000_prepare_seller_profile_account_feed_cards/migration.sql",
  "utf8",
);
const timestampCorrection = readFileSync(
  "prisma/migrations/20261020235700_correct_seller_profile_projection_timestamps/migration.sql",
  "utf8",
);

function correctionFor(functionName) {
  const start = timestampCorrection.indexOf(`DROP FUNCTION public.${functionName}`);
  assert.notEqual(start, -1);
  const next = timestampCorrection.indexOf("\nDROP FUNCTION public.", start + 1);
  const end = next === -1 ? timestampCorrection.lastIndexOf("\nCOMMIT;") : next;
  assert.notEqual(end, -1);
  return `BEGIN;\n${timestampCorrection.slice(start, end)}\nCOMMIT;`;
}

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN', 'PENDING_REVIEW', 'REJECTED'
    );
    CREATE TYPE public."ListingType" AS ENUM ('MADE_TO_ORDER', 'IN_STOCK');
    CREATE TABLE public."User" (
      id varchar(191) PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      city varchar(100),
      state varchar(50),
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Follow" (
      id varchar(191) PRIMARY KEY,
      "followerId" varchar(191) NOT NULL,
      "sellerProfileId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Block" (
      id varchar(191) PRIMARY KEY,
      "blockerId" varchar(191) NOT NULL,
      "blockedId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Listing" (
      id varchar(191) PRIMARY KEY,
      "sellerId" varchar(191) NOT NULL,
      title varchar(150) NOT NULL,
      "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL,
      status public."ListingStatus" NOT NULL,
      "listingType" public."ListingType" NOT NULL,
      "stockQuantity" integer,
      "isPrivate" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Favorite" (
      "userId" varchar(191) NOT NULL,
      "listingId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL,
      PRIMARY KEY ("userId", "listingId")
    );
    CREATE TABLE public."Photo" (
      id varchar(191) PRIMARY KEY,
      "listingId" varchar(191) NOT NULL,
      url varchar(2048) NOT NULL,
      "altText" varchar(200),
      "sortOrder" integer NOT NULL DEFAULT 0
    );

    INSERT INTO public."User" (id) VALUES
      ('actor'), ('outsider'), ('seller-active'), ('seller-blocked'),
      ('seller-vacation'), ('seller-inactive');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerImageUrl", city, state,
      "acceptingNewOrders", "guildLevel", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('active', 'seller-active', 'Active Shop', 'avatar.jpg', 'owner.jpg', 'Austin', 'TX',
       true, 'GUILD_MASTER', true, true, true, false),
      ('blocked', 'seller-blocked', 'Blocked Shop', NULL, NULL, NULL, NULL,
       true, 'NONE', true, true, true, false),
      ('vacation', 'seller-vacation', 'Vacation Shop', NULL, NULL, NULL, NULL,
       true, 'NONE', true, true, true, true),
      ('inactive', 'seller-inactive', 'Inactive Shop', NULL, NULL, NULL, NULL,
       true, 'NONE', false, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", title, "priceCents", currency, status, "listingType",
      "stockQuantity", "isPrivate"
    ) VALUES
      ('active-a', 'active', 'Active A', 1000, 'usd', 'ACTIVE', 'IN_STOCK', 2, false),
      ('active-b', 'active', 'Active B', 2000, 'usd', 'ACTIVE', 'MADE_TO_ORDER', NULL, false),
      ('sold-out', 'active', 'Sold Out', 3000, 'usd', 'SOLD_OUT', 'IN_STOCK', 0, false),
      ('private', 'active', 'Private', 4000, 'usd', 'ACTIVE', 'IN_STOCK', 1, true),
      ('hidden', 'active', 'Hidden', 5000, 'usd', 'HIDDEN', 'IN_STOCK', 1, false),
      ('blocked-listing', 'blocked', 'Blocked', 6000, 'usd', 'ACTIVE', 'IN_STOCK', 1, false),
      ('vacation-listing', 'vacation', 'Vacation', 7000, 'usd', 'ACTIVE', 'IN_STOCK', 1, false),
      ('inactive-listing', 'inactive', 'Inactive', 8000, 'usd', 'ACTIVE', 'IN_STOCK', 1, false);
    INSERT INTO public."Favorite" ("userId", "listingId", "createdAt") VALUES
      ('actor', 'active-a', '2026-10-20T12:00:00Z'),
      ('actor', 'active-b', '2026-10-20T12:00:00Z'),
      ('actor', 'sold-out', '2026-10-20T11:00:00Z'),
      ('actor', 'private', '2026-10-20T10:00:00Z'),
      ('actor', 'hidden', '2026-10-20T09:00:00Z'),
      ('actor', 'blocked-listing', '2026-10-20T08:00:00Z'),
      ('actor', 'vacation-listing', '2026-10-20T07:00:00Z'),
      ('actor', 'inactive-listing', '2026-10-20T06:00:00Z'),
      ('outsider', 'active-a', '2026-10-20T13:00:00Z');
    INSERT INTO public."Photo" (id, "listingId", url, "altText", "sortOrder") VALUES
      ('photo-late', 'active-a', 'late.jpg', 'Late', 2),
      ('photo-first', 'active-a', 'first.jpg', 'First', 1),
      ('photo-second-listing', 'active-b', 'second.jpg', NULL, 0);
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt") VALUES
      ('block-reciprocal', 'seller-blocked', 'actor', CURRENT_TIMESTAMP);
  `);
  await database.exec(migration);
  await database.exec(correctionFor("grainline_seller_owner_saved_listing_page"));
  return database;
}

test("saved-listing owner authorities enforce actor, public visibility, blocks, and ordering", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_saved_listing_count()"))
        .rows,
      [{ value: 3 }],
    );
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_owner_saved_listing_page(2, 0)
      `)).rows,
      [
        {
          savedAt: new Date("2026-10-20T12:00:00.000Z"),
          listingId: "active-b",
          title: "Active B",
          priceCents: 2000,
          currency: "usd",
          status: "ACTIVE",
          listingType: "MADE_TO_ORDER",
          stockQuantity: null,
          sellerProfileId: "active",
          displayName: "Active Shop",
          avatarImageUrl: "avatar.jpg",
          ownerImageUrl: "owner.jpg",
          guildLevel: "GUILD_MASTER",
          city: "Austin",
          state: "TX",
          acceptingNewOrders: true,
          photoUrl: "second.jpg",
          photoAltText: null,
        },
        {
          savedAt: new Date("2026-10-20T12:00:00.000Z"),
          listingId: "active-a",
          title: "Active A",
          priceCents: 1000,
          currency: "usd",
          status: "ACTIVE",
          listingType: "IN_STOCK",
          stockQuantity: 2,
          sellerProfileId: "active",
          displayName: "Active Shop",
          avatarImageUrl: "avatar.jpg",
          ownerImageUrl: "owner.jpg",
          guildLevel: "GUILD_MASTER",
          city: "Austin",
          state: "TX",
          acceptingNewOrders: true,
          photoUrl: "first.jpg",
          photoAltText: "First",
        },
      ],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("saved-listing owner authorities reject missing actors, invalid pages, and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_listing_count()"),
      /actor context is invalid/u,
    );
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_listing_page(25, 0)"),
      /page input is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_listing_count()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
