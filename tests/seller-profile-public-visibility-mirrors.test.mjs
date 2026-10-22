import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const userSellerStateMigration = readFileSync(
  "prisma/migrations/20261004050000_prepare_user_public_seller_state/migration.sql",
  "utf8",
);
const blogStateMigration = readFileSync(
  "prisma/migrations/20261007010000_prepare_user_public_blog_state/migration.sql",
  "utf8",
);
const visibilityMigration = readFileSync(
  "prisma/migrations/20261020235989_prepare_seller_profile_public_visibility_mirrors/migration.sql",
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
      "deletedAt" timestamp,
      name varchar(100),
      "imageUrl" varchar(2048)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      "displayNameNormalized" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."SellerRatingSummary" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "averageRating" double precision NOT NULL DEFAULT 0,
      "reviewCount" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL DEFAULT 'ACTIVE',
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp
    );
    CREATE TABLE public."BlogPost" (
      id text PRIMARY KEY,
      "authorId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id) ON DELETE SET NULL
    );
    CREATE TABLE public."BlogComment" (
      id text PRIMARY KEY,
      "authorId" text NOT NULL REFERENCES public."User"(id)
    );

    INSERT INTO public."User" (id, banned, name) VALUES
      ('active-user', false, 'Active Maker'),
      ('vacation-user', false, 'Vacation Maker'),
      ('staff-user', false, 'Staff Writer');
    INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized",
       "chargesEnabled", "stripeAccountSupported", "vacationMode")
    VALUES
      ('active-seller', 'active-user', 'Active Shop', 'active shop', true, true, false),
      ('vacation-seller', 'vacation-user', 'Vacation Shop', 'vacation shop', true, true, true);
    INSERT INTO public."SellerRatingSummary"
      ("sellerProfileId", "averageRating", "reviewCount")
    VALUES ('active-seller', 4.5, 8);
    INSERT INTO public."Listing" (id, "sellerId") VALUES
      ('active-listing', 'active-seller'),
      ('vacation-listing', 'vacation-seller');
    INSERT INTO public."BlogPost" (id, "authorId", "sellerProfileId") VALUES
      ('maker-post', 'active-user', 'active-seller'),
      ('staff-post', 'staff-user', NULL);
  `);
  await database.exec(userSellerStateMigration);
  await database.exec(blogStateMigration);
  await database.exec(visibilityMigration);
  return database;
}

test("public visibility mirrors backfill existing listing and blog behavior", async () => {
  const database = await readyDatabase();
  try {
    const listings = (await database.query(`
      SELECT id,
             "sellerPubliclyOrderable" AS orderable,
             "sellerDisplayName" AS name,
             "sellerDisplayNameNormalized" AS normalized,
             "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       ORDER BY id
    `)).rows;
    assert.deepEqual(listings, [
      {
        id: "active-listing",
        orderable: true,
        name: "Active Shop",
        normalized: "active shop",
        rating: 4.5,
        reviews: 8,
      },
      {
        id: "vacation-listing",
        orderable: false,
        name: "Vacation Shop",
        normalized: "vacation shop",
        rating: 0,
        reviews: 0,
      },
    ]);

    const posts = (await database.query(`
      SELECT id, "authorSellerPubliclyOrderable" AS orderable
        FROM public."BlogPost"
       ORDER BY id
    `)).rows;
    assert.deepEqual(posts, [
      { id: "maker-post", orderable: true },
      { id: "staff-post", orderable: false },
    ]);
  } finally {
    await database.close();
  }
});

test("public visibility mirrors reject forged writes and follow source changes", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      UPDATE public."Listing"
         SET "sellerPubliclyOrderable" = false,
             "sellerDisplayName" = 'Forged',
             "sellerDisplayNameNormalized" = 'forged',
             "sellerAverageRating" = 1,
             "sellerReviewCount" = 1
       WHERE id = 'active-listing';
      UPDATE public."BlogPost"
         SET "authorSellerPubliclyOrderable" = false
       WHERE id = 'maker-post';
    `);
    assert.deepEqual((await database.query(`
      SELECT "sellerPubliclyOrderable" AS orderable,
             "sellerDisplayName" AS name,
             "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       WHERE id = 'active-listing'
    `)).rows, [{ orderable: true, name: "Active Shop", rating: 4.5, reviews: 8 }]);
    assert.equal((await database.query(`
      SELECT "authorSellerPubliclyOrderable" AS orderable
        FROM public."BlogPost"
       WHERE id = 'maker-post'
    `)).rows[0].orderable, true);

    await database.exec(`
      UPDATE public."SellerProfile"
         SET "vacationMode" = true,
             "displayName" = 'Renamed Shop',
             "displayNameNormalized" = 'renamed shop'
       WHERE id = 'active-seller';
      UPDATE public."SellerRatingSummary"
         SET "averageRating" = 4.75,
             "reviewCount" = 9
       WHERE "sellerProfileId" = 'active-seller';
    `);
    assert.deepEqual((await database.query(`
      SELECT "sellerPubliclyOrderable" AS orderable,
             "sellerDisplayName" AS name,
             "sellerDisplayNameNormalized" AS normalized,
             "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       WHERE id = 'active-listing'
    `)).rows, [{
      orderable: false,
      name: "Renamed Shop",
      normalized: "renamed shop",
      rating: 4.75,
      reviews: 9,
    }]);
    assert.equal((await database.query(`
      SELECT "authorSellerPubliclyOrderable" AS orderable
        FROM public."BlogPost"
       WHERE id = 'maker-post'
    `)).rows[0].orderable, false);
  } finally {
    await database.close();
  }
});

test("new rows bind mirrors and trigger functions remain private", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      INSERT INTO public."Listing"
        (id, "sellerId", "sellerPubliclyOrderable", "sellerDisplayName",
         "sellerDisplayNameNormalized", "sellerAverageRating", "sellerReviewCount")
      VALUES
        ('bound-listing', 'active-seller', false, 'Forged', 'forged', 1, 1);
      INSERT INTO public."BlogPost"
        (id, "authorId", "sellerProfileId", "authorSellerPubliclyOrderable")
      VALUES ('bound-post', 'active-user', 'active-seller', false);
    `);
    assert.deepEqual((await database.query(`
      SELECT "sellerPubliclyOrderable" AS orderable,
             "sellerDisplayName" AS name,
             "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       WHERE id = 'bound-listing'
    `)).rows, [{ orderable: true, name: "Active Shop", rating: 4.5, reviews: 8 }]);
    assert.equal((await database.query(`
      SELECT "authorSellerPubliclyOrderable" AS orderable
        FROM public."BlogPost"
       WHERE id = 'bound-post'
    `)).rows[0].orderable, true);

    const privileges = (await database.query(`
      SELECT routine.proname AS name,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime', routine.oid, 'EXECUTE'
             ) AS "runtimeExecute",
             EXISTS (
               SELECT 1
                 FROM pg_catalog.aclexplode(
                   COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
                 ) AS acl
                WHERE acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
             ) AS "publicExecute"
        FROM pg_catalog.pg_proc AS routine
       WHERE routine.proname IN (
         'grainline_listing_seller_public_state_bind',
         'grainline_blog_post_author_public_state_bind',
         'grainline_seller_public_blog_state_sync',
         'grainline_seller_rating_listing_state_sync'
       )
       ORDER BY routine.proname
    `)).rows;
    assert.equal(privileges.length, 4);
    assert.equal(privileges.every((row) => !row.runtimeExecute && !row.publicExecute), true);
  } finally {
    await database.close();
  }
});

test("rating mirror resets both sides when a summary is rebound or deleted", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      UPDATE public."SellerRatingSummary"
         SET "sellerProfileId" = 'vacation-seller',
             "averageRating" = 4.75,
             "reviewCount" = 9
       WHERE "sellerProfileId" = 'active-seller';
    `);
    assert.deepEqual((await database.query(`
      SELECT id,
             "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       ORDER BY id
    `)).rows, [
      { id: "active-listing", rating: 0, reviews: 0 },
      { id: "vacation-listing", rating: 4.75, reviews: 9 },
    ]);

    await database.exec(`
      DELETE FROM public."SellerRatingSummary"
       WHERE "sellerProfileId" = 'vacation-seller';
    `);
    assert.deepEqual((await database.query(`
      SELECT "sellerAverageRating" AS rating,
             "sellerReviewCount" AS reviews
        FROM public."Listing"
       WHERE id = 'vacation-listing'
    `)).rows, [{ rating: 0, reviews: 0 }]);
  } finally {
    await database.close();
  }
});
