import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020235000_prepare_seller_profile_public_commission_interests/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const timestampCorrection = readFileSync(
  "prisma/migrations/20261020235700_correct_seller_profile_projection_timestamps/migration.sql",
  "utf8",
);

function correctionFor(functionName) {
  const start = timestampCorrection.indexOf(`DROP FUNCTION public.${functionName}`);
  assert.notEqual(start, -1);
  const next = timestampCorrection.indexOf("\nDROP FUNCTION public.", start + 1);
  const end = next === -1 ? timestampCorrection.lastIndexOf("\nCOMMIT;") : next;
  assert.notEqual(end, -1);
  return `BEGIN;\n${timestampCorrection.slice(start, end)}\nCOMMIT;`;
}

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TYPE public."CommissionStatus" AS ENUM (
      'OPEN', 'IN_PROGRESS', 'FULFILLED', 'CLOSED', 'EXPIRED'
    );
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
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."CommissionRequest" (
      id varchar(191) PRIMARY KEY,
      "buyerAccountActive" boolean NOT NULL DEFAULT false,
      status public."CommissionStatus" NOT NULL DEFAULT 'OPEN',
      "expiresAt" timestamp(3)
    );
    CREATE TABLE public."CommissionInterest" (
      id varchar(191) PRIMARY KEY,
      "commissionRequestId" varchar(191) NOT NULL,
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
      ('viewer'), ('seller-a'), ('seller-b'), ('seller-vacation'), ('seller-inactive');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "ownerImageUrl",
      "guildLevel", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('profile-a', 'seller-a', 'Maker A', 'a.jpg', 'owner-a.jpg',
       'GUILD_MASTER', true, true, true, false),
      ('profile-b', 'seller-b', 'Maker B', NULL, 'owner-b.jpg',
       'NONE', true, true, true, false),
      ('profile-vacation', 'seller-vacation', 'Vacation', NULL, NULL,
       'NONE', true, true, true, true),
      ('profile-inactive', 'seller-inactive', 'Inactive', NULL, NULL,
       'NONE', false, true, true, false);
    INSERT INTO public."CommissionRequest"
      (id, "buyerAccountActive", status, "expiresAt")
    VALUES
      ('request-open', true, 'OPEN', NULL),
      ('request-second', true, 'OPEN', NULL),
      ('request-closed', true, 'CLOSED', NULL),
      ('request-inactive', false, 'OPEN', NULL);
    INSERT INTO public."CommissionInterest"
      (id, "commissionRequestId", "sellerProfileId", "createdAt")
    VALUES
      ('interest-a', 'request-open', 'profile-a', '2026-10-20T10:00:00Z'),
      ('interest-b', 'request-open', 'profile-b', '2026-10-20T11:00:00Z'),
      ('interest-vacation', 'request-open', 'profile-vacation', '2026-10-20T12:00:00Z'),
      ('interest-inactive', 'request-open', 'profile-inactive', '2026-10-20T13:00:00Z'),
      ('interest-second', 'request-second', 'profile-a', '2026-10-20T14:00:00Z'),
      ('interest-closed', 'request-closed', 'profile-a', '2026-10-20T15:00:00Z'),
      ('interest-request-inactive', 'request-inactive', 'profile-a', '2026-10-20T16:00:00Z');
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
    VALUES ('block-b', 'seller-b', 'viewer', CURRENT_TIMESTAMP);
  `);
  if (migration) await database.exec(migration);
  await database.exec(correctionFor("grainline_seller_public_commission_interest_cards"));
  return database;
}

test("commission-interest authorities bind public request and seller visibility", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY['request-second', 'request-open', 'request-closed', 'request-inactive']
          )
      `)).rows,
      [
        { commissionRequestId: "request-second", value: 1 },
        { commissionRequestId: "request-open", value: 2 },
      ],
    );
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_cards(
            'request-open', 100
          )
      `)).rows,
      [
        {
          interestId: "interest-a",
          createdAt: new Date("2026-10-20T10:00:00.000Z"),
          sellerProfileId: "profile-a",
          displayName: "Maker A",
          avatarImageUrl: "a.jpg",
          ownerImageUrl: "owner-a.jpg",
          guildLevel: "GUILD_MASTER",
        },
        {
          interestId: "interest-b",
          createdAt: new Date("2026-10-20T11:00:00.000Z"),
          sellerProfileId: "profile-b",
          displayName: "Maker B",
          avatarImageUrl: null,
          ownerImageUrl: "owner-b.jpg",
          guildLevel: "NONE",
        },
      ],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("commission-interest authorities apply viewer blocks and reject invalid calls", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'viewer', false)");
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY['request-open']
          )
      `)).rows,
      [{ commissionRequestId: "request-open", value: 1 }],
    );
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerProfileId"
          FROM public.grainline_seller_public_commission_interest_cards(
            'request-open', 100
          )
      `)).rows,
      [{ sellerProfileId: "profile-a" }],
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY[]::text[]
          )
      `),
      /input is invalid/u,
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_cards(
            'request-open', 101
          )
      `),
      /input is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY['request-open']
          )
      `),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
