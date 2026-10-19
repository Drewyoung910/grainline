import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019120000_prepare_seller_profile_public_footer_metros/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."Metro" (
      id text PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      state text NOT NULL,
      "isActive" boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "metroId" text REFERENCES public."Metro"(id),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "metroId" text REFERENCES public."Metro"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp
    );

    INSERT INTO public."Metro" (id, slug, name, state, "isActive") VALUES
      ('seller-only', 'seller-only-tx', 'Seller Only', 'TX', true),
      ('public-listing', 'public-listing-tx', 'Public Listing', 'TX', true),
      ('inactive-seller', 'inactive-seller-tx', 'Inactive Seller', 'TX', true),
      ('inactive-metro', 'inactive-metro-tx', 'Inactive Metro', 'TX', false);
    INSERT INTO public."SellerProfile" (
      id, "metroId", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('active-seller', 'seller-only', true, true, true, false),
      ('listing-seller', NULL, true, true, true, false),
      ('disabled-seller', 'inactive-seller', true, false, true, false),
      ('inactive-metro-seller', 'inactive-metro', true, true, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", "metroId", status, "isPrivate", "archivedAt"
    ) VALUES
      ('seller-private-one', 'active-seller', 'seller-only', 'DRAFT', true, NULL),
      ('seller-private-two', 'active-seller', 'seller-only', 'DRAFT', true, NULL),
      ('public-one', 'listing-seller', 'public-listing', 'ACTIVE', false, NULL),
      ('disabled-public', 'disabled-seller', 'inactive-seller', 'ACTIVE', false, NULL);
  `);
  await database.exec(migration);
  return database;
}

test("footer metro authority preserves eligibility, ranking and projection", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_footer_metros()",
      )).rows,
      [
        { slug: "seller-only-tx", name: "Seller Only", state: "TX" },
        { slug: "public-listing-tx", name: "Public Listing", state: "TX" },
      ],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("footer metro authority denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_footer_metros()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
