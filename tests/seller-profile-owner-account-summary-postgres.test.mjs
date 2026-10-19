import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019160000_prepare_seller_profile_owner_account_summary/migration.sql",
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
      "avatarImageUrl" text
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL,
      status text NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (id, "userId", "avatarImageUrl") VALUES
      ('active-seller', 'active-owner', 'https://example.test/avatar.jpg'),
      ('banned-seller', 'banned-owner', NULL),
      ('deleted-seller', 'deleted-owner', NULL);
    INSERT INTO public."Listing" (id, "sellerId", status) VALUES
      ('active-1', 'active-seller', 'ACTIVE'),
      ('active-2', 'active-seller', 'ACTIVE'),
      ('hidden-1', 'active-seller', 'HIDDEN');
  `);
  await database.exec(migration);
  return database;
}

test("owner account summary returns only the current active owner's bounded state", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"))
        .rows,
      [{
        sellerProfileId: "active-seller",
        avatarImageUrl: "https://example.test/avatar.jpg",
        activeListingCount: 2,
      }],
    );
    await database.exec("RESET ROLE");

    for (const ownerId of ["missing-owner", "banned-owner", "deleted-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"))
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

test("owner account summary rejects missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
