import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260901150000_prepare_order_charged_total/migration.sql",
  "utf8",
);

describe("Order charged-total compatibility in PostgreSQL", () => {
  it("preserves legacy uncertainty and the predecessor security posture", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
        CREATE TABLE public."Order" (
          id text PRIMARY KEY
        );
        GRANT SELECT ON TABLE public."Order" TO grainline_app_runtime;
        INSERT INTO public."Order" (id) VALUES ('legacy-order');
      `);

      const before = await database.query(`
        SELECT
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced,
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."Order"', 'SELECT'
          ) AS runtime_select,
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."Order"', 'INSERT'
          ) AS runtime_insert
        FROM pg_catalog.pg_class AS c
        WHERE c.oid = 'public."Order"'::pg_catalog.regclass
      `);

      await database.exec(migration);

      const legacy = await database.query(`
        SELECT "chargedTotalCents" AS charged_total_cents
        FROM public."Order"
        WHERE id = 'legacy-order'
      `);
      assert.deepEqual(legacy.rows, [{ charged_total_cents: null }]);

      await database.exec(`
        INSERT INTO public."Order" (id, "chargedTotalCents") VALUES
          ('free-order', 0),
          ('paid-order', 2147483647)
      `);
      await assert.rejects(
        database.exec(`
          INSERT INTO public."Order" (id, "chargedTotalCents")
          VALUES ('invalid-order', -1)
        `),
        /Order_chargedTotalCents_non_negative_chk/i,
      );

      const accepted = await database.query(`
        SELECT id, "chargedTotalCents" AS charged_total_cents
        FROM public."Order"
        WHERE id IN ('free-order', 'paid-order')
        ORDER BY id
      `);
      assert.deepEqual(accepted.rows, [
        { id: "free-order", charged_total_cents: 0 },
        { id: "paid-order", charged_total_cents: 2147483647 },
      ]);

      const after = await database.query(`
        SELECT
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced,
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."Order"', 'SELECT'
          ) AS runtime_select,
          pg_catalog.has_table_privilege(
            'grainline_app_runtime', 'public."Order"', 'INSERT'
          ) AS runtime_insert
        FROM pg_catalog.pg_class AS c
        WHERE c.oid = 'public."Order"'::pg_catalog.regclass
      `);
      assert.deepEqual(after.rows, before.rows);
    } finally {
      await database.close();
    }
  });
});
