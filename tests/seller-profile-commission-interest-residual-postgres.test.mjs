import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020235500_prepare_seller_profile_commission_interest_residual_authorities/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id varchar(191) PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "ownerImageUrl" varchar(2048),
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."CommissionRequest" (
      id varchar(191) PRIMARY KEY,
      "buyerId" varchar(191) NOT NULL,
      status text NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE public."CommissionInterest" (
      id varchar(191) PRIMARY KEY,
      "commissionRequestId" varchar(191) NOT NULL,
      "sellerProfileId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );

    INSERT INTO public."User" (id) VALUES
      ('buyer'), ('other-buyer'), ('seller-inactive'), ('seller-active');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerImageUrl",
      "ownerAccountActive"
    ) VALUES
      ('profile-inactive', 'seller-inactive', 'Inactive maker', NULL,
       'inactive-owner.jpg', false),
      ('profile-active', 'seller-active', 'Active maker', 'active.jpg',
       'active-owner.jpg', true);
    INSERT INTO public."CommissionRequest" (id, "buyerId") VALUES
      ('request-owned', 'buyer'), ('request-other', 'other-buyer'),
      ('request-empty', 'buyer');
    INSERT INTO public."CommissionRequest" (id, "buyerId", status)
    VALUES ('request-closed', 'buyer', 'CLOSED');
    INSERT INTO public."CommissionInterest" (
      id, "commissionRequestId", "sellerProfileId", "createdAt"
    ) VALUES
      ('interest-inactive', 'request-owned', 'profile-inactive',
       '2026-10-20T10:00:00Z'),
      ('interest-active', 'request-owned', 'profile-active',
       '2026-10-20T11:00:00Z'),
      ('interest-other', 'request-other', 'profile-active',
       '2026-10-20T12:00:00Z'),
      ('interest-closed', 'request-closed', 'profile-active',
       '2026-10-20T13:00:00Z');
  `);
  if (migration) await database.exec(migration);
  return database;
}

test("owner commission summaries retain historical maker cards and bind the buyer", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'buyer', false)");
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_owner_commission_interest_summaries(
          ARRAY['request-owned', 'request-empty'], 1
        )
    `)).rows, [
      {
        commissionRequestId: "request-owned",
        interestedCount: 2,
        interestId: "interest-inactive",
        sellerProfileId: "profile-inactive",
        displayName: "Inactive maker",
        avatarImageUrl: null,
        ownerImageUrl: "inactive-owner.jpg",
      },
      {
        commissionRequestId: "request-empty",
        interestedCount: 0,
        interestId: null,
        sellerProfileId: null,
        displayName: null,
        avatarImageUrl: null,
        ownerImageUrl: null,
      },
    ]);
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_owner_commission_interest_summaries(
            ARRAY['request-other'], 3
          )
      `),
      /actor does not own every request/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("commission notification targets exclude inactive sellers and enforce ACL and bounds", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_service_commission_interest_targets(
          'request-owned', 10000
        )
    `)).rows, [{ userId: "seller-active" }]);
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_service_commission_interest_targets(
          'request-closed', 10000
        )
    `)).rows, []);
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_service_commission_interest_targets(
            'request-owned', 10001
          )
      `),
      /input is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_service_commission_interest_targets(
            'request-owned', 10000
          )
      `),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
