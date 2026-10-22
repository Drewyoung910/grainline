import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019220000_prepare_seller_profile_owner_listing_publish_review/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'HIDDEN', 'SOLD', 'SOLD_OUT'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL,
      status public."ListingStatus" NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('other-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "chargesEnabled", "vacationMode"
    ) VALUES
      ('active-seller', 'active-owner', 'Active Workshop', true, false),
      ('other-seller', 'other-owner', 'Other Workshop', false, true),
      ('banned-seller', 'banned-owner', 'Banned Workshop', true, false),
      ('deleted-seller', 'deleted-owner', 'Deleted Workshop', true, false);
    INSERT INTO public."Listing" (id, "sellerId", status) VALUES
      ('listing-active', 'active-seller', 'ACTIVE'),
      ('listing-sold', 'active-seller', 'SOLD'),
      ('listing-sold-out', 'active-seller', 'SOLD_OUT'),
      ('listing-draft', 'active-seller', 'DRAFT'),
      ('listing-review', 'active-seller', 'PENDING_REVIEW'),
      ('listing-hidden', 'active-seller', 'HIDDEN');
  `);
  await database.exec(migration);
  return database;
}

test("owner listing publish review preserves readiness and published-history scope", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_publish_review('active-seller')",
      )).rows,
      [{
        sellerProfileId: "active-seller",
        displayName: "Active Workshop",
        chargesEnabled: true,
        vacationMode: false,
        publishReviewListingCount: 3,
      }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_publish_review('other-seller')",
      )).rows,
      [],
    );
    await database.exec("RESET ROLE");

    for (const [ownerId, sellerProfileId] of [
      ["banned-owner", "banned-seller"],
      ["deleted-owner", "deleted-seller"],
      ["missing-owner", "active-seller"],
    ]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_owner_listing_publish_review($1)",
          [sellerProfileId],
        )).rows,
        [],
      );
      await database.exec("RESET ROLE");
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("owner listing publish review rejects invalid context, target, and callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_publish_review('active-seller')",
      ),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_listing_publish_review('')"),
      /target is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_publish_review('active-seller')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
