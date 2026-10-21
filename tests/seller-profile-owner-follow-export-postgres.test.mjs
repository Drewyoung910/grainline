import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235910_prepare_seller_profile_owner_follow_export/migration.sql",
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
      "deletedAt" timestamp without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL
    );
    CREATE TABLE public."Follow" (
      id text PRIMARY KEY,
      "followerId" text NOT NULL,
      "sellerProfileId" text NOT NULL,
      "createdAt" timestamp without time zone NOT NULL,
      UNIQUE ("followerId", "sellerProfileId")
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('actor', false, NULL),
      ('banned-actor', true, NULL),
      ('deleted-actor', false, '2026-10-20 00:00:00'),
      ('seller-one-user', false, NULL),
      ('seller-two-user', false, NULL);
    INSERT INTO public."SellerProfile" (id, "userId", "displayName") VALUES
      ('seller-one', 'seller-one-user', 'First Shop'),
      ('seller-two', 'seller-two-user', '');
    INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt") VALUES
      ('follow-one', 'actor', 'seller-one', '2026-10-20 11:00:00'),
      ('follow-two', 'actor', 'seller-two', '2026-10-20 12:00:00'),
      ('follow-banned', 'banned-actor', 'seller-one', '2026-10-20 13:00:00'),
      ('follow-deleted', 'deleted-actor', 'seller-one', '2026-10-20 14:00:00');
  `);
  await database.exec(migration);
  return database;
}

test("follow export returns every recorded shop label for only the active actor", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET TIME ZONE 'America/Los_Angeles'");
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(
      "SELECT * FROM public.grainline_seller_owner_follow_export()",
    )).rows;
    assert.deepEqual(rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })), [
      {
        sellerProfileId: "seller-two",
        createdAt: "2026-10-20T12:00:00.000Z",
        displayName: "",
      },
      {
        sellerProfileId: "seller-one",
        createdAt: "2026-10-20T11:00:00.000Z",
        displayName: "First Shop",
      },
    ]);
    await database.exec("RESET ROLE");

    for (const actorId of ["banned-actor", "deleted-actor", "missing-actor"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_owner_follow_export()",
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

test("follow export rejects missing context and callers without an exact grant", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_follow_export()"),
      (error) => error?.code === "42501",
    );
    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_follow_export()"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
