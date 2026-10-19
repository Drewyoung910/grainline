import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019090000_prepare_seller_profile_public_featured_makers/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      bio varchar(500),
      "storyBody" varchar(2000),
      "yearsInBusiness" integer,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      city varchar(100),
      state varchar(50),
      tagline varchar(140),
      "bannerImageUrl" varchar(2048),
      "avatarImageUrl" varchar(2048),
      "workshopImageUrl" varchar(2048),
      "featuredListingIds" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "isFoundingMaker" boolean NOT NULL DEFAULT false,
      "foundingMakerNumber" integer,
      "ownerImageUrl" varchar(2048),
      "featuredUntil" timestamp(3),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."SellerRatingSummary" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "reviewCount" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false
    );

    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", bio, "storyBody", "yearsInBusiness",
      "createdAt", city, state, tagline, "featuredListingIds", "guildLevel",
      "isFoundingMaker", "foundingMakerNumber", "featuredUntil",
      "ownerAccountActive", "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('curated-a', 'owner-curated-a', 'Curated A', 'Bio A', 'Story A', 8,
       '2020-01-01', 'Austin', 'TX', 'Tagline A', ARRAY['listing-curated-a'], 'NONE',
       true, 1, '2100-01-02', true, true, true, false),
      ('curated-b', 'owner-curated-b', 'Curated B', NULL, NULL, NULL,
       '2021-01-01', 'Dallas', 'TX', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, '2100-01-01', true, true, true, false),
      ('guild-a', 'owner-guild-a', 'Guild A', NULL, NULL, NULL,
       '2022-01-01', 'Houston', 'TX', NULL, ARRAY[]::text[], 'GUILD_MEMBER',
       false, NULL, NULL, true, true, true, false),
      ('guild-b', 'owner-guild-b', 'Guild B', NULL, NULL, NULL,
       '2022-02-01', 'Waco', 'TX', NULL, ARRAY[]::text[], 'GUILD_MASTER',
       false, NULL, NULL, true, true, true, false),
      ('fallback-a', 'owner-fallback-a', 'Fallback A', NULL, NULL, NULL,
       '2023-01-01', 'Tulsa', 'OK', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, NULL, true, true, true, false),
      ('fallback-b', 'owner-fallback-b', 'Fallback B', NULL, NULL, NULL,
       '2023-02-01', 'Norman', 'OK', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, NULL, true, true, true, false),
      ('fallback-c', 'owner-fallback-c', 'Fallback C', NULL, NULL, NULL,
       '2023-03-01', 'Edmond', 'OK', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, NULL, true, true, true, false),
      ('fallback-d', 'owner-fallback-d', 'Fallback D', NULL, NULL, NULL,
       '2023-04-01', 'Moore', 'OK', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, NULL, true, true, true, false),
      ('fallback-low', 'owner-fallback-low', 'Fallback Low', NULL, NULL, NULL,
       '2023-05-01', 'Lawton', 'OK', NULL, ARRAY[]::text[], 'NONE',
       false, NULL, NULL, true, true, true, false),
      ('inactive', 'owner-inactive', 'Inactive', NULL, NULL, NULL,
       '2024-01-01', 'Austin', 'TX', NULL, ARRAY[]::text[], 'GUILD_MASTER',
       false, NULL, '2100-01-03', true, false, true, false);
    INSERT INTO public."SellerRatingSummary" ("sellerProfileId", "reviewCount") VALUES
      ('fallback-a', 50), ('fallback-b', 40), ('fallback-c', 30),
      ('fallback-d', 20), ('fallback-low', 10);
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate") VALUES
      ('listing-curated-a', 'curated-a', 'ACTIVE', false),
      ('listing-fallback-a', 'fallback-a', 'ACTIVE', false),
      ('listing-fallback-b', 'fallback-b', 'ACTIVE', false),
      ('listing-fallback-c', 'fallback-c', 'ACTIVE', false),
      ('listing-fallback-d', 'fallback-d', 'ACTIVE', false),
      ('listing-fallback-low', 'fallback-low', 'ACTIVE', false);
  `);
  await database.exec(migration);
  return database;
}

test("featured-maker authority preserves curated and weekly Guild tiers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const curatedRows = (await database.query(
      "SELECT * FROM public.grainline_seller_public_featured_makers()",
    )).rows;
    assert.deepEqual(curatedRows.map((row) => row.id), ["curated-a", "curated-b"]);
    assert.deepEqual(Object.keys(curatedRows[0]).sort(), [
      "avatarImageUrl", "bannerImageUrl", "bio", "city", "createdAt",
      "displayName", "featuredListingIds", "foundingMakerNumber", "guildLevel",
      "id", "isFoundingMaker", "ownerImageUrl", "state", "storyBody", "tagline",
      "userId", "workshopImageUrl", "yearsInBusiness",
    ].sort());
    await database.exec("RESET ROLE");

    await database.exec(`
      UPDATE public."SellerProfile"
         SET "featuredUntil" = '2000-01-01'
       WHERE id = 'curated-b'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const guildRows = (await database.query(
      "SELECT id FROM public.grainline_seller_public_featured_makers()",
    )).rows;
    const repeatedRows = (await database.query(
      "SELECT id FROM public.grainline_seller_public_featured_makers()",
    )).rows;
    assert.equal(guildRows[0].id, "curated-a");
    assert.equal(["guild-a", "guild-b"].includes(guildRows[1].id), true);
    assert.deepEqual(repeatedRows, guildRows);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("featured-maker authority preserves the four-seller reviewed fallback pool", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      UPDATE public."SellerProfile"
         SET "featuredUntil" = NULL,
             "guildLevel" = 'NONE'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(
      "SELECT id FROM public.grainline_seller_public_featured_makers()",
    )).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => [
      "fallback-a", "fallback-b", "fallback-c", "fallback-d",
    ].includes(row.id)), true);
    assert.equal(rows.some((row) => row.id === "fallback-low"), false);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("featured-maker authority denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_featured_makers()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
