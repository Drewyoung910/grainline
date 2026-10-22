import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019190000_prepare_seller_profile_owner_blog_editor/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN', 'SOLD');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL,
      title varchar(150) NOT NULL,
      status public."ListingStatus" NOT NULL,
      "updatedAt" timestamp(3) NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('empty-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('active-seller', 'active-owner'),
      ('empty-seller', 'empty-owner'),
      ('banned-seller', 'banned-owner'),
      ('deleted-seller', 'deleted-owner');
    INSERT INTO public."Listing" (id, "sellerId", title, status, "updatedAt") VALUES
      ('listing-old', 'active-seller', 'Older active listing', 'ACTIVE', '2026-10-18 12:00:00'),
      ('listing-new-b', 'active-seller', 'Newer active listing B', 'ACTIVE', '2026-10-19 12:00:00'),
      ('listing-new-a', 'active-seller', 'Newer active listing A', 'ACTIVE', '2026-10-19 12:00:00'),
      ('listing-draft', 'active-seller', 'Draft listing', 'DRAFT', '2026-10-20 12:00:00');
  `);
  await database.exec(migration);
  return database;
}

test("owner blog editor returns the active owner's bounded listing choices", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"))
        .rows,
      [
        {
          sellerProfileId: "active-seller",
          listingId: "listing-new-a",
          listingTitle: "Newer active listing A",
        },
        {
          sellerProfileId: "active-seller",
          listingId: "listing-new-b",
          listingTitle: "Newer active listing B",
        },
        {
          sellerProfileId: "active-seller",
          listingId: "listing-old",
          listingTitle: "Older active listing",
        },
      ],
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'empty-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"))
        .rows,
      [{ sellerProfileId: "empty-seller", listingId: null, listingTitle: null }],
    );
    await database.exec("RESET ROLE");

    for (const ownerId of ["missing-owner", "banned-owner", "deleted-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"))
          .rows,
        [],
      );
      await database.exec("RESET ROLE");
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("owner blog editor rejects missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
