import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020080000_prepare_seller_profile_service_identities/migration.sql",
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
      "displayName" varchar(100) NOT NULL,
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "ownerAccountActive"
    ) VALUES
      ('seller-a', 'user-a', 'Workshop A', true),
      ('seller-b', 'user-b', 'Workshop B', false);
  `);
  await database.exec(migration);
  return database;
}

test("service identities preserve inactive welcome and blocked-pair targets", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_service_welcome_name('user-b')",
    )).rows, [{ displayName: "Workshop B" }]);
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_service_welcome_name('missing-user')",
    )).rows, []);
    assert.deepEqual((await database.query(
      "SELECT * FROM public.grainline_seller_transaction_blocked_pair_targets('user-a', 'user-b')",
    )).rows, [
      { buyerUserId: "user-a", sellerUserId: "user-b", sellerProfileId: "seller-b" },
      { buyerUserId: "user-b", sellerUserId: "user-a", sellerProfileId: "seller-a" },
    ]);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("service identities reject invalid targets and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_service_welcome_name('../user-a')",
      ),
      /target is invalid/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_transaction_blocked_pair_targets('user-a', '../user-b')",
      ),
      /target is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_service_welcome_name('user-a')",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_transaction_blocked_pair_targets('user-a', 'user-b')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
