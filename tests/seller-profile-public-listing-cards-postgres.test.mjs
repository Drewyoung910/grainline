import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235960_prepare_seller_profile_public_listing_cards/migration.sql",
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
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      city varchar(100),
      state varchar(50),
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp(3)
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );

    INSERT INTO public."User" (id) VALUES
      ('viewer'), ('seller-a-user'), ('seller-b-user'), ('inactive-user');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerImageUrl",
      "guildLevel", city, state, "acceptingNewOrders", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller-a', 'seller-a-user', 'Maker A', NULL, 'https://example.test/a.jpg',
       'GUILD_MEMBER', 'Austin', 'TX', true, true, true, true, false),
      ('seller-b', 'seller-b-user', 'Maker B', 'https://example.test/b.jpg', NULL,
       'NONE', 'Dallas', 'TX', false, true, true, true, false),
      ('inactive', 'inactive-user', 'Inactive', NULL, NULL,
       'NONE', 'Waco', 'TX', true, false, true, true, false);
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate", "archivedAt") VALUES
      ('listing-a', 'seller-a', 'ACTIVE', false, NULL),
      ('listing-b', 'seller-b', 'ACTIVE', false, NULL),
      ('listing-inactive', 'inactive', 'ACTIVE', false, NULL),
      ('listing-private', 'seller-a', 'ACTIVE', true, NULL),
      ('listing-archived', 'seller-a', 'ACTIVE', false, '2026-10-20'),
      ('listing-sold-out', 'seller-a', 'SOLD_OUT', false, NULL);
  `);
  await database.exec(migration);
  return database;
}

test("listing-card authority returns only public orderable cards in request order", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_listing_cards(
          ARRAY['listing-b','listing-inactive','listing-a','listing-private',
                'listing-archived','listing-sold-out']::text[]
        )
    `)).rows;
    assert.deepEqual(rows, [
      {
        listingId: "listing-b",
        sellerProfileId: "seller-b",
        displayName: "Maker B",
        avatarImageUrl: "https://example.test/b.jpg",
        guildLevel: "NONE",
        city: "Dallas",
        state: "TX",
        acceptingNewOrders: false,
        ownerImageUrl: null,
      },
      {
        listingId: "listing-a",
        sellerProfileId: "seller-a",
        displayName: "Maker A",
        avatarImageUrl: null,
        guildLevel: "GUILD_MEMBER",
        city: "Austin",
        state: "TX",
        acceptingNewOrders: true,
        ownerImageUrl: "https://example.test/a.jpg",
      },
    ]);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("listing-card authority applies reciprocal blocks for an active viewer", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block-a', 'seller-a-user', 'viewer');
      SELECT set_config('app.user_id', 'viewer', false);
      SET ROLE grainline_app_runtime;
    `);
    const rows = (await database.query(`
      SELECT "listingId"
        FROM public.grainline_seller_public_listing_cards(
          ARRAY['listing-a','listing-b']::text[]
        )
    `)).rows;
    assert.deepEqual(rows, [{ listingId: "listing-b" }]);
    await database.exec("RESET ROLE; SELECT set_config('app.user_id', '', false)");
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("listing-card authority rejects malformed, duplicate, oversized, and unauthorized calls", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_listing_cards(ARRAY['listing-a','listing-a']::text[])"),
      /input is invalid/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_listing_cards(ARRAY['bad id']::text[])"),
      /input is invalid/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_listing_cards(array_fill('listing-a'::text, ARRAY[101]))"),
      /input is invalid/u,
    );
    await database.exec("RESET ROLE; SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_listing_cards(ARRAY['listing-a']::text[])"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
