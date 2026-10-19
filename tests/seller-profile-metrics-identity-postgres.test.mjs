import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020070000_prepare_seller_profile_metrics_identity/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    INSERT INTO public."SellerProfile" (
      id, "userId", "createdAt", "ownerAccountActive"
    ) VALUES
      ('active-seller', 'active-user', '2026-10-19 12:00:00', true),
      ('inactive-seller', 'inactive-user', '2026-10-18 06:30:00', false);
  `);
  await database.exec(migration);
  return database;
}

test("seller metrics identity preserves active and inactive historical targets", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_service_metrics_identity('active-seller')",
    )).rows, [{
      sellerUserId: "active-user",
      createdAtEpochMillis: 1792411200000,
    }]);
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_service_metrics_identity('inactive-seller')",
    )).rows, [{
      sellerUserId: "inactive-user",
      createdAtEpochMillis: 1792305000000,
    }]);
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_service_metrics_identity('missing-seller')",
    )).rows, []);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("seller metrics identity rejects invalid targets and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_service_metrics_identity('../active-seller')",
      ),
      /target is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_service_metrics_identity('active-seller')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
