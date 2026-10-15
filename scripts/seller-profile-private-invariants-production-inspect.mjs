import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const TARGET = Object.freeze({
  name: "20261015080000_restore_seller_profile_private_invariants",
  checksum: "983c4a52e5390819f7608dd1245c19ce60b4708e85c062f0e9df3556e71ca0ed",
});
const PREREQUISITES = Object.freeze([
  Object.freeze({
    name: "20261015010000_retire_seller_profile_private_predecessor",
    checksum: "d111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a",
  }),
  Object.freeze({
    name: "20261015013000_repair_account_deletion_after_seller_profile_retirement",
    checksum: "c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368",
  }),
]);
const EXPECTED_STATES = new Set([
  "compatible",
  "repaired",
  "compatible-or-repaired",
]);

function required(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function acceptedMigration(rows, expected, { required: isRequired }) {
  const attempts = rows.filter((row) => row.migration_name === expected.name);
  for (const row of attempts) {
    assert.equal(row.checksum, expected.checksum, `${expected.name} checksum drifted`);
  }
  const successes = attempts.filter((row) => (
    row.finished_at !== null
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1
  ));
  assert.ok(successes.length <= 1, `${expected.name} has duplicate successes`);
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.notEqual(row.rolled_back_at, null, `${expected.name} has an unresolved failed attempt`);
    }
  }
  if (isRequired) assert.equal(successes.length, 1, `${expected.name} is not applied`);
  return successes.length === 1;
}

export async function inspectSellerProfilePrivateInvariantsProduction(env = process.env) {
  const directUrl = required("DIRECT_URL", env);
  const expectedState = required("SELLER_PROFILE_INVARIANTS_EXPECTED_STATE", env);
  const evidencePath = required("SELLER_PROFILE_INVARIANTS_EVIDENCE_PATH", env);
  const releaseCommit = required("SELLER_PROFILE_INVARIANTS_RELEASE_COMMIT", env);
  if (!EXPECTED_STATES.has(expectedState)) throw new Error("expected state is invalid");
  if (!/^[0-9a-f]{40}$/u.test(releaseCommit)) throw new Error("release commit is invalid");

  const client = new pg.Client({ connectionString: directUrl });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = (await client.query(`
      SELECT current_database() AS database_name, current_user AS current_user_name
    `)).rows[0];
    const migrationNames = [...PREREQUISITES.map((item) => item.name), TARGET.name];
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name, started_at
    `, [migrationNames])).rows;
    for (const prerequisite of PREREQUISITES) {
      acceptedMigration(ledger, prerequisite, { required: true });
    }
    const applied = acceptedMigration(ledger, TARGET, { required: false });
    const state = applied ? "repaired" : "compatible";
    if (expectedState !== "compatible-or-repaired") {
      assert.equal(state, expectedState, `expected ${expectedState}, found ${state}`);
    }

    const posture = (await client.query(`
      SELECT
        (SELECT relrowsecurity FROM pg_catalog.pg_class
          WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_rls,
        (SELECT relforcerowsecurity FROM pg_catalog.pg_class
          WHERE oid = 'public."SellerProfile"'::pg_catalog.regclass) AS public_force,
        (SELECT relrowsecurity FROM pg_catalog.pg_class
          WHERE oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass) AS private_rls,
        (SELECT relforcerowsecurity FROM pg_catalog.pg_class
          WHERE oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass) AS private_force,
        (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
          WHERE polrelid IN ('public."SellerProfile"'::pg_catalog.regclass,
            'public."SellerProfilePrivate"'::pg_catalog.regclass)) AS policy_count,
        pg_catalog.has_table_privilege('grainline_app_runtime',
          'public."SellerProfilePrivate"',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS runtime_private_any,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class AS target
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(target.relacl,
              pg_catalog.acldefault('r', target.relowner))
          ) AS privilege
          WHERE target.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
            AND privilege.grantee = 0
        ) AS public_private_any
    `)).rows[0];
    assert.deepEqual(posture, {
      public_rls: false,
      public_force: false,
      private_rls: false,
      private_force: false,
      policy_count: 0,
      runtime_private_any: false,
      public_private_any: false,
    });

    const dataChecks = (await client.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerProfile" AS seller
           LEFT JOIN public."SellerProfilePrivate" AS seller_private
             ON seller_private."sellerProfileId" = seller.id
          WHERE seller_private."sellerProfileId" IS NULL) AS missing_private_count,
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerProfilePrivate"
          WHERE "shipFromPhone" IS NOT NULL
            AND "shipFromPhone" !~ '^[+][1-9][0-9]{7,14}$') AS invalid_phone_count,
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerProfile" AS seller
           JOIN public."SellerProfilePrivate" AS seller_private
             ON seller_private."sellerProfileId" = seller.id
          WHERE seller."stripeAccountSupported" IS DISTINCT FROM (
            seller_private."stripeAccountVersion" IS NULL
            OR seller_private."stripeAccountVersion" = 'v2'
          )) AS snapshot_mismatch_count
    `)).rows[0];
    assert.deepEqual(dataChecks, {
      missing_private_count: 0,
      invalid_phone_count: 0,
      snapshot_mismatch_count: 0,
    });

    const constraintRows = (await client.query(`
      SELECT constraint_row.convalidated,
             pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid =
             'public."SellerProfilePrivate"'::pg_catalog.regclass
         AND constraint_row.conname =
             'SellerProfilePrivate_shipFromPhone_e164_check'
         AND constraint_row.contype = 'c'
    `)).rows;
    const functionRows = (await client.query(`
      SELECT procedure.proname, owner_role.rolname AS owner_name,
             procedure.prosecdef, procedure.provolatile,
             procedure.proparallel, procedure.proleakproof,
             procedure.proconfig,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime', procedure.oid, 'EXECUTE'
             ) AS runtime_execute,
             pg_catalog.has_function_privilege(
               'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
             ) AS staff_execute,
             pg_catalog.has_function_privilege(
               'public', procedure.oid, 'EXECUTE'
             ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_roles AS owner_role
          ON owner_role.oid = procedure.proowner
       WHERE namespace.nspname = 'public'
         AND procedure.proname = ANY($1::text[])
         AND procedure.pronargs = 0
       ORDER BY procedure.proname
    `, [[
      "grainline_seller_profile_private_supported_snapshot_sync",
      "grainline_seller_profile_supported_snapshot_guard",
    ]])).rows;
    const triggerRows = (await client.query(`
      SELECT trigger_row.tgname, trigger_row.tgenabled,
             target.relname AS table_name
        FROM pg_catalog.pg_trigger AS trigger_row
        JOIN pg_catalog.pg_class AS target ON target.oid = trigger_row.tgrelid
       WHERE trigger_row.tgname = ANY($1::text[])
         AND NOT trigger_row.tgisinternal
       ORDER BY trigger_row.tgname
    `, [[
      "SellerProfilePrivate_supported_snapshot_sync",
      "SellerProfile_supported_snapshot_guard",
    ]])).rows;

    if (applied) {
      assert.equal(constraintRows.length, 1);
      assert.equal(constraintRows[0].convalidated, true);
      assert.match(constraintRows[0].definition, /shipFromPhone[\s\S]*\^\[\+\]/u);
      assert.equal(functionRows.length, 2);
      for (const row of functionRows) {
        assert.deepEqual({
          owner_name: row.owner_name,
          prosecdef: row.prosecdef,
          provolatile: row.provolatile,
          proparallel: row.proparallel,
          proleakproof: row.proleakproof,
          proconfig: row.proconfig,
          runtime_execute: row.runtime_execute,
          staff_execute: row.staff_execute,
          public_execute: row.public_execute,
        }, {
          owner_name: identity.current_user_name,
          prosecdef: true,
          provolatile: "v",
          proparallel: "u",
          proleakproof: false,
          proconfig: ["search_path=pg_catalog"],
          runtime_execute: false,
          staff_execute: false,
          public_execute: false,
        });
      }
      assert.deepEqual(triggerRows, [
        {
          tgname: "SellerProfilePrivate_supported_snapshot_sync",
          tgenabled: "O",
          table_name: "SellerProfilePrivate",
        },
        {
          tgname: "SellerProfile_supported_snapshot_guard",
          tgenabled: "O",
          table_name: "SellerProfile",
        },
      ]);
    } else {
      assert.equal(constraintRows.length, 0);
      assert.equal(functionRows.length, 0);
      assert.equal(triggerRows.length, 0);
    }

    await client.query("COMMIT");
    const evidence = {
      releaseCommit,
      state,
      databaseName: identity.database_name,
      migrationRole: identity.current_user_name,
      posture,
      dataChecks,
      constraintCount: constraintRows.length,
      functionCount: functionRows.length,
      triggerCount: triggerRows.length,
      productionChanged: false,
      containsRowData: false,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return evidence;
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectSellerProfilePrivateInvariantsProduction()
    .then((result) => process.stdout.write(`${JSON.stringify({ result })}\n`))
    .catch((error) => {
      process.stderr.write(`SellerProfile private invariant inspection failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
