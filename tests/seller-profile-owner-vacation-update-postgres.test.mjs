import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020010000_prepare_seller_profile_owner_vacation_update/migration.sql",
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
      "vacationMode" boolean NOT NULL DEFAULT false,
      "vacationReturnDate" timestamp(3),
      "vacationMessage" varchar(200)
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-owner', false, NULL),
      ('banned-owner', true, NULL),
      ('deleted-owner', false, now());
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('active-seller', 'active-owner'),
      ('banned-seller', 'banned-owner'),
      ('deleted-seller', 'deleted-owner');
  `);
  await database.exec(migration);
  return database;
}

test("owner vacation update mutates only the active actor's expected seller", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_owner_vacation_update(
            'active-seller', true, 1793620800000, 'Back soon'
          )
      `)).rows,
      [{ sellerProfileId: "active-seller" }],
    );
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_owner_vacation_update(
            'banned-seller', false, NULL, NULL
          )
      `)).rows,
      [],
    );
    await database.exec("RESET ROLE");
    assert.deepEqual(
      (await database.query(`
        SELECT "vacationMode", "vacationReturnDate"::text AS "vacationReturnDate",
               "vacationMessage"
          FROM public."SellerProfile"
         WHERE id = 'active-seller'
      `)).rows,
      [{
        vacationMode: true,
        vacationReturnDate: "2026-11-02 12:00:00",
        vacationMessage: "Back soon",
      }],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("owner vacation update rejects invalid input, inactive actors, and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_owner_vacation_update(
            'active-seller', true, NULL, repeat('x', 201)
          )
      `),
      /input is invalid/u,
    );
    await database.exec("RESET ROLE");

    for (const actorId of ["banned-owner", "deleted-owner", "missing-owner"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query(`
          SELECT *
            FROM public.grainline_seller_owner_vacation_update(
              'active-seller', false, NULL, NULL
            )
        `)).rows,
        [],
      );
      await database.exec("RESET ROLE");
    }

    await database.query("SELECT set_config('app.user_id', 'active-owner', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_owner_vacation_update(
            'active-seller', false, NULL, NULL
          )
      `),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
