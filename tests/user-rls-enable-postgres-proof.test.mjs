import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261008010000_enable_user_rls/migration.sql",
  "utf8",
);

async function fixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE grainline_staff_read_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public._prisma_migrations (
      migration_name text NOT NULL,
      checksum text NOT NULL,
      finished_at timestamp,
      rolled_back_at timestamp,
      applied_steps_count integer NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."User"
      TO grainline_app_runtime;
    INSERT INTO public."User" (id) VALUES ('owner'), ('other');
  `);
  return database;
}

test("the actual preflight compiles and fails closed before mutation on ledger drift", async () => {
  const database = await fixture();
  try {
    const identity = (
      await database.query(`
        SELECT current_user AS "currentUser",
               current_database() AS "databaseName"
      `)
    ).rows[0];
    const disposable = migration
      .replace(
        "current_user = 'ci'",
        `current_user = '${identity.currentUser.replaceAll("'", "''")}'`,
      )
      .replace(
        "pg_catalog.current_database() = 'grainline_ci'",
        `pg_catalog.current_database() = '${identity.databaseName.replaceAll("'", "''")}'`,
      );
    await assert.rejects(
      database.exec(disposable),
      /User ENABLE migration ledger drifted/u,
    );
    await database.exec("ROLLBACK").catch(() => {});
    const posture = (
      await database.query(`
        SELECT class.relrowsecurity AS "rlsEnabled",
               class.relforcerowsecurity AS "rlsForced",
               pg_catalog.has_table_privilege(
                 'grainline_app_runtime', class.oid,
                 'SELECT,INSERT,UPDATE,DELETE'
               ) AS "runtimeCrud"
          FROM pg_catalog.pg_class AS class
         WHERE class.oid = 'public."User"'::pg_catalog.regclass
      `)
    ).rows[0];
    assert.deepEqual(posture, {
      rlsEnabled: false,
      rlsForced: false,
      runtimeCrud: true,
    });
  } finally {
    await database.close();
  }
});

test("the reviewed mutation reaches policyless zero-direct ENABLE", async () => {
  const database = await fixture();
  try {
    const mutation = migration.match(
      /REVOKE ALL PRIVILEGES ON TABLE public\."User"[\s\S]*?ALTER TABLE public\."User" NO FORCE ROW LEVEL SECURITY;/u,
    )?.[0];
    assert.ok(mutation);
    await database.exec(mutation);
    const posture = (
      await database.query(`
        SELECT class.relrowsecurity AS "rlsEnabled",
               class.relforcerowsecurity AS "rlsForced",
               (SELECT count(*)::integer
                  FROM pg_catalog.pg_policy AS policy
                 WHERE policy.polrelid = class.oid) AS "policyCount",
               pg_catalog.has_table_privilege(
                 'grainline_app_runtime', class.oid,
                 'SELECT,INSERT,UPDATE,DELETE'
               ) AS "runtimeCrud",
               pg_catalog.has_table_privilege(
                 'grainline_staff_read_runtime', class.oid,
                 'SELECT,INSERT,UPDATE,DELETE'
               ) AS "staffCrud"
          FROM pg_catalog.pg_class AS class
         WHERE class.oid = 'public."User"'::pg_catalog.regclass
      `)
    ).rows[0];
    assert.deepEqual(posture, {
      rlsEnabled: true,
      rlsForced: false,
      policyCount: 0,
      runtimeCrud: false,
      staffCrud: false,
    });
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query('SELECT id FROM public."User"'),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
