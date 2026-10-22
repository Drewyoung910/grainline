import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235987_prepare_seller_profile_similar_listing_candidates/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
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
      "guildLevel" text NOT NULL DEFAULT 'NONE',
      city varchar(100),
      state varchar(50),
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(150) NOT NULL,
      "priceCents" integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'usd',
      status text NOT NULL,
      "listingType" text NOT NULL DEFAULT 'MADE_TO_ORDER',
      "stockQuantity" integer,
      category text,
      tags text[] NOT NULL DEFAULT '{}',
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp(3),
      "createdAt" timestamp(3) NOT NULL DEFAULT now()
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      url varchar(2048) NOT NULL,
      "altText" varchar(200),
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );

    INSERT INTO public."User" (id) VALUES
      ('source-user'), ('candidate-a-user'), ('candidate-b-user'),
      ('vacation-user'), ('viewer-user');
    INSERT INTO public."User" (id, banned) VALUES ('banned-viewer', true);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "guildLevel", city, state,
      "chargesEnabled", "stripeAccountSupported", "vacationMode",
      "ownerAccountActive"
    ) VALUES
      ('source-seller', 'source-user', 'Source Maker', 'NONE', 'Austin', 'TX', true, true, false, true),
      ('candidate-a-seller', 'candidate-a-user', 'Candidate A', 'GUILD_MEMBER', 'Dallas', 'TX', true, true, false, true),
      ('candidate-b-seller', 'candidate-b-user', 'Candidate B', 'NONE', 'Tulsa', 'OK', true, true, false, true),
      ('vacation-seller', 'vacation-user', 'Vacation Maker', 'NONE', 'Waco', 'TX', true, true, true, true);
    INSERT INTO public."Listing" (
      id, "sellerId", title, "priceCents", status, "listingType",
      "stockQuantity", category, tags, "isPrivate", "archivedAt", "createdAt"
    ) VALUES
      ('source-listing', 'source-seller', 'Walnut Coffee Table', 10000, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'FURNITURE', ARRAY['walnut','table'], false, NULL, '2026-10-20'),
      ('hidden-source', 'source-seller', 'Hidden Source', 10000, 'SOLD_OUT', 'MADE_TO_ORDER', NULL, 'FURNITURE', ARRAY['walnut','table'], false, NULL, '2026-10-20'),
      ('same-seller', 'source-seller', 'Same seller', 9000, 'ACTIVE', 'IN_STOCK', 1, 'FURNITURE', ARRAY['walnut'], false, NULL, '2026-10-21'),
      ('candidate-a', 'candidate-a-seller', 'Walnut Side Table', 11000, 'ACTIVE', 'IN_STOCK', 2, 'FURNITURE', ARRAY['walnut','table'], false, NULL, '2026-10-22'),
      ('candidate-b', 'candidate-b-seller', 'Oak Bowl', 5000, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'DECOR', ARRAY['oak'], false, NULL, '2026-10-21'),
      ('candidate-private', 'candidate-b-seller', 'Private', 5000, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'DECOR', ARRAY['oak'], true, NULL, '2026-10-22'),
      ('candidate-archived', 'candidate-b-seller', 'Archived', 5000, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'DECOR', ARRAY['oak'], false, '2026-10-22', '2026-10-22'),
      ('candidate-vacation', 'vacation-seller', 'Vacation', 5000, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'DECOR', ARRAY['oak'], false, NULL, '2026-10-22'),
      ('candidate-too-expensive', 'candidate-b-seller', 'Too expensive', 100001, 'ACTIVE', 'MADE_TO_ORDER', NULL, 'DECOR', ARRAY['oak'], false, NULL, '2026-10-22');
    INSERT INTO public."Photo" (id, "listingId", url, "altText", "sortOrder") VALUES
      ('photo-a2', 'candidate-a', 'https://example.test/a2.jpg', 'Second', 2),
      ('photo-a1', 'candidate-a', 'https://example.test/a1.jpg', 'First', 1);
  `);
  await database.exec(migration);
  return database;
}

async function actorRead(database, listingId, actorId = null) {
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId ?? ""]);
  await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return (await database.query(
      "SELECT * FROM public.grainline_seller_actor_similar_listing_candidates($1)",
      [listingId],
    )).rows;
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION");
  }
}

test("similar-listing authority preserves ranking inputs and public eligibility", async () => {
  const database = await readyDatabase();
  try {
    const rows = await actorRead(database, "source-listing");
    assert.deepEqual(rows.map((row) => row.listingId), ["candidate-a", "candidate-b"]);
    assert.equal(rows[0].sourceTitle, "Walnut Coffee Table");
    assert.equal(rows[0].sourcePriceCents, 10000);
    assert.equal(Number(rows[0].tagOverlap), 2);
    assert.equal(rows[0].categoryMatch, true);
    assert.equal(rows[0].photoUrl, "https://example.test/a1.jpg");
    assert.equal(rows[0].secondPhotoUrl, "https://example.test/a2.jpg");
    assert.equal(Number(rows[1].tagOverlap), 0);
    assert.equal(rows[1].categoryMatch, false);

    assert.deepEqual(await actorRead(database, "hidden-source"), []);
  } finally {
    await database.close();
  }
});

test("similar-listing authority applies reciprocal blocks and active viewer context", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('candidate-block', 'candidate-a-user', 'viewer-user');
    `);
    const rows = await actorRead(database, "source-listing", "viewer-user");
    assert.deepEqual(rows.map((row) => row.listingId), ["candidate-b"]);
    await assert.rejects(
      actorRead(database, "source-listing", "banned-viewer"),
      /viewer context is invalid/u,
    );

    await database.exec("SET SESSION AUTHORIZATION grainline_untrusted");
    try {
      await assert.rejects(
        database.query(
          "SELECT * FROM public.grainline_seller_actor_similar_listing_candidates('source-listing')",
        ),
        /permission denied/u,
      );
    } finally {
      await database.exec("RESET SESSION AUTHORIZATION");
    }
  } finally {
    await database.close();
  }
});

test("similar-listing route delegates SellerProfile filtering to the bounded authority", () => {
  const route = readFileSync("src/app/api/listings/[id]/similar/route.ts", "utf8");
  const access = readFileSync("src/lib/sellerProfileSimilarListingAccess.ts", "utf8");

  assert.match(route, /sellerActorSimilarListingCandidates\(viewerUserId, id\)/u);
  assert.doesNotMatch(route, /SellerProfile|publicListingWhere|getBlockedSellerProfileIdsFor/u);
  assert.match(route, /Number\(r\.tagOverlap\) \* 3/u);
  assert.match(route, /r\.categoryMatch \? 5 : 0/u);
  assert.match(access, /grainline_seller_actor_similar_listing_candidates/u);
});
