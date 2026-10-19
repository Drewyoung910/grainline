import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019150000_prepare_seller_profile_public_report_target/migration.sql",
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

test("seller-profile report target matches only the visible profile-owner pair", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    for (const [sellerId, userId, expected] of [
      ["visible", "user-visible", true],
      ["vacation", "user-vacation", true],
      ["visible", "user-vacation", false],
      ["inactive-owner", "user-inactive-owner", false],
      ["disabled-charges", "user-disabled-charges", false],
      ["unsupported", "user-unsupported", false],
      ["missing", "user-visible", false],
    ]) {
      assert.deepEqual(
        (await database.query(
          "SELECT public.grainline_seller_public_report_target($1, $2) AS value",
          [sellerId, userId],
        )).rows,
        [{ value: expected }],
      );
    }
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("seller-profile report target denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_public_report_target('visible', 'user-visible')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
