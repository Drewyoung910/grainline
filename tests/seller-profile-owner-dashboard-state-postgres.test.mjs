import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019230000_prepare_seller_profile_owner_dashboard_state/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "vacationMode" boolean NOT NULL DEFAULT false,
      "vacationReturnDate" timestamp(3),
      "chargesEnabled" boolean NOT NULL DEFAULT false
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (
      id, "userId", "guildLevel", "vacationMode", "vacationReturnDate", "chargesEnabled"
    ) VALUES
      ('active-seller', 'active-owner', 'GUILD_MEMBER', true,
       '2026-11-02 12:30:00', true),
      ('banned-seller', 'banned-owner', 'NONE', false, NULL, true),
      ('deleted-seller', 'deleted-owner', 'NONE', false, NULL, true);
  `);
  await database.exec(migration);
  return database;
}

test("owner dashboard state returns only the active owner's bounded state", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query("SELECT * FROM public.grainline_seller_owner_dashboard_state()"))
        .rows,
      [{
        sellerProfileId: "active-seller",
        guildLevel: "GUILD_MEMBER",
        vacationMode: true,
        vacationReturnEpochMillis: 1793622600000,
        chargesEnabled: true,
      }],
    );
    await database.exec("RESET ROLE");

    for (const ownerId of ["missing-owner", "banned-owner", "deleted-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [ownerId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query("SELECT * FROM public.grainline_seller_owner_dashboard_state()"))
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

test("owner dashboard state rejects missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_dashboard_state()"),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_dashboard_state()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
