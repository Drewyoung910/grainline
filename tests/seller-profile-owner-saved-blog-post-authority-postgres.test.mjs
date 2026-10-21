import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235800_prepare_seller_profile_owner_saved_blog_posts/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
    CREATE TYPE public."BlogPostType" AS ENUM (
      'STANDARD', 'MAKER_SPOTLIGHT', 'BEHIND_THE_BUILD', 'GIFT_GUIDE', 'WOOD_EDUCATION'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL,
      "displayName" text NOT NULL,
      "avatarImageUrl" text,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."BlogPost" (
      id text PRIMARY KEY,
      slug text NOT NULL,
      title text NOT NULL,
      excerpt text,
      "coverImageUrl" text,
      "authorId" text,
      "authorAccountActive" boolean NOT NULL DEFAULT false,
      "authorName" text,
      "authorImageUrl" text,
      "authorSellerName" text,
      "authorSellerAvatarUrl" text,
      "sellerProfileId" text,
      type public."BlogPostType" NOT NULL,
      status public."BlogPostStatus" NOT NULL,
      "readingTimeMinutes" integer,
      "publishedAt" timestamp(3)
    );
    CREATE TABLE public."SavedBlogPost" (
      id text PRIMARY KEY,
      "userId" text NOT NULL,
      "blogPostId" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL,
      "blockedId" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );

    INSERT INTO public."User" (id) VALUES
      ('actor'), ('other'), ('seller-active'), ('seller-blocked'), ('seller-vacation');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('active', 'seller-active', 'Active Maker', 'active.jpg', true, true, true, false),
      ('blocked', 'seller-blocked', 'Blocked Maker', 'blocked.jpg', true, true, true, false),
      ('vacation', 'seller-vacation', 'Vacation Maker', NULL, true, true, true, true);
    INSERT INTO public."BlogPost" (
      id, slug, title, excerpt, "coverImageUrl", "authorId", "authorAccountActive",
      "authorName", "authorImageUrl", "authorSellerName", "authorSellerAvatarUrl",
      "sellerProfileId", type, status, "readingTimeMinutes", "publishedAt"
    ) VALUES
      ('active-post', 'active-post', 'Active Post', 'Excerpt', 'cover.jpg', 'seller-active', true,
       'Author', 'author.jpg', 'Saved Active', 'saved-active.jpg', 'active', 'STANDARD', 'PUBLISHED', 4,
       '2026-10-20 10:00:00'),
      ('platform-post', 'platform-post', 'Platform Post', NULL, NULL, 'other', true,
       'Platform Author', NULL, NULL, NULL, NULL, 'MAKER_SPOTLIGHT', 'PUBLISHED', NULL,
       '2026-10-20 09:00:00'),
      ('blocked-post', 'blocked-post', 'Blocked Post', NULL, NULL, 'seller-blocked', true,
       'Blocked Author', NULL, NULL, NULL, 'blocked', 'STANDARD', 'PUBLISHED', 2,
       '2026-10-20 08:00:00'),
      ('vacation-post', 'vacation-post', 'Vacation Post', NULL, NULL, 'seller-vacation', true,
       'Vacation Author', NULL, NULL, NULL, 'vacation', 'STANDARD', 'PUBLISHED', 2,
       '2026-10-20 07:00:00'),
      ('future-post', 'future-post', 'Future Post', NULL, NULL, 'seller-active', true,
       'Future Author', NULL, NULL, NULL, 'active', 'STANDARD', 'PUBLISHED', 2,
       '2099-01-01 00:00:00'),
      ('draft-post', 'draft-post', 'Draft Post', NULL, NULL, 'seller-active', true,
       'Draft Author', NULL, NULL, NULL, 'active', 'STANDARD', 'DRAFT', 2,
       '2026-10-20 06:00:00');
    INSERT INTO public."SavedBlogPost" (id, "userId", "blogPostId", "createdAt") VALUES
      ('save-active', 'actor', 'active-post', '2026-10-20 12:00:00'),
      ('save-platform', 'actor', 'platform-post', '2026-10-20 11:00:00'),
      ('save-blocked', 'actor', 'blocked-post', '2026-10-20 10:00:00'),
      ('save-vacation', 'actor', 'vacation-post', '2026-10-20 09:00:00'),
      ('save-future', 'actor', 'future-post', '2026-10-20 08:00:00'),
      ('save-draft', 'actor', 'draft-post', '2026-10-20 07:00:00'),
      ('save-other', 'other', 'active-post', '2026-10-20 13:00:00');
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
    VALUES ('block', 'seller-blocked', 'actor', CURRENT_TIMESTAMP);
  `);
  await database.exec(migration);
  return database;
}

test("saved-blog authorities enforce actor, visibility, blocks, ordering, and UTC output", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()"))
        .rows,
      [{ value: 2 }],
    );
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_saved_blog_post_page(24, 0)"))
        .rows,
      [
        {
          blogPostId: "active-post",
          slug: "active-post",
          title: "Active Post",
          excerpt: "Excerpt",
          coverImageUrl: "cover.jpg",
          type: "STANDARD",
          readingTimeMinutes: 4,
          publishedAt: new Date("2026-10-20T10:00:00.000Z"),
          authorName: "Author",
          authorImageUrl: "author.jpg",
          authorSellerName: "Saved Active",
          authorSellerAvatarUrl: "saved-active.jpg",
          sellerProfileId: "active",
          sellerDisplayName: "Active Maker",
          sellerAvatarImageUrl: "active.jpg",
        },
        {
          blogPostId: "platform-post",
          slug: "platform-post",
          title: "Platform Post",
          excerpt: null,
          coverImageUrl: null,
          type: "MAKER_SPOTLIGHT",
          readingTimeMinutes: null,
          publishedAt: new Date("2026-10-20T09:00:00.000Z"),
          authorName: "Platform Author",
          authorImageUrl: null,
          authorSellerName: null,
          authorSellerAvatarUrl: null,
          sellerProfileId: null,
          sellerDisplayName: null,
          sellerAvatarImageUrl: null,
        },
      ],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("saved-blog authorities reject missing actors, invalid pages, and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()"),
      /actor context is invalid/u,
    );
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_blog_post_page(25, 0)"),
      /page input is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
