import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019200000_prepare_seller_profile_owner_listing_review/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL,
      status text NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('empty-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (id, "userId", "displayName") VALUES
      ('active-seller', 'active-owner', 'Active Workshop'),
      ('empty-seller', 'empty-owner', 'Empty Workshop'),
      ('banned-seller', 'banned-owner', 'Banned Workshop'),
      ('deleted-seller', 'deleted-owner', 'Deleted Workshop');
    INSERT INTO public."Listing" (id, "sellerId", status) VALUES
      ('listing-active', 'active-seller', 'ACTIVE'),
      ('listing-draft', 'active-seller', 'DRAFT'),
      ('listing-hidden', 'active-seller', 'HIDDEN');
  `);
  await database.exec(migration);
  return database;
}

test("owner listing review returns the active owner's total listing count", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"))
        .rows,
      [{
        sellerProfileId: "active-seller",
        displayName: "Active Workshop",
        totalListingCount: 3,
      }],
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'empty-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"))
        .rows,
      [{
        sellerProfileId: "empty-seller",
        displayName: "Empty Workshop",
        totalListingCount: 0,
      }],
    );
    await database.exec("RESET ROLE");

    for (const ownerId of ["missing-owner", "banned-owner", "deleted-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"))
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

test("owner listing review rejects missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
