import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  SELLER_PROFILE_PUBLIC_ENABLE,
  SELLER_PROFILE_PUBLIC_PREPARATIONS,
} from "./seller-profile-public-preparation-manifest.mjs";

const EXPECTED_STATES = new Set(["restart-safe", "ready", "partial", "prepared"]);

function required(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function acceptedMigration(rows, expected) {
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
      assert.notEqual(
        row.rolled_back_at,
        null,
        `${expected.name} has an unresolved failed attempt`,
      );
    }
  }
  return successes.length === 1;
}

export async function inspectSellerProfilePublicPreparationProduction(
  env = process.env,
  { Client = pg.Client } = {},
) {
  const directUrl = required("DIRECT_URL", env);
  const expectedState = required("SELLER_PROFILE_PREPARATION_EXPECTED_STATE", env);
  const evidencePath = required("SELLER_PROFILE_PREPARATION_EVIDENCE_PATH", env);
  const releaseCommit = required("SELLER_PROFILE_PREPARATION_RELEASE_COMMIT", env);
  if (!EXPECTED_STATES.has(expectedState)) throw new Error("expected state is invalid");
  if (!/^[0-9a-f]{40}$/u.test(releaseCommit)) throw new Error("release commit is invalid");

  const client = new Client({ connectionString: directUrl });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name,
             owner_role.rolname AS table_owner_name,
             migration_role.rolbypassrls AS owner_bypassrls
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_roles AS owner_role
          ON owner_role.oid = target.relowner
        JOIN pg_catalog.pg_roles AS migration_role
          ON migration_role.rolname = current_user
       WHERE target.oid = 'public."SellerProfile"'::pg_catalog.regclass
         AND target.relkind = 'r'
    `)).rows[0];
    assert.ok(identity, "SellerProfile owner identity is absent");
    assert.equal(identity.current_user_name, identity.session_user_name);
    assert.equal(identity.current_user_name, identity.table_owner_name);
    assert.equal(identity.owner_bypassrls, true);

    const reviewedMigrations = [
      ...SELLER_PROFILE_PUBLIC_PREPARATIONS,
      SELLER_PROFILE_PUBLIC_ENABLE,
    ];
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name, started_at
    `, [reviewedMigrations.map(({ name }) => name)])).rows;

    assert.equal(
      acceptedMigration(ledger, SELLER_PROFILE_PUBLIC_ENABLE),
      false,
      "SellerProfile ENABLE is already applied",
    );
    let appliedCount = 0;
    let sawPending = false;
    for (const migration of SELLER_PROFILE_PUBLIC_PREPARATIONS) {
      const applied = acceptedMigration(ledger, migration);
      if (!applied) {
        sawPending = true;
        continue;
      }
      assert.equal(sawPending, false, "SellerProfile preparations are not an applied prefix");
      appliedCount += 1;
    }
    const pending = SELLER_PROFILE_PUBLIC_PREPARATIONS
      .slice(appliedCount)
      .map(({ name }) => name);
    const state = appliedCount === 0
      ? "ready"
      : appliedCount === SELLER_PROFILE_PUBLIC_PREPARATIONS.length
        ? "prepared"
        : "partial";
    if (expectedState !== "restart-safe") {
      assert.equal(state, expectedState, `expected ${expectedState}, found ${state}`);
    }

    const posture = (await client.query(`
      SELECT
        public_table.relrowsecurity AS public_rls,
        public_table.relforcerowsecurity AS public_force,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = public_table.oid) AS public_policy_count,
        private_table.relrowsecurity AS private_rls,
        private_table.relforcerowsecurity AS private_force,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = private_table.oid) AS private_policy_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname IN ('grainline_app_runtime', 'grainline_staff_read_runtime')
            AND NOT role.rolsuper
            AND NOT role.rolinherit
            AND role.rolcanlogin
            AND NOT role.rolcreatedb
            AND NOT role.rolcreaterole
            AND NOT role.rolreplication
            AND NOT role.rolbypassrls) AS restricted_role_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.aclexplode(
             COALESCE(public_table.relacl, pg_catalog.acldefault('r', public_table.relowner))
           ) AS acl
           JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
          WHERE acl.grantee <> public_table.relowner
            AND role.rolname = 'grainline_app_runtime'
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            AND NOT acl.is_grantable) AS runtime_crud_grant_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.aclexplode(
             COALESCE(public_table.relacl, pg_catalog.acldefault('r', public_table.relowner))
           ) AS acl
          WHERE acl.grantee <> public_table.relowner
            AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE',
              'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )) AS nonowner_table_grant_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = public_table.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> public_table.relowner
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES'))
          AS nonowner_column_grant_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.aclexplode(
             COALESCE(private_table.relacl, pg_catalog.acldefault('r', private_table.relowner))
           ) AS acl
          WHERE acl.grantee <> private_table.relowner
            AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE',
              'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )) AS private_nonowner_table_grant_count,
        (SELECT pg_catalog.count(*)::integer
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = private_table.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> private_table.relowner
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES'))
          AS private_nonowner_column_grant_count
      FROM pg_catalog.pg_class AS public_table
      CROSS JOIN pg_catalog.pg_class AS private_table
     WHERE public_table.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND public_table.relkind = 'r'
       AND private_table.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND private_table.relkind = 'r'
    `)).rows[0];
    assert.ok(posture, "SellerProfile posture is absent");
    assert.equal(posture.public_rls, false);
    assert.equal(posture.public_force, false);
    assert.equal(posture.public_policy_count, 0);
    assert.equal(posture.private_rls, true);
    assert.equal(posture.private_force, true);
    assert.equal(posture.private_policy_count, 0);
    assert.equal(posture.restricted_role_count, 2);
    assert.equal(posture.runtime_crud_grant_count, 4);
    assert.equal(posture.nonowner_table_grant_count, 4);
    assert.equal(posture.nonowner_column_grant_count, 0);
    assert.equal(posture.private_nonowner_table_grant_count, 0);
    assert.equal(posture.private_nonowner_column_grant_count, 0);

    await client.query("COMMIT");
    const evidence = {
      releaseCommit,
      state,
      appliedCount,
      pendingCount: pending.length,
      pending,
      databaseName: identity.database_name,
      migrationRole: identity.current_user_name,
      reviewedPreparationCount: SELLER_PROFILE_PUBLIC_PREPARATIONS.length,
      firstPreparation: SELLER_PROFILE_PUBLIC_PREPARATIONS[0].name,
      lastPreparation: SELLER_PROFILE_PUBLIC_PREPARATIONS.at(-1).name,
      heldEnable: SELLER_PROFILE_PUBLIC_ENABLE.name,
      posture,
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
  inspectSellerProfilePublicPreparationProduction()
    .then((result) => process.stdout.write(`${JSON.stringify({ result })}\n`))
    .catch((error) => {
      process.stderr.write(`SellerProfile preparation inspection failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
