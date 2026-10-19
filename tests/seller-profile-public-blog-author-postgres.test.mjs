import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020020000_prepare_seller_profile_public_blog_author/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      tagline varchar(140),
      "avatarImageUrl" varchar(2048),
      "bannerImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."BlogPost" (
      id text PRIMARY KEY,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      status public."BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
      "publishedAt" timestamp without time zone,
      "authorAccountActive" boolean NOT NULL DEFAULT false
    );

    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", tagline, "avatarImageUrl",
      "bannerImageUrl", "ownerImageUrl", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('visible', 'user-visible', 'Visible Author', 'Stories from the shop',
       'https://example.test/avatar.jpg', 'https://example.test/banner.jpg',
       'https://example.test/owner.jpg', true, true, true, false),
      ('draft-only', 'user-draft', 'Draft Author', NULL,
       NULL, NULL, NULL, true, true, true, false),
      ('future-only', 'user-future', 'Future Author', NULL,
       NULL, NULL, NULL, true, true, true, false),
      ('inactive-post', 'user-inactive-post', 'Inactive Post Author', NULL,
       NULL, NULL, NULL, true, true, true, false),
      ('vacation', 'user-vacation', 'Vacation Author', NULL,
       NULL, NULL, NULL, true, true, true, true),
      ('unsupported', 'user-unsupported', 'Unsupported Author', NULL,
       NULL, NULL, NULL, true, true, false, false);

    INSERT INTO public."BlogPost" (
      id, "sellerProfileId", status, "publishedAt", "authorAccountActive"
    ) VALUES
      ('visible-post', 'visible', 'PUBLISHED', CURRENT_TIMESTAMP - INTERVAL '1 day', true),
      ('draft-post', 'draft-only', 'DRAFT', NULL, true),
      ('future-post', 'future-only', 'PUBLISHED', CURRENT_TIMESTAMP + INTERVAL '1 day', true),
      ('inactive-post-row', 'inactive-post', 'PUBLISHED', CURRENT_TIMESTAMP - INTERVAL '1 day', false),
      ('vacation-post', 'vacation', 'PUBLISHED', CURRENT_TIMESTAMP - INTERVAL '1 day', true),
      ('unsupported-post', 'unsupported', 'PUBLISHED', CURRENT_TIMESTAMP - INTERVAL '1 day', true),
      ('staff-post', NULL, 'PUBLISHED', CURRENT_TIMESTAMP - INTERVAL '1 day', true);
  `);
  if (migration) await database.exec(migration);
  return database;
}

test("blog-author authority returns only a seller with a currently public post", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_blog_author('visible')",
      )).rows,
      [{
        id: "visible",
        userId: "user-visible",
        displayName: "Visible Author",
        tagline: "Stories from the shop",
        avatarImageUrl: "https://example.test/avatar.jpg",
        bannerImageUrl: "https://example.test/banner.jpg",
        ownerImageUrl: "https://example.test/owner.jpg",
      }],
    );
    for (const hiddenId of [
      "draft-only",
      "future-only",
      "inactive-post",
      "vacation",
      "unsupported",
      "missing",
    ]) {
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_public_blog_author($1)",
          [hiddenId],
        )).rows,
        [],
      );
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("blog-author authority denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_blog_author('visible')"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
