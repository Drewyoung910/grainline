import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020040000_prepare_seller_profile_account_feed_cards/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."User" (
      id varchar(191) PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Follow" (
      id varchar(191) PRIMARY KEY,
      "followerId" varchar(191) NOT NULL,
      "sellerProfileId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE public."Block" (
      id varchar(191) PRIMARY KEY,
      "blockerId" varchar(191) NOT NULL,
      "blockedId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );

    INSERT INTO public."User" (id) VALUES
      ('actor'), ('seller-active'), ('seller-blocked'), ('seller-vacation'),
      ('seller-unfollowed'), ('outsider');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "guildLevel", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('active', 'seller-active', 'Active Shop', 'GUILD_MASTER', true, true, true, false),
      ('blocked', 'seller-blocked', 'Blocked Shop', 'NONE', true, true, true, false),
      ('vacation', 'seller-vacation', 'Vacation Shop', 'GUILD_MEMBER', true, true, true, true),
      ('unfollowed', 'seller-unfollowed', 'Unfollowed Shop', 'NONE', true, true, true, false);
    INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt") VALUES
      ('follow-active', 'actor', 'active', CURRENT_TIMESTAMP),
      ('follow-blocked', 'actor', 'blocked', CURRENT_TIMESTAMP),
      ('follow-vacation', 'actor', 'vacation', CURRENT_TIMESTAMP);
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt") VALUES
      ('block-reciprocal', 'seller-blocked', 'actor', CURRENT_TIMESTAMP);
  `);
  if (migration) await database.exec(migration);
  return database;
}

test("account-feed cards preserve request order and require follow, visibility, and no block", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_actor_account_feed_cards(
            ARRAY['vacation', 'active', 'blocked', 'unfollowed']::text[]
          )
      `)).rows,
      [{ id: "active", displayName: "Active Shop", guildLevel: "GUILD_MASTER" }],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("account-feed cards reject invalid actor, duplicate targets, and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_actor_account_feed_cards(ARRAY['active']::text[])",
      ),
      /context is invalid/u,
    );
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_actor_account_feed_cards(
            ARRAY['active', 'active']::text[]
          )
      `),
      /target set is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_actor_account_feed_cards(ARRAY['active']::text[])",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
