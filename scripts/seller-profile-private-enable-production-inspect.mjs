import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const INVARIANTS = Object.freeze({
  name: "20261015080000_restore_seller_profile_private_invariants",
  checksum: "983c4a52e5390819f7608dd1245c19ce60b4708e85c062f0e9df3556e71ca0ed",
});
const ENABLE = Object.freeze({
  name: "20261015100000_enable_seller_profile_private_rls",
  checksum: "3a5d128c6a5d5a7bd4bc768fe0d57d674b24a35a07ae776e442722481f26426c",
});
const EXPECTED_PHONE_CONSTRAINT_DEFINITION =
  `CHECK ("shipFromPhone" IS NULL OR "shipFromPhone"::text ~ '^[+][1-9][0-9]{7,14}$'::text)`;
const EXPECTED_STATES = new Set(["ready", "enabled", "ready-or-enabled"]);

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

export async function inspectSellerProfilePrivateEnableProduction(env = process.env) {
  const directUrl = required("DIRECT_URL", env);
  const expectedState = required("SELLER_PROFILE_PRIVATE_ENABLE_EXPECTED_STATE", env);
  const evidencePath = required("SELLER_PROFILE_PRIVATE_ENABLE_EVIDENCE_PATH", env);
  const releaseCommit = required("SELLER_PROFILE_PRIVATE_ENABLE_RELEASE_COMMIT", env);
  if (!EXPECTED_STATES.has(expectedState)) throw new Error("expected state is invalid");
  if (!/^[0-9a-f]{40}$/u.test(releaseCommit)) throw new Error("release commit is invalid");

  const client = new pg.Client({ connectionString: directUrl });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = (await client.query(`
      SELECT current_database() AS database_name, current_user AS current_user_name
    `)).rows[0];
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name, started_at
    `, [[INVARIANTS.name, ENABLE.name]])).rows;
    acceptedMigration(ledger, INVARIANTS, { required: true });
    const enableApplied = acceptedMigration(ledger, ENABLE, { required: false });
    const state = enableApplied ? "enabled" : "ready";
    if (expectedState !== "ready-or-enabled") {
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
          WHERE polrelid IN (
            'public."SellerProfile"'::pg_catalog.regclass,
            'public."SellerProfilePrivate"'::pg_catalog.regclass
          )) AS policy_count,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class AS target
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            coalesce(target.relacl, pg_catalog.acldefault('r', target.relowner))
          ) AS privilege
          WHERE target.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
            AND privilege.grantee <> target.relowner
            AND privilege.privilege_type IN (
              'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
            )
        ) AS nonowner_table_authority,
        pg_catalog.has_any_column_privilege(
          'grainline_app_runtime',
          'public."SellerProfilePrivate"',
          'SELECT,INSERT,UPDATE,REFERENCES'
        ) AS runtime_column_authority,
        pg_catalog.has_any_column_privilege(
          'grainline_staff_read_runtime',
          'public."SellerProfilePrivate"',
          'SELECT,INSERT,UPDATE,REFERENCES'
        ) AS staff_column_authority
    `)).rows[0];
    assert.deepEqual(posture, {
      public_rls: false,
      public_force: false,
      private_rls: enableApplied,
      private_force: false,
      policy_count: 0,
      nonowner_table_authority: false,
      runtime_column_authority: false,
      staff_column_authority: false,
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

    const invariantCatalog = (await client.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid =
                'public."SellerProfilePrivate"'::pg_catalog.regclass
            AND constraint_row.conname =
                'SellerProfilePrivate_shipFromPhone_e164_check'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated) AS constraint_count,
        (SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
           FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid =
                'public."SellerProfilePrivate"'::pg_catalog.regclass
            AND constraint_row.conname =
                'SellerProfilePrivate_shipFromPhone_e164_check'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated) AS phone_constraint_definition,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_trigger AS trigger_row
          WHERE trigger_row.tgname IN (
            'SellerProfilePrivate_supported_snapshot_sync',
            'SellerProfile_supported_snapshot_guard'
          )
            AND NOT trigger_row.tgisinternal
            AND trigger_row.tgenabled = 'O') AS trigger_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_proc AS procedure
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'public'
            AND procedure.proname IN (
              'grainline_seller_profile_private_supported_snapshot_sync',
              'grainline_seller_profile_supported_snapshot_guard'
            )
            AND procedure.pronargs = 0
            AND procedure.proowner = (
              SELECT class.relowner FROM pg_catalog.pg_class AS class
               WHERE class.oid =
                     'public."SellerProfilePrivate"'::pg_catalog.regclass
            )
            AND procedure.prosecdef
            AND NOT procedure.proleakproof
            AND procedure.provolatile = 'v'
            AND procedure.proparallel = 'u'
            AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
            AND NOT pg_catalog.has_function_privilege(
              'grainline_app_runtime', procedure.oid, 'EXECUTE'
            )
            AND NOT pg_catalog.has_function_privilege(
              'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
            )
            AND NOT pg_catalog.has_function_privilege(
              'public', procedure.oid, 'EXECUTE'
            )) AS function_count
    `)).rows[0];
    assert.deepEqual(invariantCatalog, {
      constraint_count: 1,
      phone_constraint_definition: EXPECTED_PHONE_CONSTRAINT_DEFINITION,
      trigger_count: 2,
      function_count: 2,
    });

    await client.query("COMMIT");
    const evidence = {
      releaseCommit,
      state,
      databaseName: identity.database_name,
      migrationRole: identity.current_user_name,
      posture,
      dataChecks,
      invariantCatalog,
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
  inspectSellerProfilePrivateEnableProduction()
    .then((result) => process.stdout.write(`${JSON.stringify({ result })}\n`))
    .catch((error) => {
      process.stderr.write(`SellerProfilePrivate ENABLE inspection failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
