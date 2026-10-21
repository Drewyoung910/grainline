import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235900_prepare_seller_profile_public_favorite_target/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'HIDDEN');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      title varchar(200) NOT NULL,
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp without time zone
    );
    INSERT INTO public."SellerProfile" (
      id, "userId", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller', 'seller-user', true, true, true, false),
      ('vacation', 'vacation-user', true, true, true, true),
      ('inactive', 'inactive-user', false, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", title, status, "isPrivate", "archivedAt"
    ) VALUES
      ('active', 'seller', 'Active listing', 'ACTIVE', false, NULL),
      ('sold-out', 'seller', 'Sold-out listing', 'SOLD_OUT', false, NULL),
      ('private', 'seller', 'Private listing', 'ACTIVE', true, NULL),
      ('hidden', 'seller', 'Hidden listing', 'HIDDEN', false, NULL),
      ('archived', 'seller', 'Archived listing', 'ACTIVE', false, CURRENT_TIMESTAMP),
      ('vacation-listing', 'vacation', 'Vacation listing', 'ACTIVE', false, NULL),
      ('inactive-listing', 'inactive', 'Inactive listing', 'ACTIVE', false, NULL);
  `);
  await database.exec(migration);
  return database;
}

test("favorite target returns only a public detail listing and its active owner", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target('active')",
      )).rows,
      [{ listingId: "active", title: "Active listing", ownerUserId: "seller-user" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target('sold-out')",
      )).rows,
      [{ listingId: "sold-out", title: "Sold-out listing", ownerUserId: "seller-user" }],
    );
    for (const hiddenId of [
      "private",
      "hidden",
      "archived",
      "vacation-listing",
      "inactive-listing",
      "missing",
    ]) {
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_public_favorite_target($1)",
          [hiddenId],
        )).rows,
        [],
      );
    }
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target('bad id')",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("favorite target denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_favorite_target('active')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
