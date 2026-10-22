import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019210000_prepare_seller_profile_owner_listing_metro_source/migration.sql",
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
      lat double precision,
      lng double precision
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('empty-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (id, "userId", lat, lng) VALUES
      ('active-seller', 'active-owner', 30.251, -97.749),
      ('empty-seller', 'empty-owner', NULL, NULL),
      ('banned-seller', 'banned-owner', 31, -98),
      ('deleted-seller', 'deleted-owner', 32, -99);
  `);
  await database.exec(migration);
  return database;
}

test("owner listing metro source returns only the exact owned coordinate pair", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source('active-seller')",
      )).rows,
      [{ sellerProfileId: "active-seller", lat: 30.251, lng: -97.749 }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source('empty-seller')",
      )).rows,
      [],
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'empty-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source('empty-seller')",
      )).rows,
      [{ sellerProfileId: "empty-seller", lat: null, lng: null }],
    );
    await database.exec("RESET ROLE");

    for (const [ownerId, sellerProfileId] of [
      ["missing-owner", "active-seller"],
      ["banned-owner", "banned-seller"],
      ["deleted-owner", "deleted-seller"],
    ]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_owner_listing_metro_source($1)",
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

test("owner listing metro source rejects invalid context, target, and callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source('active-seller')",
      ),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_listing_metro_source('')"),
      /target is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source('active-seller')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
