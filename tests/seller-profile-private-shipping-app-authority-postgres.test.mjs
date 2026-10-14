import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014130000_prepare_seller_profile_private_shipping_quote_authority/migration.sql",
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
      "allowLocalPickup" boolean NOT NULL DEFAULT false,
      "shippingFlatRateCents" integer,
      "freeShippingOverCents" integer,
      "shipFromLine1" text,
      "defaultPkgWeightGrams" integer
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" text UNIQUE,
      "shipFromName" text,
      "shipFromLine1" text,
      "shipFromLine2" text,
      "shipFromCity" text,
      "shipFromState" text,
      "shipFromPostal" text,
      "shipFromCountry" text,
      "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision,
      "preferredCarriers" text[] NOT NULL DEFAULT '{}',
      "useCalculatedShipping" boolean NOT NULL DEFAULT false
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
      ('banned_buyer', true, NULL),
      ('seller_user', false, NULL),
      ('other_seller_user', false, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "allowLocalPickup", "shippingFlatRateCents",
      "freeShippingOverCents", "shipFromLine1", "defaultPkgWeightGrams"
    ) VALUES
      ('seller', 'seller_user', true, 900, 5000, 'POISONED PUBLIC ADDRESS', 9999),
      ('other_seller', 'other_seller_user', false, NULL, NULL, NULL, NULL);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "shipFromName", "shipFromLine1",
      "shipFromCity", "shipFromState", "shipFromPostal", "shipFromCountry",
      "defaultPkgWeightGrams", "defaultPkgLengthCm", "defaultPkgWidthCm",
      "defaultPkgHeightCm", "preferredCarriers", "useCalculatedShipping"
    ) VALUES
      ('seller', 'acct_seller', 'Private Maker', '123 Private Lane',
       'Austin', 'TX', '78701', 'US', 450, 20, 15, 10,
       ARRAY['UPS', 'USPS'], true),
      ('other_seller', 'acct_other', 'Other Maker', '456 Other Lane',
       'Dallas', 'TX', '75201', 'US', 300, 10, 10, 10,
       ARRAY[]::text[], true);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "archivedAt", "isPrivate", "reservedForUserId",
      "listingType", "stockQuantity"
    ) VALUES
      ('public_listing', 'seller', 'ACTIVE', NULL, false, NULL, 'IN_STOCK', 5),
      ('private_listing', 'seller', 'ACTIVE', NULL, true, 'buyer', 'MADE_TO_ORDER', NULL),
      ('foreign_private', 'seller', 'ACTIVE', NULL, true, 'other_buyer', 'MADE_TO_ORDER', NULL),
      ('archived_listing', 'seller', 'ACTIVE', current_timestamp, false, NULL, 'MADE_TO_ORDER', NULL),
      ('other_listing', 'other_seller', 'ACTIVE', NULL, false, NULL, 'MADE_TO_ORDER', NULL);
    INSERT INTO public."Cart" (id, "userId") VALUES
      ('buyer_cart', 'buyer'),
      ('other_cart', 'other_buyer');
    INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity) VALUES
      ('eligible_item', 'buyer_cart', 'public_listing', 2),
      ('other_item', 'other_cart', 'public_listing', 1);

    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

function quoteState(database, {
  buyer = "buyer",
  seller = "seller",
  cart = null,
  listing = null,
} = {}) {
  const literal = (value) => value === null ? "NULL" : `'${value}'`;
  return database.query(`
    SELECT * FROM public.grainline_seller_shipping_quote_state(
      '${buyer}', '${seller}', ${literal(cart)}, ${literal(listing)}
    )
  `);
}

test("shipping quote operation binds private state to exact eligible purchase context", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");

    const single = (await quoteState(database, { listing: "public_listing" })).rows;
    assert.equal(single.length, 1);
    assert.deepEqual(single[0], {
      shipFromName: "Private Maker",
      shipFromLine1: "123 Private Lane",
      shipFromLine2: null,
      shipFromCity: "Austin",
      shipFromState: "TX",
      shipFromPostal: "78701",
      shipFromCountry: "US",
      defaultPkgWeightGrams: 450,
      defaultPkgLengthCm: 20,
      defaultPkgWidthCm: 15,
      defaultPkgHeightCm: 10,
      allowLocalPickup: true,
      preferredCarriers: ["UPS", "USPS"],
      useCalculatedShipping: true,
      shippingFlatRateCents: 900,
      freeShippingOverCents: 5000,
    });
    assert.equal(single[0].shipFromLine1.includes("POISONED"), false);

    assert.equal((await quoteState(database, { listing: "private_listing" })).rows.length, 1);
    assert.equal((await quoteState(database, { cart: "buyer_cart" })).rows.length, 1);

    for (const input of [
      { buyer: "other_buyer", listing: "private_listing" },
      { listing: "foreign_private" },
      { listing: "archived_listing" },
      { listing: "other_listing" },
      { buyer: "banned_buyer", listing: "public_listing" },
      { buyer: "seller_user", listing: "public_listing" },
      { cart: "other_cart" },
    ]) {
      assert.deepEqual((await quoteState(database, input)).rows, []);
    }

    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );
  } finally {
    await database.close();
  }
});

test("shipping quote operation fails closed for invalid carts, blocks, and caller roles", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      quoteState(database),
      /shipping quote-state input is invalid/,
    );
    await assert.rejects(
      quoteState(database, { cart: "buyer_cart", listing: "public_listing" }),
      /shipping quote-state input is invalid/,
    );

    await database.exec("RESET ROLE");
    await database.exec(`
      INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block', 'seller_user', 'buyer')
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await quoteState(database, { listing: "public_listing" })).rows, []);

    await database.exec("RESET ROLE");
    await database.exec(`
      DELETE FROM public."Block";
      INSERT INTO public."CartItem" (id, "cartId", "listingId", quantity)
      VALUES ('invalid_item', 'buyer_cart', 'foreign_private', 1)
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await quoteState(database, { cart: "buyer_cart" })).rows, []);

    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      quoteState(database, { listing: "public_listing" }),
      /permission denied for function/,
    );
  } finally {
    await database.close();
  }
});
