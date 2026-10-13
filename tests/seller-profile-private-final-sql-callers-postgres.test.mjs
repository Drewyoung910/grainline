import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013200000_move_final_seller_private_sql_callers",
  ),
  "utf8",
);

test("final seller-private SQL callers apply atomically and preserve entrypoint grants", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TYPE public."NotificationType" AS ENUM ('NEW_MESSAGE');
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "stripeAccountSupported" boolean NOT NULL DEFAULT true
      );
      CREATE TABLE public."SellerProfilePrivate" (
        "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
        "stripeAccountId" text,
        "stripeAccountVersion" text,
        "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
        "metricWarningSentAt" timestamp(3) without time zone
      );

      CREATE FUNCTION public.grainline_notification_create_core(
        text, text, public."NotificationType", text, text, text
      ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$ SELECT NULL::text $$;
      REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
        text, text, public."NotificationType", text, text, text
      ) FROM PUBLIC, grainline_app_runtime;

      CREATE FUNCTION public.grainline_stripe_checkout_order_create(
        text, bigint, text, text, timestamp without time zone, jsonb
      ) RETURNS TABLE(
        outcome text,
        order_id text,
        invalid_reason text,
        invalid_seller_user_ids text[],
        listing_visibility_changed boolean
      ) LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$
        SELECT NULL::text, NULL::text, NULL::text, ARRAY[]::text[], false
      $$;
      REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_create(
        text, bigint, text, text, timestamp without time zone, jsonb
      ) FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_create(
        text, bigint, text, text, timestamp without time zone, jsonb
      ) TO grainline_app_runtime;

      SET check_function_bodies = off;
    `);
    await database.exec(migration);

    const functions = (await database.query(`
      SELECT
        routine.proname AS name,
        routine.prosrc AS source,
        routine.prosecdef AS security_definer,
        routine.provolatile AS volatility,
        routine.proparallel AS parallel_mode,
        routine.proconfig AS config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', routine.oid, 'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'public', routine.oid, 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.proname IN (
          'grainline_notification_create_core',
          'grainline_stripe_checkout_order_create'
        )
      ORDER BY routine.proname
    `)).rows;
    assert.equal(functions.length, 2);
    assert.ok(functions.every((row) => row.security_definer === true));
    assert.ok(functions.every((row) => row.volatility === "v"));
    assert.ok(functions.every((row) => row.parallel_mode === "u"));
    assert.ok(functions.every(
      (row) => JSON.stringify(row.config) === JSON.stringify(["search_path=pg_catalog"]),
    ));
    assert.deepEqual(
      functions.map(({ name, runtime_execute, public_execute }) => ({
        name,
        runtime_execute,
        public_execute,
      })),
      [
        {
          name: "grainline_notification_create_core",
          runtime_execute: false,
          public_execute: false,
        },
        {
          name: "grainline_stripe_checkout_order_create",
          runtime_execute: true,
          public_execute: false,
        },
      ],
    );

    const notification = functions.find(
      (row) => row.name === "grainline_notification_create_core",
    ).source;
    assert.match(notification, /source_seller_private\."consecutiveMetricFailures"/u);
    assert.match(notification, /source_seller\."stripeAccountSupported" = true/u);
    assert.doesNotMatch(notification, /source_seller\."stripeAccountVersion"/u);

    const checkout = functions.find(
      (row) => row.name === "grainline_stripe_checkout_order_create",
    ).source;
    assert.match(checkout, /seller_private\."stripeAccountId"/u);
    assert.match(checkout, /seller_private\."stripeAccountVersion"/u);
    assert.doesNotMatch(checkout, /\bseller\."stripeAccountId"/u);
  } finally {
    await database.close();
  }
});
