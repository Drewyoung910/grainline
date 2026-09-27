import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION_SHA256,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";

const retirementBytes = readFileSync(
  "prisma/migrations/20260926012300_retire_legacy_checkout_reservation_creators/migration.sql",
);
const retirement = retirementBytes.toString("utf8");
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

const signatures = Object.freeze({
  legacy: [
    "grainline_checkout_reservation_create_cart(text,text,text,text,text)",
    "grainline_checkout_reservation_create_single(text,text,integer,text)",
    "grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)",
    "grainline_checkout_reservation_create_single_consistent(text,text,integer,text[],text,jsonb)",
  ],
  snapshot: [
    "grainline_checkout_reservation_create_cart_snapshot(text,text,text,text,text,jsonb)",
    "grainline_checkout_reservation_create_single_snapshot(text,text,integer,text[],text,jsonb)",
  ],
});

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;

    CREATE FUNCTION public.grainline_checkout_reservation_create_cart(
      text, text, text, text, text
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$ SELECT 'legacy-cart'::text $$;
    CREATE FUNCTION public.grainline_checkout_reservation_create_single(
      text, text, integer, text
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$ SELECT 'legacy-single'::text $$;
    CREATE FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
      text, text, text, text, text, jsonb
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$ SELECT 'consistent-cart'::text $$;
    CREATE FUNCTION public.grainline_checkout_reservation_create_single_consistent(
      text, text, integer, text[], text, jsonb
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$ SELECT 'consistent-single'::text $$;
    CREATE FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
      text, text, text, text, text, jsonb
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$
        SELECT public.grainline_checkout_reservation_create_cart_consistent(
          $1, $2, $3, $4, $5, $6
        )
      $$;
    CREATE FUNCTION public.grainline_checkout_reservation_create_single_snapshot(
      text, text, integer, text[], text, jsonb
    ) RETURNS text LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog AS $$
        SELECT public.grainline_checkout_reservation_create_single_consistent(
          $1, $2, $3, $4, $5, $6
        )
      $$;

    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO grainline_app_runtime;
    REVOKE EXECUTE ON FUNCTION
      public.grainline_checkout_reservation_create_cart(text, text, text, text, text),
      public.grainline_checkout_reservation_create_single(text, text, integer, text)
    FROM grainline_app_runtime;
  `);
  return database;
}

async function executeAsRuntime(database, sql) {
  await database.exec("SET ROLE grainline_app_runtime");
  try {
    return await database.query(sql);
  } finally {
    await database.exec("RESET ROLE");
  }
}

describe("legacy checkout creator retirement", () => {
  it("pins the live-ledger authority state to the exact retirement bytes", () => {
    assert.equal(
      createHash("sha256").update(retirementBytes).digest("hex"),
      CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION_SHA256,
    );
  });

  it("keeps later runtime-role convergence from undoing the source cutover", () => {
    assert.match(
      provisioning,
      /20260926012300_retire_legacy_checkout_reservation_creators/,
    );
    assert.match(
      provisioning,
      /f66b5314f6116a2900b06c98e0a5cb0236684ab8c0c712e5d6059a758571ae61/,
    );
    assert.match(
      provisioning,
      /legacy checkout retirement ledger drifted; refusing runtime-role provisioning/,
    );
    assert.match(
      provisioning,
      /WITH checkout_reservation_service\(function_signature, legacy_creator\)[\s\S]*?NOT legacy_creator[\s\S]*?grainline_checkout_source_cutover_applied/,
    );
    assert.match(
      provisioning,
      /\\unset grainline_checkout_source_cutover_applied/,
    );
  });

  it("removes every legacy runtime entry while snapshot SECURITY DEFINER calls still compose", async () => {
    const database = await createDatabase();
    try {
      await database.exec(retirement);

      for (const signature of signatures.legacy) {
        const privilege = await database.query(`
          SELECT pg_catalog.has_function_privilege(
            'grainline_app_runtime', 'public.${signature}', 'EXECUTE'
          ) AS allowed
        `);
        assert.equal(privilege.rows[0].allowed, false, signature);
      }
      for (const signature of signatures.snapshot) {
        const privilege = await database.query(`
          SELECT pg_catalog.has_function_privilege(
            'grainline_app_runtime', 'public.${signature}', 'EXECUTE'
          ) AS allowed
        `);
        assert.equal(privilege.rows[0].allowed, true, signature);
      }

      await assert.rejects(
        executeAsRuntime(
          database,
          `
          SELECT public.grainline_checkout_reservation_create_cart_consistent(
            'buyer', 'cart', 'seller', 'group', 'hash', '{}'::jsonb
          )
        `,
        ),
        /permission denied/iu,
      );
      assert.deepEqual(
        (
          await executeAsRuntime(
            database,
            `
        SELECT public.grainline_checkout_reservation_create_cart_snapshot(
          'buyer', 'cart', 'seller', 'group', 'hash', '{}'::jsonb
        ) AS result
      `,
          )
        ).rows,
        [{ result: "consistent-cart" }],
      );
      assert.deepEqual(
        (
          await executeAsRuntime(
            database,
            `
        SELECT public.grainline_checkout_reservation_create_single_snapshot(
          'buyer', 'listing', 1, ARRAY[]::text[], 'hash', '{}'::jsonb
        ) AS result
      `,
          )
        ).rows,
        [{ result: "consistent-single" }],
      );
    } finally {
      await database.close();
    }
  });

  it("rejects catalog drift atomically before revoking any legacy entry", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
          text, text, text, text, text, jsonb
        ) TO PUBLIC
      `);
      await assert.rejects(
        database.exec(retirement),
        /Legacy checkout retirement predecessor drifted/,
      );
      await database.exec("ROLLBACK").catch(() => {});
      const privilege = await database.query(`
        SELECT pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) AS allowed
      `);
      assert.equal(privilege.rows[0].allowed, true);
    } finally {
      await database.close();
    }
  });
});
