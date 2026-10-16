import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const invariants = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015080000_restore_seller_profile_private_invariants",
  ),
  "utf8",
);
const enable = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015100000_enable_seller_profile_private_rls",
  ),
  "utf8",
);
const force = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015120000_force_seller_profile_private_rls",
  ),
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-private-force-rollback.sql",
  "utf8",
);
const expectedPhoneConstraintDefinition =
  `CHECK ("shipFromPhone" IS NULL OR "shipFromPhone"::text ~ '^[+][1-9][0-9]{7,14}$'::text)`;

async function readyDatabase() {
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
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY,
      "stripeAccountVersion" text,
      "shipFromPhone" varchar(30),
      "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    REVOKE ALL ON TABLE public."SellerProfilePrivate"
      FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
    INSERT INTO public."SellerProfile" (
      id, "stripeAccountSupported"
    ) VALUES ('seller-1', true);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountVersion", "shipFromPhone"
    ) VALUES ('seller-1', 'v2', '+15125550123');
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, started_at,
      applied_steps_count
    ) VALUES
      ('retirement',
       'd111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a',
       pg_catalog.clock_timestamp(),
       '20261015010000_retire_seller_profile_private_predecessor',
       pg_catalog.clock_timestamp(), 1),
      ('repair',
       'c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368',
       pg_catalog.clock_timestamp(),
       '20261015013000_repair_account_deletion_after_seller_profile_retirement',
       pg_catalog.clock_timestamp(), 1);
  `);
  await database.exec(invariants);
  const phoneConstraint = (await database.query(`
    SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND constraint_row.conname =
           'SellerProfilePrivate_shipFromPhone_e164_check'
  `)).rows[0];
  assert.equal(phoneConstraint.definition, expectedPhoneConstraintDefinition);
  await database.query(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, started_at,
      applied_steps_count
    ) VALUES ($1, $2, pg_catalog.clock_timestamp(), $3,
      pg_catalog.clock_timestamp(), 1)
  `, [
    "invariants",
    "983c4a52e5390819f7608dd1245c19ce60b4708e85c062f0e9df3556e71ca0ed",
    "20261015080000_restore_seller_profile_private_invariants",
  ]);
  await database.exec(enable);
  await database.query(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, started_at,
      applied_steps_count
    ) VALUES ($1, $2, pg_catalog.clock_timestamp(), $3,
      pg_catalog.clock_timestamp(), 1)
  `, [
    "enable",
    "3a5d128c6a5d5a7bd4bc768fe0d57d674b24a35a07ae776e442722481f26426c",
    "20261015100000_enable_seller_profile_private_rls",
  ]);
  return database;
}

async function posture(database) {
  return (await database.query(`
    SELECT
      (SELECT relrowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_enabled,
      (SELECT relforcerowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_forced,
      (SELECT relrowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass) AS private_enabled,
      (SELECT relforcerowsecurity FROM pg_catalog.pg_class
        WHERE oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass) AS private_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = 'public."SellerProfilePrivate"'::pg_catalog.regclass) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."SellerProfilePrivate"',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS runtime_direct,
      pg_catalog.has_table_privilege(
        'grainline_staff_read_runtime', 'public."SellerProfilePrivate"',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS staff_direct
  `)).rows[0];
}

test("policyless SellerProfilePrivate FORCE preserves public-table posture and owner operations", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(force);
    assert.deepEqual(await posture(database), {
      public_enabled: false,
      public_forced: false,
      private_enabled: true,
      private_forced: true,
      policy_count: 0,
      runtime_direct: false,
      staff_direct: false,
    });

    await database.exec(`
      UPDATE public."SellerProfilePrivate"
         SET "stripeAccountVersion" = 'v3'
       WHERE "sellerProfileId" = 'seller-1';
    `);
    assert.equal((await database.query(`
      SELECT "stripeAccountSupported" AS supported
        FROM public."SellerProfile"
       WHERE id = 'seller-1'
    `)).rows[0].supported, false);

    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      () => database.query('SELECT * FROM public."SellerProfilePrivate"'),
      /permission denied/u,
    );
    await database.exec("RESET ROLE");
  } finally {
    await database.close();
  }
});

test("FORCE fails closed on public-snapshot drift and changes no posture", async () => {
  const database = await readyDatabase();
  try {
    await database.exec('ALTER TABLE public."SellerProfile" DISABLE TRIGGER "SellerProfile_supported_snapshot_guard"');
    await database.exec('UPDATE public."SellerProfile" SET "stripeAccountSupported" = false WHERE id = \'seller-1\'');
    await database.exec('ALTER TABLE public."SellerProfile" ENABLE TRIGGER "SellerProfile_supported_snapshot_guard"');
    await assert.rejects(() => database.exec(force), /data preflight failed/u);
    await database.exec("ROLLBACK");
    assert.deepEqual(await posture(database), {
      public_enabled: false,
      public_forced: false,
      private_enabled: true,
      private_forced: false,
      policy_count: 0,
      runtime_direct: false,
      staff_direct: false,
    });
  } finally {
    await database.close();
  }
});

test("database-first rollback restores only the accepted ENABLE posture", async () => {
  const database = await readyDatabase();
  try {
    await database.exec(force);
    await database.exec(rollback);
    assert.deepEqual(await posture(database), {
      public_enabled: false,
      public_forced: false,
      private_enabled: true,
      private_forced: false,
      policy_count: 0,
      runtime_direct: false,
      staff_direct: false,
    });
  } finally {
    await database.close();
  }
});
