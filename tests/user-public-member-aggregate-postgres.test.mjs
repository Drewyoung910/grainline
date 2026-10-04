import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004040000_prepare_user_public_member_aggregate/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-1', false, NULL),
      ('active-2', false, NULL),
      ('banned', true, NULL),
      ('deleted', false, '2026-10-01');
  `);
  await database.exec(migration);
  return database;
}

describe("User public active-member aggregate PostgreSQL proof", () => {
  it("counts only non-banned, non-deleted accounts", async () => {
    const database = await createDatabase();
    try {
      const result = await database.query(`
        SELECT public.grainline_user_public_active_member_count() AS value
      `);
      assert.equal(Number(result.rows[0].value), 2);
    } finally {
      await database.close();
    }
  });

  it("grants only restricted runtime execution", async () => {
    const database = await createDatabase();
    try {
      const privileges = await database.query(`
        SELECT
          pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            'grainline_user_public_active_member_count()',
            'EXECUTE'
          ) AS runtime_execute,
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc AS procedure
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner)
                )
              ) AS acl
             WHERE procedure.oid = pg_catalog.to_regprocedure(
               'grainline_user_public_active_member_count()'
             )
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
          ) AS public_execute
      `);
      assert.equal(privileges.rows[0].runtime_execute, true);
      assert.equal(privileges.rows[0].public_execute, false);
    } finally {
      await database.close();
    }
  });
});
