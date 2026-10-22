import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235986_prepare_seller_profile_listing_detail_authorities/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      city varchar(100),
      state varchar(50),
      "allowLocalPickup" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "acceptsCustomOrders" boolean NOT NULL DEFAULT false,
      "offersGiftWrapping" boolean NOT NULL DEFAULT false,
      "giftWrappingPriceCents" integer,
      "returnPolicy" varchar(2000),
      "shippingPolicy" varchar(2000),
      "customOrderPolicy" varchar(2000),
      tagline varchar(140),
      "avatarImageUrl" varchar(2048),
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "isFoundingMaker" boolean NOT NULL DEFAULT false,
      "foundingMakerNumber" integer,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "ownerImageUrl" varchar(2048)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text,
      "archivedAt" timestamp(3)
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );

    INSERT INTO public."User" (id, role) VALUES
      ('seller-user', 'USER'),
      ('buyer-user', 'USER'),
      ('other-user', 'USER'),
      ('staff-user', 'ADMIN');
    INSERT INTO public."User" (id, role, banned) VALUES
      ('banned-user', 'USER', true);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", city, state, "allowLocalPickup",
      "chargesEnabled", "stripeAccountSupported", "vacationMode",
      "acceptingNewOrders", "acceptsCustomOrders", "offersGiftWrapping",
      "giftWrappingPriceCents", "returnPolicy", "shippingPolicy",
      "customOrderPolicy", tagline, "avatarImageUrl", "guildLevel",
      "isFoundingMaker", "foundingMakerNumber", "ownerAccountActive",
      "ownerImageUrl"
    ) VALUES (
      'seller', 'seller-user', 'Maker', 'Austin', 'TX', true,
      true, true, false, true, true, true, 500, 'Returns', 'Shipping',
      'Custom', 'Tagline', 'https://example.test/avatar.jpg', 'GUILD_MEMBER',
      true, 12, true, 'https://example.test/owner.jpg'
    );
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "reservedForUserId", "archivedAt"
    ) VALUES
      ('public-active', 'seller', 'ACTIVE', false, NULL, NULL),
      ('public-sold-out', 'seller', 'SOLD_OUT', false, NULL, NULL),
      ('owner-hidden', 'seller', 'HIDDEN', false, NULL, NULL),
      ('buyer-private', 'seller', 'ACTIVE', true, 'buyer-user', NULL),
      ('buyer-sold', 'seller', 'SOLD', true, 'buyer-user', NULL),
      ('other-private', 'seller', 'ACTIVE', true, 'other-user', NULL),
      ('archived', 'seller', 'HIDDEN', true, 'buyer-user', '2026-10-22');
  `);
  await database.exec(migration);
  return database;
}

async function actorRead(database, listingId, actorId = null) {
  if (actorId) {
    await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  } else {
    await database.exec("SELECT set_config('app.user_id', '', false)");
  }
  await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return (await database.query(
      "SELECT * FROM public.grainline_seller_actor_listing_detail_profile($1)",
      [listingId],
    )).rows;
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION");
  }
}

test("actor listing-detail authority preserves public, owner, and reserved-buyer visibility", async () => {
  const database = await readyDatabase();
  try {
    const publicRows = await actorRead(database, "public-active");
    assert.equal(publicRows.length, 1);
    assert.deepEqual(publicRows[0], {
      listingId: "public-active",
      sellerProfileId: "seller",
      sellerUserId: "seller-user",
      displayName: "Maker",
      city: "Austin",
      state: "TX",
      allowLocalPickup: true,
      chargesEnabled: true,
      stripeAccountSupported: true,
      vacationMode: false,
      acceptingNewOrders: true,
      acceptsCustomOrders: true,
      offersGiftWrapping: true,
      giftWrappingPriceCents: 500,
      returnPolicy: "Returns",
      shippingPolicy: "Shipping",
      customOrderPolicy: "Custom",
      tagline: "Tagline",
      avatarImageUrl: "https://example.test/avatar.jpg",
      guildLevel: "GUILD_MEMBER",
      isFoundingMaker: true,
      foundingMakerNumber: 12,
      ownerAccountActive: true,
      ownerImageUrl: "https://example.test/owner.jpg",
    });
    assert.equal((await actorRead(database, "public-sold-out")).length, 1);
    assert.deepEqual(await actorRead(database, "owner-hidden"), []);
    assert.equal((await actorRead(database, "owner-hidden", "seller-user")).length, 1);
    assert.equal((await actorRead(database, "buyer-private", "buyer-user")).length, 1);
    assert.equal((await actorRead(database, "buyer-sold", "buyer-user")).length, 1);
    assert.deepEqual(await actorRead(database, "other-private", "buyer-user"), []);
    assert.deepEqual(await actorRead(database, "archived", "seller-user"), []);
  } finally {
    await database.close();
  }
});

test("actor listing-detail authority enforces reciprocal blocks and active viewer context", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(`
      INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block', 'seller-user', 'buyer-user');
    `);
    assert.deepEqual(await actorRead(database, "public-active", "buyer-user"), []);
    await assert.rejects(
      actorRead(database, "public-active", "banned-user"),
      /viewer context is invalid/u,
    );
    await database.exec("SET SESSION AUTHORIZATION grainline_untrusted");
    try {
      await assert.rejects(
        database.query(
          "SELECT * FROM public.grainline_seller_actor_listing_detail_profile('public-active')",
        ),
        /permission denied/u,
      );
    } finally {
      await database.exec("RESET SESSION AUTHORIZATION");
    }
  } finally {
    await database.close();
  }
});

test("staff listing-detail authority requires the isolated staff session and active staff actor", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    try {
      assert.equal((await database.query(`
        SELECT *
          FROM public.grainline_seller_staff_listing_detail_profile(
            'staff-user',
            'owner-hidden'
          )
      `)).rows.length, 1);
      assert.deepEqual((await database.query(`
        SELECT *
          FROM public.grainline_seller_staff_listing_detail_profile(
            'staff-user',
            'archived'
          )
      `)).rows, []);
      await assert.rejects(
        database.query(`
          SELECT *
            FROM public.grainline_seller_staff_listing_detail_profile(
              'buyer-user',
              'owner-hidden'
            )
        `),
        /actor is not authorized/u,
      );
    } finally {
      await database.exec("RESET SESSION AUTHORIZATION");
    }
    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    try {
      await assert.rejects(
        database.query(`
          SELECT *
            FROM public.grainline_seller_staff_listing_detail_profile(
              'staff-user',
              'owner-hidden'
            )
        `),
        /permission denied/u,
      );
    } finally {
      await database.exec("RESET SESSION AUTHORIZATION");
    }
  } finally {
    await database.close();
  }
});

test("listing page reads SellerProfile through the bounded detail authorities", () => {
  const page = readFileSync("src/app/listing/[id]/page.tsx", "utf8");
  const loader = page.slice(
    page.indexOf("const getListingForDetailPage"),
    page.indexOf("const getListingSellerForDetailPage"),
  );
  const access = readFileSync("src/lib/sellerProfileListingDetailAccess.ts", "utf8");

  assert.doesNotMatch(loader, /seller:\s*\{/u);
  assert.match(page, /sellerListingDetailProfile\(viewerUserId, listingId\)/u);
  assert.match(page, /sellerStaffListingDetailProfile\([\s\S]*getOrderStaffReadClient\(\)/u);
  assert.match(page, /staffPreview[\s\S]*verifyAdminPinCookieValue[\s\S]*sellerStaffListingDetailProfile/u);
  assert.match(access, /grainline_seller_actor_listing_detail_profile/u);
  assert.match(access, /grainline_seller_staff_listing_detail_profile/u);
});
