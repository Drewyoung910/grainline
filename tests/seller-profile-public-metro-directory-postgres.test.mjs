import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019110000_prepare_seller_profile_public_metro_directory/migration.sql",
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
      "deletedAt" timestamp
    );
    CREATE TABLE public."Metro" (
      id text PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      "parentMetroId" text REFERENCES public."Metro"(id),
      "isActive" boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      "metroId" text REFERENCES public."Metro"(id),
      "cityMetroId" text REFERENCES public."Metro"(id),
      "displayName" varchar(100) NOT NULL,
      tagline varchar(140),
      city varchar(100),
      state varchar(50),
      "avatarImageUrl" varchar(2048),
      "bannerImageUrl" varchar(2048),
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "ownerImageUrl" varchar(2048),
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
      "archivedAt" timestamp,
      "createdAt" timestamp NOT NULL
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Follow" (
      "followerId" text NOT NULL REFERENCES public."User"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      PRIMARY KEY ("followerId", "sellerProfileId")
    );
    CREATE TABLE public."Block" (
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id),
      PRIMARY KEY ("blockerId", "blockedId")
    );

    INSERT INTO public."User" (id) VALUES
      ('viewer'), ('maker-major'), ('maker-empty'), ('maker-child'),
      ('maker-blocked'), ('follower-a'), ('follower-b');
    INSERT INTO public."Metro" (id, slug, name, "parentMetroId", "isActive") VALUES
      ('major', 'major-tx', 'Major', NULL, true),
      ('child-a', 'child-a-tx', 'Child A', 'major', true),
      ('child-b', 'child-b-tx', 'Child B', 'major', true),
      ('inactive', 'inactive-tx', 'Inactive', 'major', false);
    INSERT INTO public."SellerProfile" (
      id, "userId", "metroId", "cityMetroId", "displayName", tagline, city, state,
      "avatarImageUrl", "bannerImageUrl", "guildLevel", "ownerImageUrl",
      "ownerAccountActive", "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller-major', 'maker-major', 'major', NULL, 'Major Maker', 'Major tagline', 'Austin', 'TX',
       'https://example.test/avatar.jpg', NULL, 'GUILD_MASTER', NULL, true, true, true, false),
      ('seller-empty', 'maker-empty', 'major', NULL, 'Empty Maker', NULL, 'Austin', 'TX',
       NULL, NULL, 'NONE', NULL, true, true, true, false),
      ('seller-child', 'maker-child', 'major', 'child-a', 'Child Maker', NULL, 'Round Rock', 'TX',
       NULL, NULL, 'GUILD_MEMBER', NULL, true, true, true, false),
      ('seller-blocked', 'maker-blocked', 'major', 'child-b', 'Blocked Maker', NULL, 'Blocked', 'TX',
       NULL, NULL, 'NONE', NULL, true, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "archivedAt", "createdAt"
    ) VALUES
      ('major-old', 'seller-major', 'ACTIVE', false, NULL, '2026-01-01'),
      ('major-new', 'seller-major', 'ACTIVE', false, NULL, '2026-02-01'),
      ('major-private', 'seller-major', 'ACTIVE', true, NULL, '2026-03-01'),
      ('child-public', 'seller-child', 'ACTIVE', false, NULL, '2026-01-01'),
      ('blocked-public', 'seller-blocked', 'ACTIVE', false, NULL, '2026-01-01');
    INSERT INTO public."Photo" (id, "listingId", url, "sortOrder") VALUES
      ('new-second', 'major-new', 'https://example.test/second.jpg', 2),
      ('new-first', 'major-new', 'https://example.test/first.jpg', 1),
      ('private-photo', 'major-private', 'https://example.test/private.jpg', 0);
    INSERT INTO public."Follow" ("followerId", "sellerProfileId") VALUES
      ('follower-a', 'seller-major'),
      ('follower-b', 'seller-major');
    INSERT INTO public."Block" ("blockerId", "blockedId") VALUES
      ('viewer', 'maker-blocked');
  `);
  await database.exec(migration);
  return database;
}

test("metro-directory authorities preserve each public predicate and projection", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_metro_static_slugs()",
      )).rows,
      [{ slug: "child-a-tx" }, { slug: "child-b-tx" }, { slug: "major-tx" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT id FROM public.grainline_seller_public_metro_makers('major', true, 24)",
      )).rows,
      [{ id: "seller-major" }, { id: "seller-blocked" }, { id: "seller-child" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT id FROM public.grainline_seller_public_nearby_metros('major')",
      )).rows,
      [{ id: "child-a" }, { id: "child-b" }],
    );

    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_metro_makers('major', true, 24)",
      )).rows,
      [
        {
          id: "seller-major",
          displayName: "Major Maker",
          tagline: "Major tagline",
          city: "Austin",
          state: "TX",
          avatarImageUrl: "https://example.test/avatar.jpg",
          bannerImageUrl: null,
          guildLevel: "GUILD_MASTER",
          ownerImageUrl: null,
          coverImageUrl: "https://example.test/first.jpg",
          activeListingCount: 2,
        },
        {
          id: "seller-child",
          displayName: "Child Maker",
          tagline: null,
          city: "Round Rock",
          state: "TX",
          avatarImageUrl: null,
          bannerImageUrl: null,
          guildLevel: "GUILD_MEMBER",
          ownerImageUrl: null,
          coverImageUrl: null,
          activeListingCount: 1,
        },
      ],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT id FROM public.grainline_seller_public_metro_makers('child-a', false, 24)",
      )).rows,
      [{ id: "seller-child" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_nearby_metros('major')",
      )).rows,
      [{ id: "child-a", slug: "child-a-tx", name: "Child A" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_nearby_metros('child-a')",
      )).rows,
      [{ id: "major", slug: "major-tx", name: "Major" }],
    );
  } finally {
    await database.exec("RESET app.user_id").catch(() => {});
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("metro-directory authorities deny ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    for (const query of [
      "SELECT * FROM public.grainline_seller_public_metro_static_slugs()",
      "SELECT * FROM public.grainline_seller_public_metro_makers('major', true, 24)",
      "SELECT * FROM public.grainline_seller_public_nearby_metros('major')",
    ]) {
      await assert.rejects(database.query(query), /permission denied/u);
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
