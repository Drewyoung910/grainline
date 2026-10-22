import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019080000_prepare_seller_profile_public_similar_makers/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "displayName" varchar(100) NOT NULL,
      tagline varchar(140),
      city varchar(100),
      state varchar(50),
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "avatarImageUrl" varchar(2048),
      "bannerImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "metroId" text,
      "cityMetroId" text
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text,
      "archivedAt" timestamp(3),
      "qualityScore" double precision NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Follow" (
      id text PRIMARY KEY,
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id)
    );

    INSERT INTO public."User" (id) VALUES
      ('viewer'), ('owner-source'), ('owner-metro'), ('owner-blocked'),
      ('owner-state'), ('owner-inactive');
    INSERT INTO public."SellerProfile" (
      id, "userId", "ownerAccountActive", "displayName", tagline, city, state,
      "guildLevel", "avatarImageUrl", "bannerImageUrl", "ownerImageUrl",
      "chargesEnabled", "stripeAccountSupported", "vacationMode", "metroId", "cityMetroId"
    ) VALUES
      ('seller-source', 'owner-source', true, 'Source Workshop', NULL, 'Austin', 'Tx',
       'NONE', NULL, NULL, NULL, true, true, false, 'metro-a', NULL),
      ('seller-metro', 'owner-metro', true, 'Metro Workshop', 'Metro tagline', 'Round Rock', 'TX',
       'NONE', 'https://example.test/metro-avatar.jpg', NULL, NULL, true, true, false, 'metro-a', NULL),
      ('seller-blocked', 'owner-blocked', true, 'Blocked Workshop', NULL, 'Austin', 'TX',
       'GUILD_MASTER', NULL, NULL, NULL, true, true, false, NULL, 'metro-a'),
      ('seller-state', 'owner-state', true, 'State Workshop', 'State tagline', 'Dallas', 'tx',
       'GUILD_MASTER', NULL, 'https://example.test/state-banner.jpg', NULL, true, true, false, 'metro-b', NULL),
      ('seller-inactive', 'owner-inactive', true, 'Inactive Workshop', NULL, 'Austin', 'TX',
       'GUILD_MASTER', NULL, NULL, NULL, false, true, false, 'metro-a', NULL);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "reservedForUserId", "archivedAt", "qualityScore"
    ) VALUES
      ('listing-source', 'seller-source', 'ACTIVE', false, NULL, NULL, 0.5),
      ('listing-metro-low', 'seller-metro', 'ACTIVE', false, NULL, NULL, 0.1),
      ('listing-metro-top', 'seller-metro', 'ACTIVE', false, NULL, NULL, 0.9),
      ('listing-blocked', 'seller-blocked', 'ACTIVE', false, NULL, NULL, 1.0),
      ('listing-state', 'seller-state', 'ACTIVE', false, NULL, NULL, 0.8),
      ('listing-inactive', 'seller-inactive', 'ACTIVE', false, NULL, NULL, 0.7);
    INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
      ('photo-metro-low', 'listing-metro-low', 'https://example.test/low.jpg', 0),
      ('photo-metro-top', 'listing-metro-top', 'https://example.test/top.jpg', 0),
      ('photo-state', 'listing-state', 'https://example.test/state.jpg', 0);
    INSERT INTO public."Follow" (id, "sellerProfileId") VALUES
      ('follow-metro', 'seller-metro'),
      ('follow-state-1', 'seller-state'),
      ('follow-state-2', 'seller-state');
    INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block-viewer', 'owner-blocked', 'viewer');
  `);
  await database.exec(migration);
  return database;
}

test("similar-maker authority preserves metro-first fallback and bounded card fields", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_similar_makers('listing-source', 4)
    `)).rows;
    assert.deepEqual(rows, [
      {
        id: "seller-metro",
        displayName: "Metro Workshop",
        tagline: "Metro tagline",
        city: "Round Rock",
        state: "TX",
        guildLevel: "NONE",
        avatarImageUrl: "https://example.test/metro-avatar.jpg",
        bannerImageUrl: null,
        ownerImageUrl: null,
        coverImageUrl: "https://example.test/top.jpg",
        scopeKind: "METRO",
      },
      {
        id: "seller-state",
        displayName: "State Workshop",
        tagline: "State tagline",
        city: "Dallas",
        state: "tx",
        guildLevel: "GUILD_MASTER",
        avatarImageUrl: null,
        bannerImageUrl: "https://example.test/state-banner.jpg",
        ownerImageUrl: null,
        coverImageUrl: "https://example.test/state.jpg",
        scopeKind: "STATE",
      },
    ]);
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      [
        "avatarImageUrl", "bannerImageUrl", "city", "coverImageUrl", "displayName",
        "guildLevel", "id", "ownerImageUrl", "scopeKind", "state", "tagline",
      ].sort(),
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("similar-maker authority derives scope only from a viewer-visible listing", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      UPDATE public."Listing"
         SET "isPrivate" = true,
             "reservedForUserId" = 'viewer'
       WHERE id = 'listing-source'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const anonymousRows = (await database.query(`
      SELECT id
        FROM public.grainline_seller_public_similar_makers('listing-source', 4)
    `)).rows;
    assert.deepEqual(anonymousRows, []);
    await database.exec("RESET ROLE");

    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const reservedBuyerRows = (await database.query(`
      SELECT id
        FROM public.grainline_seller_public_similar_makers('listing-source', 4)
    `)).rows;
    assert.deepEqual(reservedBuyerRows, [
      { id: "seller-metro" },
      { id: "seller-state" },
    ]);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("similar-maker authority denies ungranted callers and invalid viewer context", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_similar_makers('listing-source', 4)"),
      /permission denied/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'missing-viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_similar_makers('listing-source', 4)"),
      /viewer context is invalid/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});
