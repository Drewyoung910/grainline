import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019100000_prepare_seller_profile_public_map_card/migration.sql",
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
      "displayName" varchar(100) NOT NULL,
      tagline varchar(140),
      city varchar(100),
      state varchar(50),
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "isFoundingMaker" boolean NOT NULL DEFAULT false,
      "foundingMakerNumber" integer,
      "avatarImageUrl" varchar(2048),
      "bannerImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "publicMapOptIn" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp,
      "qualityScore" double precision NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );

    INSERT INTO public."SellerProfile" (
      id, "displayName", tagline, city, state, "guildLevel",
      "isFoundingMaker", "foundingMakerNumber", "avatarImageUrl",
      "bannerImageUrl", "ownerImageUrl", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode", "publicMapOptIn"
    ) VALUES
      ('visible', 'Visible Maker', 'Handmade locally', 'Austin', 'TX', 'GUILD_MASTER',
       true, 7, 'https://example.test/avatar.jpg', NULL, NULL,
       true, true, true, false, true),
      ('hidden', 'Hidden Maker', NULL, NULL, NULL, 'NONE',
       false, NULL, NULL, NULL, NULL,
       true, true, true, false, false);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "archivedAt", "qualityScore"
    ) VALUES
      ('lower', 'visible', 'ACTIVE', false, NULL, 10),
      ('top', 'visible', 'ACTIVE', false, NULL, 20),
      ('private', 'visible', 'ACTIVE', true, NULL, 100);
    INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
      ('top-second', 'top', 'https://example.test/second.jpg', 2),
      ('top-first', 'top', 'https://example.test/first.jpg', 1),
      ('private-photo', 'private', 'https://example.test/private.jpg', 0);
  `);
  await database.exec(migration);
  return database;
}

test("map-card authority returns only the exact visible card", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(
      "SELECT * FROM public.grainline_seller_public_map_card('visible')",
    )).rows;
    assert.deepEqual(rows, [{
      id: "visible",
      displayName: "Visible Maker",
      tagline: "Handmade locally",
      city: "Austin",
      state: "TX",
      guildLevel: "GUILD_MASTER",
      isFoundingMaker: true,
      foundingMakerNumber: 7,
      avatarImageUrl: "https://example.test/avatar.jpg",
      bannerImageUrl: null,
      ownerImageUrl: null,
      coverImageUrl: "https://example.test/first.jpg",
    }]);
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_map_card('hidden')",
      )).rows,
      [],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("map-card authority denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_card('visible')"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
