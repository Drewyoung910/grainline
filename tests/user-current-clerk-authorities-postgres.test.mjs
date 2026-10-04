import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261003230000_prepare_user_current_clerk_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      name varchar(100),
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "vacationMode" boolean NOT NULL DEFAULT false,
      lat double precision,
      lng double precision,
      "radiusMeters" integer
    );
    INSERT INTO public."User" (id, "clerkId", name)
    VALUES ('user_one', 'user_clerk_one', 'One'),
           ('user_two', 'user_clerk_two', 'Two');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "chargesEnabled",
      "vacationMode", lat, lng, "radiusMeters"
    ) VALUES (
      'seller_one', 'user_one', 'One Shop', 'https://example.com/one.png', true,
      false, 41.88, -87.63, 80000
    );
  `);
  await database.exec(migration);
  return database;
}

test("runtime receives only the bounded current-Clerk projections", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const actor = (await database.query(`
      SELECT * FROM public.grainline_user_clerk_actor('user_clerk_one')
    `)).rows[0];
    assert.deepEqual(actor, {
      id: "user_one",
      name: "One",
      banned: false,
      deletedAt: null,
    });

    const commission = (await database.query(`
      SELECT * FROM public.grainline_user_clerk_commission_context('user_clerk_one')
    `)).rows[0];
    assert.deepEqual(commission, {
      id: "user_one",
      name: "One",
      banned: false,
      deletedAt: null,
      sellerProfileId: "seller_one",
      sellerDisplayName: "One Shop",
      sellerAvatarImageUrl: "https://example.com/one.png",
      sellerChargesEnabled: true,
      sellerVacationMode: false,
      sellerLat: 41.88,
      sellerLng: -87.63,
      sellerRadiusMeters: 80000,
    });

    const buyer = (await database.query(`
      SELECT * FROM public.grainline_user_clerk_commission_context('user_clerk_two')
    `)).rows[0];
    assert.equal(buyer.id, "user_two");
    for (const key of Object.keys(buyer).filter((key) => key.startsWith("seller"))) {
      assert.equal(buyer[key], null);
    }
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_clerk_actor('invalid clerk id')"),
      /Clerk actor identifier is invalid/,
    );
  } finally {
    await database.close();
  }
});

test("untrusted callers cannot execute the definer functions", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_clerk_actor('user_clerk_one')"),
      /permission denied for function grainline_user_clerk_actor/,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_user_clerk_commission_context('user_clerk_one')"),
      /permission denied for function grainline_user_clerk_commission_context/,
    );
  } finally {
    await database.close();
  }
});
