import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020060000_prepare_seller_profile_founding_maker_grant/migration.sql",
  "utf8",
);

async function readyDatabase({ atCap = false } = {}) {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."ListingStatus" AS ENUM (
      'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SOLD', 'SOLD_OUT', 'HIDDEN'
    );
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "isFoundingMaker" boolean NOT NULL DEFAULT false,
      "foundingMakerNumber" integer UNIQUE,
      "foundingMakerAt" timestamp(3),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (
      id varchar(191) PRIMARY KEY,
      "sellerId" varchar(191) NOT NULL,
      status public."ListingStatus" NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamp(3)
    );
    CREATE TABLE public."FoundingMakerGrant" (
      id text PRIMARY KEY,
      "sellerProfileId" varchar(191) UNIQUE,
      "foundingMakerNumber" integer NOT NULL UNIQUE,
      "grantedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO public."SellerProfile" (
      id, "chargesEnabled", "stripeAccountSupported", "ownerAccountActive"
    ) VALUES
      ('eligible', true, true, true),
      ('private-only', true, true, true),
      ('restored', true, true, true);
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate") VALUES
      ('eligible-listing', 'eligible', 'ACTIVE', false),
      ('private-listing', 'private-only', 'ACTIVE', true),
      ('restored-listing', 'restored', 'ACTIVE', false);
    INSERT INTO public."FoundingMakerGrant" (
      id, "sellerProfileId", "foundingMakerNumber"
    ) VALUES ('existing-restored', 'restored', 7);
  `);
  if (atCap) {
    await database.exec(`
      INSERT INTO public."FoundingMakerGrant" (
        id, "sellerProfileId", "foundingMakerNumber"
      ) VALUES ('cap-sentinel', NULL, 250);
    `);
  }
  await database.exec(migration);
  return database;
}

test("founding-maker authority grants, restores, and replays without reissuing", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(
      "SELECT public.grainline_seller_service_founding_maker_grant('eligible') AS granted",
    )).rows, [{ granted: true }]);
    assert.deepEqual((await database.query(
      "SELECT public.grainline_seller_service_founding_maker_grant('eligible') AS granted",
    )).rows, [{ granted: true }]);
    assert.deepEqual((await database.query(
      "SELECT public.grainline_seller_service_founding_maker_grant('private-only') AS granted",
    )).rows, [{ granted: false }]);
    assert.deepEqual((await database.query(
      "SELECT public.grainline_seller_service_founding_maker_grant('restored') AS granted",
    )).rows, [{ granted: true }]);
    await database.exec("RESET ROLE");

    assert.deepEqual((await database.query(`
      SELECT seller.id,
             seller."isFoundingMaker",
             seller."foundingMakerNumber",
             grant_row."foundingMakerNumber" AS "ledgerNumber"
        FROM public."SellerProfile" AS seller
        LEFT JOIN public."FoundingMakerGrant" AS grant_row
          ON grant_row."sellerProfileId" = seller.id
       WHERE seller.id IN ('eligible', 'private-only', 'restored')
       ORDER BY seller.id
    `)).rows, [
      { id: "eligible", isFoundingMaker: true, foundingMakerNumber: 8, ledgerNumber: 8 },
      { id: "private-only", isFoundingMaker: false, foundingMakerNumber: null, ledgerNumber: null },
      { id: "restored", isFoundingMaker: true, foundingMakerNumber: 7, ledgerNumber: 7 },
    ]);
    assert.equal(Number((await database.query(
      `SELECT COUNT(*) AS count
         FROM public."FoundingMakerGrant"
        WHERE "sellerProfileId" = 'eligible'`,
    )).rows[0].count), 1);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("founding-maker authority enforces the cap, input boundary, and ACL", async () => {
  const database = await readyDatabase({ atCap: true });
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(
      "SELECT public.grainline_seller_service_founding_maker_grant('eligible') AS granted",
    )).rows, [{ granted: false }]);
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_service_founding_maker_grant('../eligible')",
      ),
      /target is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_service_founding_maker_grant('eligible')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
