import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015080000_restore_seller_profile_private_invariants",
  ),
  "utf8",
);

test("SellerProfile private invariants reject bad phones and keep the public support snapshot canonical", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;

      CREATE TABLE public._prisma_migrations (
        migration_name text PRIMARY KEY,
        checksum text NOT NULL,
        finished_at timestamp with time zone,
        rolled_back_at timestamp with time zone,
        applied_steps_count integer NOT NULL
      );
      INSERT INTO public._prisma_migrations (
        migration_name, checksum, finished_at, rolled_back_at,
        applied_steps_count
      ) VALUES
        (
          '20261015010000_retire_seller_profile_private_predecessor',
          'd111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a',
          CURRENT_TIMESTAMP, NULL, 1
        ),
        (
          '20261015013000_repair_account_deletion_after_seller_profile_retirement',
          'c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368',
          CURRENT_TIMESTAMP, NULL, 1
        );

      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "stripeAccountSupported" boolean NOT NULL DEFAULT true,
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE public."SellerProfilePrivate" (
        "sellerProfileId" text PRIMARY KEY
          REFERENCES public."SellerProfile"(id) ON DELETE CASCADE,
        "stripeAccountVersion" varchar(20),
        "shipFromPhone" varchar(30),
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE FUNCTION public.grainline_seller_profile_private_initialize()
      RETURNS trigger
      LANGUAGE plpgsql
      VOLATILE
      PARALLEL UNSAFE
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$
      BEGIN
        INSERT INTO public."SellerProfilePrivate" (
          "sellerProfileId", "updatedAt"
        ) VALUES (
          NEW.id, pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        );
        RETURN NEW;
      END
      $function$;
      CREATE TRIGGER "SellerProfile_private_initialize"
      AFTER INSERT ON public."SellerProfile"
      FOR EACH ROW
      EXECUTE FUNCTION public.grainline_seller_profile_private_initialize();

      INSERT INTO public."SellerProfile" (id) VALUES ('seller-v2');
      UPDATE public."SellerProfilePrivate"
         SET "stripeAccountVersion" = 'v2',
             "shipFromPhone" = '+15125550123'
       WHERE "sellerProfileId" = 'seller-v2';
    `);

    await database.exec(migration);

    await database.exec(`
      UPDATE public."SellerProfile"
         SET "stripeAccountSupported" = false
       WHERE id = 'seller-v2'
    `);
    assert.deepEqual((await database.query(`
      SELECT "stripeAccountSupported"
        FROM public."SellerProfile"
       WHERE id = 'seller-v2'
    `)).rows, [{ stripeAccountSupported: true }]);

    await database.exec(`
      UPDATE public."SellerProfilePrivate"
         SET "stripeAccountVersion" = 'v1'
       WHERE "sellerProfileId" = 'seller-v2'
    `);
    assert.deepEqual((await database.query(`
      SELECT "stripeAccountSupported"
        FROM public."SellerProfile"
       WHERE id = 'seller-v2'
    `)).rows, [{ stripeAccountSupported: false }]);

    await database.exec(`
      UPDATE public."SellerProfile"
         SET "stripeAccountSupported" = true
       WHERE id = 'seller-v2'
    `);
    assert.deepEqual((await database.query(`
      SELECT "stripeAccountSupported"
        FROM public."SellerProfile"
       WHERE id = 'seller-v2'
    `)).rows, [{ stripeAccountSupported: false }]);

    await database.exec(`
      UPDATE public."SellerProfilePrivate"
         SET "stripeAccountVersion" = NULL
       WHERE "sellerProfileId" = 'seller-v2';
      INSERT INTO public."SellerProfile" (id) VALUES ('seller-new');
    `);
    assert.deepEqual((await database.query(`
      SELECT seller.id, seller."stripeAccountSupported",
             seller_private."stripeAccountVersion"
        FROM public."SellerProfile" AS seller
        JOIN public."SellerProfilePrivate" AS seller_private
          ON seller_private."sellerProfileId" = seller.id
       ORDER BY seller.id
    `)).rows, [
      {
        id: "seller-new",
        stripeAccountSupported: true,
        stripeAccountVersion: null,
      },
      {
        id: "seller-v2",
        stripeAccountSupported: true,
        stripeAccountVersion: null,
      },
    ]);

    await assert.rejects(
      database.exec(`
        UPDATE public."SellerProfilePrivate"
           SET "shipFromPhone" = '512-555-0123'
         WHERE "sellerProfileId" = 'seller-v2'
      `),
      /SellerProfilePrivate_shipFromPhone_e164_check/u,
    );
    await database.exec(`
      UPDATE public."SellerProfilePrivate"
         SET "shipFromPhone" = '+442079460123'
       WHERE "sellerProfileId" = 'seller-v2'
    `);

    await database.exec(`
      DELETE FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller-v2'
    `);
    await assert.rejects(
      database.exec(`
        UPDATE public."SellerProfile"
           SET "stripeAccountSupported" = false
         WHERE id = 'seller-v2'
      `),
      (error) => error.code === "40001",
    );

    const catalog = (await database.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid =
                'public."SellerProfilePrivate"'::pg_catalog.regclass
            AND constraint_row.conname =
                'SellerProfilePrivate_shipFromPhone_e164_check'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated) AS constraint_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_trigger AS trigger_row
          WHERE trigger_row.tgname IN (
            'SellerProfile_supported_snapshot_guard',
            'SellerProfilePrivate_supported_snapshot_sync'
          )
            AND NOT trigger_row.tgisinternal
            AND trigger_row.tgenabled = 'O') AS trigger_count,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_profile_supported_snapshot_guard()',
          'EXECUTE'
        ) AS runtime_public_guard_execute,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_profile_private_supported_snapshot_sync()',
          'EXECUTE'
        ) AS runtime_private_sync_execute,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_seller_profile_supported_snapshot_guard()',
          'EXECUTE'
        ) AS public_guard_execute,
        pg_catalog.has_function_privilege(
          'public',
          'public.grainline_seller_profile_private_supported_snapshot_sync()',
          'EXECUTE'
        ) AS public_sync_execute
    `)).rows[0];
    assert.deepEqual(catalog, {
      constraint_count: 1,
      trigger_count: 2,
      runtime_public_guard_execute: false,
      runtime_private_sync_execute: false,
      public_guard_execute: false,
      public_sync_execute: false,
    });
  } finally {
    await database.close();
  }
});
