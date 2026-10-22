import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019180000_prepare_seller_profile_owner_core/migration.sql",
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
      "displayName" varchar(100) NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "createdAt", "chargesEnabled", "vacationMode"
    ) VALUES
      ('active-seller', 'active-owner', 'Active Workshop',
       '2026-10-19 12:00:00', true, false),
      ('banned-seller', 'banned-owner', 'Banned Workshop',
       '2026-10-19 12:00:00', true, false),
      ('deleted-seller', 'deleted-owner', 'Deleted Workshop',
       '2026-10-19 12:00:00', true, false);
  `);
  await database.exec(migration);
  return database;
}

test("owner core returns only the current active owner's bounded state", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_core()"))
        .rows,
      [{
        sellerProfileId: "active-seller",
        displayName: "Active Workshop",
        createdAtEpochMillis: 1792411200000,
        chargesEnabled: true,
        vacationMode: false,
      }],
    );
    await database.exec("RESET ROLE");

    for (const ownerId of ["missing-owner", "banned-owner", "deleted-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query("SELECT * FROM public.grainline_seller_owner_core()"))
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

test("owner core rejects missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_core()"),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_core()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
