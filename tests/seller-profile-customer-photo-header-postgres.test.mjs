import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020050000_prepare_seller_profile_customer_photo_header/migration.sql";
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
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Block" (
      id varchar(191) PRIMARY KEY,
      "blockerId" varchar(191) NOT NULL,
      "blockedId" varchar(191) NOT NULL,
      "createdAt" timestamp(3) NOT NULL
    );

    INSERT INTO public."User" (id) VALUES
      ('viewer'), ('blocked-viewer'), ('owner-visible'), ('owner-vacation'), ('owner-disabled');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "ownerAccountActive",
      "chargesEnabled", "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('visible', 'owner-visible', 'Visible Shop', true, true, true, false),
      ('vacation', 'owner-vacation', 'Vacation Shop', true, true, true, true),
      ('disabled', 'owner-disabled', 'Disabled Shop', true, false, true, false);
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt") VALUES
      ('blocked-pair', 'owner-visible', 'blocked-viewer', CURRENT_TIMESTAMP);
  `);
  if (migration) await database.exec(migration);
  return database;
}

test("customer-photo header preserves public, vacation, owner, and block behavior", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('visible')",
      )).rows,
      [{
        id: "visible",
        userId: "owner-visible",
        displayName: "Visible Shop",
        publicPhotosEligible: true,
      }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('vacation')",
      )).rows,
      [{
        id: "vacation",
        userId: "owner-vacation",
        displayName: "Vacation Shop",
        publicPhotosEligible: false,
      }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('disabled')",
      )).rows,
      [],
    );

    await database.query("SELECT set_config('app.user_id', 'owner-disabled', false)");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('disabled')",
      )).rows,
      [{
        id: "disabled",
        userId: "owner-disabled",
        displayName: "Disabled Shop",
        publicPhotosEligible: false,
      }],
    );
    await database.query("SELECT set_config('app.user_id', 'blocked-viewer', false)");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('visible')",
      )).rows,
      [],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("customer-photo header rejects invalid viewer context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', 'missing-viewer', false)");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('visible')",
      ),
      /viewer context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('visible')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
