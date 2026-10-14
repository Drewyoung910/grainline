import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014230000_prepare_seller_profile_private_remaining_app_authorities"),
  "utf8",
);

async function asRole(database, role, operation) {
  await database.exec(`SET ROLE ${role}`);
  try {
    return await operation();
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
  }
}

async function asSessionRole(database, role, operation) {
  await database.exec(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await operation();
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
  }
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');
    CREATE TABLE public."User" (
      id text PRIMARY KEY, role text NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT false,
      "ownerAccountActive" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "guildLevel" public."GuildLevel" NOT NULL DEFAULT 'NONE',
      "profileViews" integer NOT NULL DEFAULT 0,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "guildMasterAppliedAt" timestamp(3) without time zone,
      "guildMasterReviewNotes" text,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" text,
      "profileViews" integer NOT NULL DEFAULT 0,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "guildMasterAppliedAt" timestamp(3) without time zone,
      "guildMasterReviewNotes" text,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfileViewDaily" (
      id text PRIMARY KEY, "sellerProfileId" text NOT NULL,
      date timestamp(3) without time zone NOT NULL, views integer NOT NULL DEFAULT 0,
      UNIQUE ("sellerProfileId", date)
    );
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY, "userId" text NOT NULL, kind text NOT NULL,
      status text NOT NULL, payload jsonb NOT NULL,
      "claimGeneration" bigint NOT NULL, "claimToken" uuid
    );
    INSERT INTO public."User" (id, role) VALUES
      ('owner', 'USER'), ('staff', 'EMPLOYEE'), ('outsider', 'USER');
    INSERT INTO public."SellerProfile" (
      id, "userId", "chargesEnabled", "stripeAccountSupported",
      "guildLevel", "manualStripeReconciliationNeeded",
      "manualStripeReconciliationNote"
    ) VALUES (
      'seller', 'owner', true, true, 'GUILD_MEMBER', true,
      'Account deletion could not reject Stripe Connect account acct_private'
    );
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "manualStripeReconciliationNeeded",
      "manualStripeReconciliationNote"
    ) VALUES (
      'seller', 'acct_private', true,
      'Account deletion could not reject Stripe Connect account acct_private'
    );
    INSERT INTO public."AccountDeletionSideEffect" VALUES (
      'effect', 'owner', 'STRIPE_REJECT', 'PROCESSING',
      '{"stripeAccountId":"acct_private"}', 2,
      '11111111-1111-4111-8111-111111111111'
    );
    REVOKE ALL ON TABLE public."SellerProfilePrivate"
      FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
    GRANT SELECT ON TABLE public."User", public."SellerProfile",
      public."SellerProfileViewDaily", public."AccountDeletionSideEffect"
      TO grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("remaining runtime operations synchronize private state and reject forged sources", async () => {
  const database = await createDatabase();
  try {
    await asRole(database, "grainline_app_runtime", async () => {
      const viewed = await database.query(`
        SELECT public.grainline_seller_profile_view_record(
          'seller', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
        ) AS viewed
      `);
      assert.equal(viewed.rows[0].viewed, true);
      const applied = await database.query(`
        SELECT public.grainline_seller_owner_guild_master_application_record(
          'owner', 'seller', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        ) AS applied
      `);
      assert.equal(applied.rows[0].applied, true);
      await assert.rejects(
        database.query(`
          SELECT public.grainline_seller_account_deletion_reconciliation_clear(
            'owner', 'acct_private', 'effect', 1,
            '11111111-1111-4111-8111-111111111111'
          )
        `),
        /source is not authorized/,
      );
      const cleared = await database.query(`
        SELECT public.grainline_seller_account_deletion_reconciliation_clear(
          'owner', 'acct_private', 'effect', 2,
          '11111111-1111-4111-8111-111111111111'
        ) AS cleared
      `);
      assert.equal(cleared.rows[0].cleared, true);
    });

    const state = await database.query(`
      SELECT seller."profileViews" AS public_views,
             private."profileViews" AS private_views,
             seller."manualStripeReconciliationNeeded" AS public_needed,
             private."manualStripeReconciliationNeeded" AS private_needed,
             seller."guildMasterAppliedAt" IS NOT NULL AS public_applied,
             private."guildMasterAppliedAt" IS NOT NULL AS private_applied,
             daily.views
        FROM public."SellerProfile" seller
        JOIN public."SellerProfilePrivate" private
          ON private."sellerProfileId" = seller.id
        JOIN public."SellerProfileViewDaily" daily
          ON daily."sellerProfileId" = seller.id
    `);
    assert.deepEqual(state.rows, [{
      public_views: 1,
      private_views: 1,
      public_needed: false,
      private_needed: false,
      public_applied: true,
      private_applied: true,
      views: 1,
    }]);
    await asRole(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`SELECT * FROM public."SellerProfilePrivate"`),
        /permission denied/,
      );
    });
  } finally {
    await database.close();
  }
});

test("staff orderability projection is isolated and actor checked", async () => {
  let database = await createDatabase();
  try {
    await asSessionRole(database, "grainline_staff_read_runtime", async () => {
      const result = await database.query(`
        SELECT * FROM public.grainline_seller_staff_orderability_state('staff', 'owner')
      `);
      assert.deepEqual(result.rows, [{
        id: "seller",
        chargesEnabled: true,
        vacationMode: false,
        stripeAccountId: "acct_private",
      }]);
    });
  } finally {
    await database.close();
  }

  database = await createDatabase();
  try {
    await asSessionRole(database, "grainline_staff_read_runtime", async () => {
      await assert.rejects(database.query(`
        SELECT * FROM public.grainline_seller_staff_orderability_state('outsider', 'owner')
      `), /actor is not authorized/);
    });
  } finally {
    await database.close();
  }

  database = await createDatabase();
  try {
    await asRole(database, "grainline_app_runtime", async () => {
      await assert.rejects(
        database.query(`
          SELECT * FROM public.grainline_seller_staff_orderability_state('staff', 'owner')
        `),
        /permission denied/,
      );
    });
  } finally {
    await database.close();
  }

  database = await createDatabase();
  try {
    await asRole(database, "grainline_untrusted", async () => {
      await assert.rejects(
        database.query(`
          SELECT public.grainline_seller_profile_view_record(
            'seller', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
          )
        `),
        /permission denied/,
      );
    });
  } finally {
    await database.close();
  }
});
