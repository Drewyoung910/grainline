import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019130000_prepare_seller_profile_public_view_target/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );

    INSERT INTO public."SellerProfile" (
      id, "userId", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('visible', 'user-visible', true, true, true, false),
      ('vacation', 'user-vacation', true, true, true, true),
      ('inactive-owner', 'user-inactive-owner', false, true, true, false),
      ('disabled-charges', 'user-disabled-charges', true, false, true, false),
      ('unsupported', 'user-unsupported', true, true, false, false);
  `);
  await database.exec(migration);
  return database;
}

test("seller-view target returns only the visible owner and keeps vacation visibility", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_view_target('visible')",
      )).rows,
      [{ ownerUserId: "user-visible" }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_view_target('vacation')",
      )).rows,
      [{ ownerUserId: "user-vacation" }],
    );
    for (const id of ["inactive-owner", "disabled-charges", "unsupported", "missing"]) {
      assert.deepEqual(
        (await database.query(
          "SELECT * FROM public.grainline_seller_public_view_target($1)",
          [id],
        )).rows,
        [],
      );
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("seller-view target denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_view_target('visible')"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
