import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014120000_prepare_seller_profile_private_stripe_app_authorities/migration.sql",
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
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountId" varchar(255) UNIQUE,
      "stripeAccountVersion" varchar(20),
      "stripeControllerType" varchar(100),
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT current_timestamp
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" varchar(255) UNIQUE,
      "stripeAccountVersion" varchar(20),
      "stripeControllerType" varchar(100),
      "shipFromCountry" varchar(2) DEFAULT 'US',
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT current_timestamp
    );

    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('user_active', false, NULL),
      ('user_banned', true, NULL),
      ('user_other', false, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "stripeAccountId", "stripeAccountVersion", "stripeControllerType"
    ) VALUES
      ('seller_active', 'user_active', NULL, NULL, NULL),
      ('seller_banned', 'user_banned', NULL, NULL, NULL),
      ('seller_other', 'user_other', 'acct_existing', 'v2', 'controller');
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "stripeAccountVersion", "stripeControllerType"
    ) VALUES
      ('seller_active', NULL, NULL, NULL),
      ('seller_banned', NULL, NULL, NULL),
      ('seller_other', 'acct_existing', 'v2', 'controller');

    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("runtime Stripe operations read companion state and enforce exact binding", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");

    const initial = (await database.query(`
      SELECT * FROM public.grainline_seller_stripe_owner_state('user_active')
    `)).rows;
    assert.deepEqual(initial, [{
      id: "seller_active",
      stripeAccountId: null,
      stripeAccountVersion: null,
      chargesEnabled: false,
      shipFromCountry: "US",
    }]);
    assert.deepEqual((await database.query(`
      SELECT * FROM public.grainline_seller_stripe_owner_state('user_banned')
    `)).rows, []);

    const bound = (await database.query(`
      SELECT public.grainline_seller_stripe_account_bind(
        'user_active', 'seller_active', 'acct_test', 'v2', 'controller'
      ) AS id
    `)).rows[0];
    assert.deepEqual(bound, { id: "seller_active" });

    const repeated = (await database.query(`
      SELECT public.grainline_seller_stripe_account_bind(
        'user_active', 'seller_active', 'acct_test', 'v2', 'controller'
      ) AS id
    `)).rows[0];
    assert.deepEqual(repeated, bound);

    await assert.rejects(
      database.query(`SELECT public.grainline_seller_stripe_account_bind(
        'user_other', 'seller_active', 'acct_foreign', 'v2', 'controller'
      )`),
      /account-bind target is unavailable/,
    );
    await assert.rejects(
      database.query(`SELECT public.grainline_seller_stripe_account_bind(
        'user_active', 'seller_active', 'acct_replacement', 'v2', 'controller'
      )`),
      /already bound/,
    );

    const mirror = (await database.query(`
      SELECT * FROM public.grainline_seller_stripe_mirror_state('acct_test')
    `)).rows[0];
    assert.deepEqual(mirror, {
      id: "seller_active",
      userId: "user_active",
      ownerAccountActive: true,
      chargesEnabled: false,
      stripeAccountId: "acct_test",
    });

    assert.deepEqual((await database.query(`
      SELECT public.grainline_seller_stripe_charges_update(
        'seller_active', 'acct_test', true
      ) AS id
    `)).rows[0], { id: "seller_active" });
    await assert.rejects(
      database.query(`SELECT public.grainline_seller_stripe_charges_update(
        'seller_active', 'acct_wrong', false
      )`),
      /charges-update target changed/,
    );

    const page = (await database.query(`
      SELECT * FROM public.grainline_seller_stripe_reconciliation_page(NULL, 2)
    `)).rows;
    assert.deepEqual(page.map((row) => row.id), ["seller_active", "seller_other"]);

    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );
  } finally {
    await database.close();
  }
});

test("Stripe operations keep both representations synchronized and deny untrusted callers", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.query(`SELECT public.grainline_seller_stripe_account_bind(
      'user_active', 'seller_active', 'acct_test', 'v2', 'controller'
    )`);
    await database.exec("RESET ROLE");

    const representations = (await database.query(`
      SELECT seller."stripeAccountId" AS public_account,
             seller_private."stripeAccountId" AS private_account
        FROM public."SellerProfile" AS seller
        JOIN public."SellerProfilePrivate" AS seller_private
          ON seller_private."sellerProfileId" = seller.id
       WHERE seller.id = 'seller_active'
    `)).rows[0];
    assert.deepEqual(representations, {
      public_account: "acct_test",
      private_account: "acct_test",
    });

    await database.exec("SET ROLE grainline_untrusted");
    for (const statement of [
      "SELECT * FROM public.grainline_seller_stripe_owner_state('user_active')",
      "SELECT * FROM public.grainline_seller_stripe_mirror_state('acct_test')",
      "SELECT * FROM public.grainline_seller_stripe_reconciliation_page(NULL, 10)",
      "SELECT public.grainline_seller_stripe_account_bind('user_active', 'seller_active', 'acct_test', 'v2', 'controller')",
      "SELECT public.grainline_seller_stripe_charges_update('seller_active', 'acct_test', true)",
    ]) {
      await assert.rejects(database.query(statement), /permission denied for function/);
    }
  } finally {
    await database.close();
  }
});
