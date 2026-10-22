import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const force = readFileSync(
  "prisma/migrations/20261020250000_force_seller_profile_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-force-rollback.sql",
  "utf8",
);

async function enabledDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE TABLE public._prisma_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      finished_at timestamptz,
      migration_name text NOT NULL,
      logs text,
      rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      applied_steps_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."SellerProfile" (id text PRIMARY KEY);
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY
    );
    ALTER TABLE public."SellerProfile" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."SellerProfilePrivate" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."SellerProfilePrivate" FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public."SellerProfile", public."SellerProfilePrivate"
      FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, started_at,
      applied_steps_count
    ) VALUES (
      'enable',
      'f5b4676735d005748b597220584ceecfb8af5539aa72a95a83ac56cd4151e9b5',
      pg_catalog.clock_timestamp(),
      '20261020240000_enable_seller_profile_rls',
      pg_catalog.clock_timestamp(), 1
    );
  `);
  return database;
}

async function posture(database) {
  return (await database.query(`
    SELECT
      (SELECT relrowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_enabled,
      (SELECT relforcerowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = 'public."SellerProfile"'::pg_catalog.regclass) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."SellerProfile"',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS runtime_direct,
      pg_catalog.has_table_privilege(
        'grainline_staff_read_runtime', 'public."SellerProfile"',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS staff_direct
  `)).rows[0];
}

test("policyless SellerProfile FORCE changes only owner-bypass posture", async () => {
  const database = await enabledDatabase();
  try {
    await database.exec(force);
    assert.deepEqual(await posture(database), {
      public_enabled: true,
      public_forced: true,
      policy_count: 0,
      runtime_direct: false,
      staff_direct: false,
    });
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      () => database.query('SELECT * FROM public."SellerProfile"'),
      /permission denied/u,
    );
    await database.exec("RESET ROLE");
  } finally {
    await database.close();
  }
});

test("FORCE fails closed when direct authority reappears", async () => {
  const database = await enabledDatabase();
  try {
    await database.exec('GRANT SELECT ON public."SellerProfile" TO grainline_app_runtime');
    await assert.rejects(() => database.exec(force), /non-owner direct authority/u);
    await database.exec("ROLLBACK");
    assert.equal((await posture(database)).public_forced, false);
  } finally {
    await database.close();
  }
});

test("database-first rollback restores ENABLE without restoring grants", async () => {
  const database = await enabledDatabase();
  try {
    await database.exec(force);
    await database.exec(rollback);
    assert.deepEqual(await posture(database), {
      public_enabled: true,
      public_forced: false,
      policy_count: 0,
      runtime_direct: false,
      staff_direct: false,
    });
  } finally {
    await database.close();
  }
});
