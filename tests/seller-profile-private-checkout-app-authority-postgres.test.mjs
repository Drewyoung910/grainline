import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014140000_prepare_seller_profile_private_checkout_app_authority/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "ownerAccountActive" boolean NOT NULL DEFAULT true,
      "chargesEnabled" boolean NOT NULL DEFAULT true,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "stripeAccountId" text,
      "stripeAccountVersion" text,
      "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" text UNIQUE,
      "stripeAccountVersion" text,
      "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL DEFAULT 'ACTIVE',
      "archivedAt" timestamp(3) without time zone,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text,
      "listingType" text NOT NULL DEFAULT 'MADE_TO_ORDER',
      "stockQuantity" integer
    );
    CREATE TABLE public."Cart" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id)
    );
    CREATE TABLE public."CartItem" (
      id text PRIMARY KEY,
      "cartId" text NOT NULL REFERENCES public."Cart"(id),
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      quantity integer NOT NULL DEFAULT 1
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );

    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('buyer', false, NULL),
      ('other_buyer', false, NULL),
      ('seller_user', false, NULL),
      ('other_seller_user', false, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "stripeAccountId", "stripeAccountVersion",
      "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm",
      "defaultPkgHeightCm"
    ) VALUES
      ('seller', 'seller_user', 'acct_poisoned', 'v1', 9999, 99, 99, 99),
      ('other_seller', 'other_seller_user', NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "stripeAccountVersion",
      "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm",
      "defaultPkgHeightCm"
    ) VALUES
      ('seller', 'acct_private', 'v2', 450, 20, 15, 10),
      ('other_seller', 'acct_other', 'v2', 300, 10, 10, 10);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "archivedAt", "isPrivate", "reservedForUserId",
      "listingType", "stockQuantity"
    ) VALUES
      ('public_listing', 'seller', 'ACTIVE', NULL, false, NULL, 'IN_STOCK', 5),
      ('private_listing', 'seller', 'ACTIVE', NULL, true, 'buyer', 'MADE_TO_ORDER', NULL),
      ('foreign_private', 'seller', 'ACTIVE', NULL, true, 'other_buyer', 'MADE_TO_ORDER', NULL),
      ('other_listing', 'other_seller', 'ACTIVE', NULL, false, NULL, 'MADE_TO_ORDER', NULL);
    INSERT INTO public."Cart" (id, "userId") VALUES
      ('buyer_cart', 'buyer'),
      ('other_cart', 'other_buyer');
    INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity) VALUES
      ('buyer_item', 'buyer_cart', 'public_listing', 2),
      ('other_item', 'other_cart', 'public_listing', 1);
    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

function checkoutState(database, {
  buyer = "buyer",
  seller = "seller",
  cart = null,
  listing = null,
} = {}) {
  const literal = (value) => value === null ? "NULL" : `'${value}'`;
  return database.query(`
    SELECT * FROM public.grainline_seller_checkout_private_state(
      '${buyer}', '${seller}', ${literal(cart)}, ${literal(listing)}
    )
  `);
}

test("checkout operation uses only private provider/package state for eligible contexts", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const expected = {
      id: "seller",
      stripeAccountId: "acct_private",
      stripeAccountVersion: "v2",
      defaultPkgWeightGrams: 450,
      defaultPkgLengthCm: 20,
      defaultPkgWidthCm: 15,
      defaultPkgHeightCm: 10,
    };
    assert.deepEqual((await checkoutState(database, { listing: "public_listing" })).rows, [expected]);
    assert.deepEqual((await checkoutState(database, { listing: "private_listing" })).rows, [expected]);
    assert.deepEqual((await checkoutState(database, { cart: "buyer_cart" })).rows, [expected]);

    for (const input of [
      { buyer: "other_buyer", listing: "private_listing" },
      { listing: "foreign_private" },
      { listing: "other_listing" },
      { buyer: "seller_user", listing: "public_listing" },
      { cart: "other_cart" },
    ]) {
      assert.deepEqual((await checkoutState(database, input)).rows, []);
    }

    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );
  } finally {
    await database.close();
  }
});

test("checkout operation rejects invalid contexts, blocks, invalid cart items, and untrusted callers", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(checkoutState(database), /checkout private-state input is invalid/);
    await assert.rejects(
      checkoutState(database, { cart: "buyer_cart", listing: "public_listing" }),
      /checkout private-state input is invalid/,
    );

    await database.exec("RESET ROLE");
    await database.exec(`INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block', 'buyer', 'seller_user')`);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await checkoutState(database, { listing: "public_listing" })).rows, []);

    await database.exec("RESET ROLE");
    await database.exec(`
      DELETE FROM public."Block";
      INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity)
      VALUES ('invalid_item', 'buyer_cart', 'foreign_private', 1)
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await checkoutState(database, { cart: "buyer_cart" })).rows, []);

    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      checkoutState(database, { listing: "public_listing" }),
      /permission denied for function/,
    );
  } finally {
    await database.close();
  }
});
