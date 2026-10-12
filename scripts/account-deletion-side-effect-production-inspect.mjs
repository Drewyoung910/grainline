#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const ACCOUNT_DELETION_PREPARATION_MIGRATION =
  "20261011170000_prepare_account_deletion_side_effect_claim_fence";
export const ACCOUNT_DELETION_MEDIA_KEY_MIGRATION =
  "20261011173000_prepare_account_deletion_media_key_fence";
export const ACCOUNT_DELETION_ACTIVATION_MIGRATION =
  "20261011180000_enable_account_deletion_side_effect_rls";
export const ACCOUNT_DELETION_FORCE_MIGRATION =
  "20261012120000_force_account_deletion_side_effect_rls";
export const ACCOUNT_DELETION_INSPECTION_CONFIRMATION =
  "inspect-reviewed-account-deletion-side-effect-preparation";
export const REVIEWED_ACCOUNT_DELETION_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
  workerRole: "grainline_account_deletion_runtime",
});

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXPECTED_STATES = Object.freeze({
  pending: Object.freeze(["pending"]),
  preparation_only: Object.freeze(["preparation_only"]),
  prepared: Object.freeze(["prepared"]),
  "activation-compatible": Object.freeze(["prepared", "enabled"]),
  enabled: Object.freeze(["enabled"]),
  "force-compatible": Object.freeze(["enabled", "forced"]),
  forced: Object.freeze(["forced"]),
  compatible: Object.freeze(["pending", "preparation_only", "prepared"]),
});

export class AccountDeletionCatalogVerificationError extends Error {
  constructor(cause, catalog) {
    super(
      "Production AccountDeletionSideEffect catalog did not match the reviewed release contract",
    );
    this.name = "AccountDeletionCatalogVerificationError";
    this.catalog = catalog;
    this.failure = Object.freeze({
      code: "CATALOG_VERIFICATION_REJECTED",
      name: cause instanceof Error ? cause.name : "Error",
      message:
        cause instanceof Error
          ? String(cause.message).slice(0, 8_000)
          : "Unknown catalog verification failure",
    });
  }
}
const FUNCTION_GRANTS = Object.freeze(
  new Map([
    [
      "grainline_account_deletion_side_effect_claim(text)",
      ["grainline_account_deletion_runtime", "grainline_app_runtime"],
    ],
    [
      "grainline_account_deletion_side_effect_complete(text, bigint, uuid)",
      ["grainline_account_deletion_runtime", "grainline_app_runtime"],
    ],
    [
      "grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)",
      ["grainline_account_deletion_runtime", "grainline_app_runtime"],
    ],
    [
      "grainline_account_deletion_media_enqueue_claimed(text, bigint, uuid, text[])",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])",
      ["grainline_app_runtime"],
    ],
    ["grainline_account_deletion_claim_user(text, bigint, uuid)", []],
    [
      "grainline_user_account_deletion_preflight(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_user_account_deletion_snapshot(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_user_account_deletion_finalize(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_case_account_deletion_redact(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_message_redact_for_account_deletion(text, text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_order_account_deletion_scrub(text, text, bigint, uuid, text[])",
      ["grainline_app_runtime"],
    ],
  ]),
);
const ENABLED_FUNCTION_GRANTS = Object.freeze(
  new Map([
    [
      "grainline_account_deletion_side_effect_claim(text)",
      ["grainline_account_deletion_runtime"],
    ],
    [
      "grainline_account_deletion_side_effect_complete(text, bigint, uuid)",
      ["grainline_account_deletion_runtime"],
    ],
    [
      "grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)",
      ["grainline_account_deletion_runtime"],
    ],
    [
      "grainline_account_deletion_media_enqueue_claimed(text, bigint, uuid, text[])",
      [],
    ],
    [
      "grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])",
      ["grainline_app_runtime"],
    ],
    ["grainline_account_deletion_claim_user(text, bigint, uuid)", []],
    [
      "grainline_user_account_deletion_preflight(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_user_account_deletion_snapshot(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_user_account_deletion_finalize(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_case_account_deletion_redact(text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_message_redact_for_account_deletion(text, text, bigint, uuid)",
      ["grainline_app_runtime"],
    ],
    [
      "grainline_order_account_deletion_scrub(text, text, bigint, uuid, text[])",
      ["grainline_app_runtime"],
    ],
  ]),
);
const RETIRED_LEGACY_FUNCTIONS = Object.freeze([
  "grainline_user_account_deletion_preflight(text)",
  "grainline_user_account_deletion_snapshot(text)",
  "grainline_user_account_deletion_finalize(text)",
  "grainline_case_account_deletion_redact(text)",
  "grainline_message_redact_for_account_deletion(text)",
  "grainline_order_account_deletion_scrub(text, text[])",
]);

function required(env, name) {
  const value = env?.[name];
  assert.ok(
    typeof value === "string" && value !== "" && value === value.trim(),
    `${name} is required`,
  );
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseIdentity(identity) {
  const match = identity.match(/^([a-z0-9_]+)\((.*)\)$/u);
  assert.ok(match, `Invalid function identity: ${identity}`);
  return Object.freeze({ name: match[1], identityArguments: match[2] });
}

function sourceFunctionContract(sql, identity) {
  const parsed = parseIdentity(identity);
  const start = sql.search(
    new RegExp(
      `CREATE FUNCTION public\\.${escapeRegExp(parsed.name)}\\s*\\(`,
      "u",
    ),
  );
  assert.ok(start >= 0, `${identity} is absent from the preparation migration`);
  const remainder = sql.slice(start);
  const body = remainder.match(
    /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1\s*;/u,
  );
  assert.ok(body, `${identity} has no parseable body`);
  const header = remainder.slice(0, body.index);
  assert.match(header, /\bLANGUAGE\s+plpgsql\b/iu);
  assert.match(header, /\bSECURITY\s+DEFINER\b/iu);
  assert.match(header, /\bSET\s+search_path\s*=\s*pg_catalog\b/iu);
  return Object.freeze({
    identity,
    ...parsed,
    sourceMd5: createHash("md5").update(body[2], "utf8").digest("hex"),
    volatility: /\bSTABLE\b/iu.test(header)
      ? "s"
      : /\bIMMUTABLE\b/iu.test(header)
        ? "i"
        : "v",
    parallelSafety: /\bPARALLEL\s+SAFE\b/iu.test(header)
      ? "s"
      : /\bPARALLEL\s+RESTRICTED\b/iu.test(header)
        ? "r"
        : "u",
    grantees: FUNCTION_GRANTS.get(identity),
  });
}

export function buildAccountDeletionPreparationExpectation(
  root = process.cwd(),
) {
  const preparationPath = path.join(
    root,
    "prisma",
    "migrations",
    ACCOUNT_DELETION_PREPARATION_MIGRATION,
    "migration.sql",
  );
  const activationPath = path.join(
    root,
    "prisma",
    "migrations",
    ACCOUNT_DELETION_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  const mediaKeyPath = path.join(
    root,
    "prisma",
    "migrations",
    ACCOUNT_DELETION_MEDIA_KEY_MIGRATION,
    "migration.sql",
  );
  const forcePath = path.join(
    root,
    "prisma",
    "migrations",
    ACCOUNT_DELETION_FORCE_MIGRATION,
    "migration.sql",
  );
  const preparationSql = readFileSync(preparationPath, "utf8");
  const mediaKeySql = readFileSync(mediaKeyPath, "utf8");
  const activationSql = readFileSync(activationPath, "utf8");
  const forceSql = readFileSync(forcePath, "utf8");
  const preparationFunctionIdentities = [...FUNCTION_GRANTS.keys()].filter(
    (identity) =>
      identity !==
      "grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])",
  );
  const preparationFunctions = Object.freeze(
    preparationFunctionIdentities.map((identity) =>
      sourceFunctionContract(preparationSql, identity),
    ),
  );
  const mediaKeyFunction = sourceFunctionContract(
    mediaKeySql,
    "grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])",
  );
  return Object.freeze({
    migration: ACCOUNT_DELETION_PREPARATION_MIGRATION,
    checksum: createHash("sha256").update(preparationSql, "utf8").digest("hex"),
    mediaKey: Object.freeze({
      migration: ACCOUNT_DELETION_MEDIA_KEY_MIGRATION,
      checksum: createHash("sha256").update(mediaKeySql, "utf8").digest("hex"),
    }),
    activation: Object.freeze({
      migration: ACCOUNT_DELETION_ACTIVATION_MIGRATION,
      checksum: createHash("sha256")
        .update(activationSql, "utf8")
        .digest("hex"),
    }),
    force: Object.freeze({
      migration: ACCOUNT_DELETION_FORCE_MIGRATION,
      checksum: createHash("sha256").update(forceSql, "utf8").digest("hex"),
    }),
    preparationFunctions,
    functions: Object.freeze([...preparationFunctions, mediaKeyFunction]),
  });
}

export function parseAccountDeletionInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "AccountDeletionSideEffect production inspection",
  );
  assert.ok(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_RUN_ATTEMPT === "1",
    "AccountDeletionSideEffect inspection requires a first-attempt manual main dispatch",
  );
  const releaseCommit = required(
    env,
    "ACCOUNT_DELETION_INSPECT_RELEASE_COMMIT",
  );
  assert.ok(
    COMMIT.test(releaseCommit) && releaseCommit === required(env, "GITHUB_SHA"),
    "AccountDeletionSideEffect inspection commit must match dispatched main",
  );
  assert.equal(
    env.ACCOUNT_DELETION_INSPECT_CONFIRM,
    ACCOUNT_DELETION_INSPECTION_CONFIRMATION,
  );
  for (const forbidden of [
    "DATABASE_URL",
    "GRANT_AUDIT_DATABASE_URL",
    "ACCOUNT_DELETION_DATABASE_URL",
  ]) {
    assert.equal(
      Object.hasOwn(env, forbidden),
      false,
      `${forbidden} must be absent from owner-only inspection`,
    );
  }
  const directUrl = required(env, "DIRECT_URL");
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  assert.ok(
    SHA256.test(required(env, "PRODUCTION_MIGRATION_DIRECT_URL_SHA256")) &&
      directUrlSha256 === env.PRODUCTION_MIGRATION_DIRECT_URL_SHA256,
    "DIRECT_URL does not match the protected digest",
  );
  const target = REVIEWED_ACCOUNT_DELETION_TARGET;
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  assert.ok(
    !identity.isPooler &&
      identity.endpointId === target.endpointId &&
      identity.databaseName === target.databaseName &&
      identity.region === target.region &&
      identity.username === target.ownerRole &&
      required(env, "MIGRATION_DB_ROLE") === target.ownerRole &&
      required(env, "RUNTIME_DB_ROLE") === target.runtimeRole,
    "DIRECT_URL is not the reviewed direct Production owner target",
  );
  const expectedState = env.ACCOUNT_DELETION_EXPECTED_STATE ?? "compatible";
  const acceptedStates = EXPECTED_STATES[expectedState];
  assert.ok(
    acceptedStates,
    "AccountDeletionSideEffect expected state is invalid",
  );
  const evidencePath = path.resolve(
    required(env, "ACCOUNT_DELETION_INSPECT_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    path.resolve(required(env, "RUNNER_TEMP")),
    `account-deletion-side-effect-production-inspection-${releaseCommit}-${expectedState}.json`,
  );
  assert.ok(
    evidencePath === expectedPath && !existsSync(evidencePath),
    "Evidence path is not fresh and exact",
  );
  return Object.freeze({
    acceptedStates,
    directUrl,
    directUrlSha256,
    evidencePath,
    expectedState,
    identity,
    requireActivationReady:
      expectedState === "activation-compatible" ||
      expectedState === "enabled" ||
      expectedState === "force-compatible" ||
      expectedState === "forced",
    releaseCommit,
  });
}

export function readAccountDeletionInspectionGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertAccountDeletionInspectionGitState(state, releaseCommit) {
  assert.ok(
    state?.head === releaseCommit && state.status === "",
    "Inspection checkout is not exact and clean",
  );
  return Object.freeze({ head: state.head, clean: true });
}

export async function readAccountDeletionCatalog(
  client,
  expectation,
  { inspectActivationBlockers = false } = {},
) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user, SESSION_USER::text AS session_user,
      pg_catalog.current_database()::text AS database_name,
      pg_catalog.current_setting('transaction_read_only') AS read_only,
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      owner.rolbypassrls AS owner_bypass_rls,
      runtime.rolsuper AS runtime_superuser, runtime.rolinherit AS runtime_inherit,
      runtime.rolbypassrls AS runtime_bypass_rls,
      worker.rolsuper AS worker_superuser, worker.rolinherit AS worker_inherit,
      worker.rolcanlogin AS worker_login, worker.rolcreatedb AS worker_createdb,
      worker.rolcreaterole AS worker_createrole, worker.rolreplication AS worker_replication,
      worker.rolbypassrls AS worker_bypass_rls,
      ARRAY(
        SELECT pg_catalog.format('%s:%s', acl.privilege_type,
          CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END)
        FROM pg_catalog.pg_namespace AS namespace,
          LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) AS acl
        WHERE namespace.nspname = 'public' AND acl.grantee = worker.oid
        ORDER BY 1
      ) AS worker_schema_acl,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
        WHERE (member.rolname = worker.rolname OR granted.rolname = worker.rolname)
          AND NOT (granted.rolname = worker.rolname AND member.rolname = 'neondb_owner'
            AND grantor.rolname = 'cloud_admin' AND membership.admin_option
            AND NOT membership.inherit_option AND NOT membership.set_option)
      ) AS worker_unreviewed_membership
    FROM pg_catalog.pg_roles AS owner
    JOIN pg_catalog.pg_roles AS runtime ON runtime.rolname = 'grainline_app_runtime'
    JOIN pg_catalog.pg_roles AS worker ON worker.rolname = 'grainline_account_deletion_runtime'
    WHERE owner.rolname = CURRENT_USER
  `);
  const migrations = await client.query(
    `
    SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
      rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count::text AS applied_steps_count
    FROM public._prisma_migrations
    WHERE migration_name = ANY($1::text[])
    ORDER BY migration_name
  `,
    [
      [
        expectation.migration,
        expectation.mediaKey.migration,
        expectation.activation.migration,
        expectation.force.migration,
      ],
    ],
  );
  const table = await client.query(`
    SELECT class.relname::text AS table_name, pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
      class.relrowsecurity AS rls_enabled, class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS runtime_select,
      pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS runtime_insert,
      pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS runtime_update,
      pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS runtime_delete,
      pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'TRUNCATE,REFERENCES,TRIGGER') AS runtime_other,
      pg_catalog.has_table_privilege('grainline_account_deletion_runtime', class.oid, 'SELECT') AS worker_select,
      pg_catalog.has_table_privilege('grainline_account_deletion_runtime', class.oid, 'INSERT') AS worker_insert,
      pg_catalog.has_table_privilege('grainline_account_deletion_runtime', class.oid, 'UPDATE') AS worker_update,
      pg_catalog.has_table_privilege('grainline_account_deletion_runtime', class.oid, 'DELETE') AS worker_delete,
      pg_catalog.has_table_privilege('grainline_account_deletion_runtime', class.oid, 'TRUNCATE,REFERENCES,TRIGGER') AS worker_other,
      EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS attribute,
        LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
          AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_account_deletion_runtime'))
        AS worker_explicit_column_authority,
      EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS attribute,
        LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
          AND acl.grantee = 0) AS public_column_authority,
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) AS public_table_authority
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname = 'AccountDeletionSideEffect' AND class.relkind = 'r'
  `);
  const columns = await client.query(
    `
    SELECT attribute.attname::text AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS data_type,
      attribute.attnotnull AS not_null,
      pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)::text AS default_expression
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND class.relname = 'AccountDeletionSideEffect'
      AND attribute.attname = ANY($1::text[]) AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ORDER BY attribute.attname
  `,
    [["claimGeneration", "claimToken", "processingStartedAt"]],
  );
  const constraints = await client.query(
    `
    SELECT constraint_row.conname::text AS constraint_name, constraint_row.contype::text AS constraint_type,
      constraint_row.convalidated AS validated, pg_catalog.pg_get_constraintdef(constraint_row.oid, true)::text AS definition
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public."AccountDeletionSideEffect"'::pg_catalog.regclass
      AND constraint_row.conname = ANY($1::text[])
    ORDER BY constraint_row.conname
  `,
    [
      [
        "AccountDeletionSideEffect_attempts_check",
        "AccountDeletionSideEffect_claimGeneration_check",
      ],
    ],
  );
  const indexes = await client.query(`
    SELECT index_class.relname::text AS index_name, index_row.indisvalid AS valid, index_row.indisready AS ready,
      pg_catalog.pg_get_indexdef(index_row.indexrelid)::text AS definition
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
    WHERE index_row.indrelid = 'public."AccountDeletionSideEffect"'::pg_catalog.regclass
      AND index_class.relname = 'AccountDeletionSideEffect_status_processingStartedAt_idx'
  `);
  const functionNames = [
    ...new Set(expectation.functions.map((entry) => entry.name)),
  ];
  const functions = await client.query(
    `
    SELECT procedure.proname::text AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes)::text AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
      language.lanname::text AS language_name, procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer, procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility, procedure.proparallel AS parallel_safety,
      COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
      pg_catalog.md5(procedure.prosrc) AS source_md5,
      pg_catalog.has_function_privilege('grainline_app_runtime', procedure.oid, 'EXECUTE') AS runtime_execute,
      pg_catalog.has_function_privilege('grainline_account_deletion_runtime', procedure.oid, 'EXECUTE') AS worker_execute,
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute,
      ARRAY(SELECT pg_catalog.format('%s:%s:%s', pg_catalog.pg_get_userbyid(acl.grantee), acl.privilege_type,
        CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END)
        FROM pg_catalog.aclexplode(COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) AS acl
        WHERE acl.grantee <> 0 AND acl.grantee <> procedure.proowner ORDER BY 1) AS nonowner_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public' AND procedure.proname = ANY($1::text[])
    ORDER BY procedure.proname, identity_arguments
  `,
    [functionNames],
  );
  let policies = { rows: [] };
  let retiredFunctions = { rows: [] };
  let activationBlockers = { rows: [] };
  if (inspectActivationBlockers) {
    policies = await client.query(`
      SELECT policy.polname::text AS policy_name,
        policy.polcmd::text AS command,
        policy.polpermissive AS permissive,
        ARRAY(
          SELECT role.rolname::text
          FROM pg_catalog.unnest(policy.polroles) AS policy_role(role_oid)
          JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
          ORDER BY role.rolname
        ) AS roles,
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)::text AS using_expression,
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)::text AS check_expression
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'public."AccountDeletionSideEffect"'::pg_catalog.regclass
      ORDER BY policy.polname
    `);
    retiredFunctions = await client.query(
      `
      SELECT expected.function_identity,
        pg_catalog.to_regprocedure(
          'public.' || expected.function_identity
        ) IS NOT NULL AS function_exists,
        COALESCE(pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          pg_catalog.to_regprocedure('public.' || expected.function_identity),
          'EXECUTE'
        ), false) AS runtime_execute,
        COALESCE(pg_catalog.has_function_privilege(
          'grainline_account_deletion_runtime',
          pg_catalog.to_regprocedure('public.' || expected.function_identity),
          'EXECUTE'
        ), false) AS worker_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS procedure
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
          WHERE procedure.oid =
            pg_catalog.to_regprocedure('public.' || expected.function_identity)
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.unnest($1::text[]) AS expected(function_identity)
      ORDER BY expected.function_identity
    `,
      [RETIRED_LEGACY_FUNCTIONS],
    );
    activationBlockers = await client.query(`
      SELECT
        pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(effect.id, 'UTF8')),
          'hex'
        ) AS row_id_sha256,
        effect.kind::text AS kind,
        effect.status::text AS status,
        effect.attempts,
        effect."claimGeneration"::text AS claim_generation,
        effect."claimToken" IS NOT NULL AS claim_token_present,
        effect."processingStartedAt" IS NOT NULL AS processing_started_at_present,
        effect."processedAt" IS NOT NULL AS processed_at_present,
        pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(effect.payload::text, 'UTF8')
          ),
          'hex'
        ) AS payload_sha256,
        pg_catalog.to_char(
          effect."createdAt",
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS created_at,
        pg_catalog.to_char(
          effect."updatedAt",
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS updated_at,
        (
          pg_catalog.jsonb_typeof(effect.payload -> 'url') = 'string'
          AND pg_catalog.btrim(effect.payload ->> 'url') <> ''
        ) AS legacy_url_only,
        pg_catalog.count(*) OVER ()::integer AS total_count
      FROM public."AccountDeletionSideEffect" AS effect
      WHERE effect.kind NOT IN (
          'LOCAL_ANONYMIZE', 'STRIPE_REJECT', 'MEDIA_DELETE', 'AUDIT_REDACT'
        )
        OR effect.status NOT IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')
        OR effect.attempts < 0
        OR effect."claimGeneration" < 0
        OR (
          effect.status = 'PROCESSING'
          AND (
            effect."claimGeneration" < 1
            OR effect."claimToken" IS NULL
            OR effect."processingStartedAt" IS NULL
          )
        )
        OR (effect.status = 'DONE' AND effect."processedAt" IS NULL)
        OR (
          effect.kind = 'LOCAL_ANONYMIZE'
          AND (
            effect."dedupKey" <> 'account-delete:local:' || effect."userId"
            OR effect.payload <> '{}'::jsonb
          )
        )
        OR (
          effect.kind = 'MEDIA_DELETE'
          AND effect.status <> 'DONE'
          AND (
            pg_catalog.jsonb_typeof(effect.payload) IS DISTINCT FROM 'object'
            OR pg_catalog.jsonb_typeof(effect.payload -> 'key')
                 IS DISTINCT FROM 'string'
            OR pg_catalog.btrim(effect.payload ->> 'key') = ''
          )
        )
      ORDER BY effect."createdAt", effect.id
      LIMIT 500
    `);
  }
  assert.ok(
    identity.rows.length === 1 && table.rows.length === 1,
    "Production roles or table are missing or ambiguous",
  );
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    migrations: Object.freeze(migrations.rows.map((row) => Object.freeze(row))),
    table: Object.freeze(table.rows[0]),
    columns: Object.freeze(columns.rows.map((row) => Object.freeze(row))),
    constraints: Object.freeze(
      constraints.rows.map((row) => Object.freeze(row)),
    ),
    indexes: Object.freeze(indexes.rows.map((row) => Object.freeze(row))),
    functions: Object.freeze(
      functions.rows.map((row) =>
        Object.freeze({
          ...row,
          function_config: Object.freeze([...(row.function_config ?? [])]),
          nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
        }),
      ),
    ),
    policies: Object.freeze(
      policies.rows.map((row) =>
        Object.freeze({ ...row, roles: Object.freeze([...(row.roles ?? [])]) }),
      ),
    ),
    retiredFunctions: Object.freeze(
      retiredFunctions.rows.map((row) => Object.freeze(row)),
    ),
    activationBlockerCount:
      activationBlockers.rows.length === 0
        ? 0
        : Number(activationBlockers.rows[0].total_count),
    activationBlockers: Object.freeze(
      activationBlockers.rows.map(({ total_count: _totalCount, ...row }) =>
        Object.freeze(row),
      ),
    ),
  });
}

export function verifyAccountDeletionCatalog(
  catalog,
  expectation,
  acceptedStates = EXPECTED_STATES.compatible,
  requireActivationReady = false,
) {
  const target = REVIEWED_ACCOUNT_DELETION_TARGET;
  const preparationRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.migration,
  );
  const activationRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.activation.migration,
  );
  const mediaKeyRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.mediaKey.migration,
  );
  const forceRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.force.migration,
  );
  assert.ok(
    preparationRows.length <= 1 &&
      mediaKeyRows.length <= 1 &&
      activationRows.length <= 1 &&
      forceRows.length <= 1,
  );
  assert.ok(
    preparationRows.length === 1 || mediaKeyRows.length === 0,
    "AccountDeletionSideEffect media-key migration requires its preparation predecessor",
  );
  assert.ok(
    mediaKeyRows.length === 1 || activationRows.length === 0,
    "AccountDeletionSideEffect activation requires both preparation predecessors",
  );
  assert.ok(
    activationRows.length === 1 || forceRows.length === 0,
    "AccountDeletionSideEffect FORCE requires its activation predecessor",
  );
  const preparationApplied = preparationRows.length === 1;
  const mediaKeyApplied = mediaKeyRows.length === 1;
  const activationApplied = activationRows.length === 1;
  const forceApplied = forceRows.length === 1;
  const state = forceApplied
    ? "forced"
    : activationApplied
    ? "enabled"
    : mediaKeyApplied
    ? "prepared"
    : preparationApplied
      ? "preparation_only"
      : "pending";
  assert.deepEqual(catalog.identity, {
    current_user: target.ownerRole,
    session_user: target.ownerRole,
    database_name: target.databaseName,
    read_only: "on",
    isolation: "repeatable read",
    owner_bypass_rls: true,
    runtime_superuser: false,
    runtime_inherit: false,
    runtime_bypass_rls: false,
    worker_superuser: false,
    worker_inherit: false,
    worker_login: true,
    worker_createdb: false,
    worker_createrole: false,
    worker_replication: false,
    worker_bypass_rls: false,
    worker_schema_acl: preparationApplied ? ["USAGE:false"] : [],
    worker_unreviewed_membership: false,
  });
  assert.ok(
    acceptedStates.includes(state),
    "Installed state is outside the reviewed boundary",
  );
  if (preparationApplied) {
    assert.deepEqual(preparationRows[0], {
      migration_name: expectation.migration,
      checksum: expectation.checksum,
      finished: true,
      rolled_back: false,
      applied_steps_count: "1",
    });
    if (mediaKeyApplied) {
      assert.deepEqual(mediaKeyRows[0], {
        migration_name: expectation.mediaKey.migration,
        checksum: expectation.mediaKey.checksum,
        finished: true,
        rolled_back: false,
        applied_steps_count: "1",
      });
    }
    if (activationApplied) {
      assert.deepEqual(activationRows[0], {
        migration_name: expectation.activation.migration,
        checksum: expectation.activation.checksum,
        finished: true,
        rolled_back: false,
        applied_steps_count: "1",
      });
    }
    if (forceApplied) {
      assert.deepEqual(forceRows[0], {
        migration_name: expectation.force.migration,
        checksum: expectation.force.checksum,
        finished: true,
        rolled_back: false,
        applied_steps_count: "1",
      });
    }
  }
  assert.deepEqual(catalog.table, {
    table_name: "AccountDeletionSideEffect",
    owner_name: target.ownerRole,
    rls_enabled: activationApplied,
    rls_forced: forceApplied,
    policy_count: activationApplied ? 1 : 0,
    runtime_select: !activationApplied,
    runtime_insert: !activationApplied,
    runtime_update: !activationApplied,
    runtime_delete: !activationApplied,
    runtime_other: false,
    worker_select: preparationApplied,
    worker_insert: preparationApplied,
    worker_update: preparationApplied,
    worker_delete: preparationApplied,
    worker_other: false,
    worker_explicit_column_authority: false,
    public_column_authority: false,
    public_table_authority: false,
  });
  if (activationApplied) {
    assert.equal(
      requireActivationReady,
      true,
      "Enabled inspection requires the activation-ready row and policy inventory",
    );
    assert.deepEqual(catalog.policies, [
      {
        policy_name:
          "AccountDeletionSideEffect_account_deletion_runtime_all",
        command: "*",
        permissive: true,
        roles: [target.workerRole],
        using_expression: "true",
        check_expression: "true",
      },
    ]);
    assert.deepEqual(
      catalog.retiredFunctions,
      [...RETIRED_LEGACY_FUNCTIONS]
        .sort((left, right) => left.localeCompare(right))
        .map((functionIdentity) => ({
          function_identity: functionIdentity,
          function_exists: true,
          runtime_execute: false,
          worker_execute: false,
          public_execute: false,
        })),
    );
  } else if (requireActivationReady) {
    assert.deepEqual(catalog.policies, []);
  }
  if (requireActivationReady) {
    assert.equal(
      catalog.activationBlockerCount,
      0,
      "AccountDeletionSideEffect activation requires zero rows rejected by its activation invariants",
    );
    assert.deepEqual(catalog.activationBlockers, []);
  }
  if (preparationApplied) {
    assert.deepEqual(catalog.columns, [
      {
        column_name: "claimGeneration",
        data_type: "bigint",
        not_null: true,
        default_expression: catalog.columns[0]?.default_expression,
      },
      {
        column_name: "claimToken",
        data_type: "uuid",
        not_null: false,
        default_expression: null,
      },
      {
        column_name: "processingStartedAt",
        data_type: "timestamp(3) without time zone",
        not_null: false,
        default_expression: null,
      },
    ]);
    assert.match(
      catalog.columns[0].default_expression ?? "",
      /^(?:0|'0'::bigint|0::bigint)$/u,
    );
    assert.deepEqual(
      catalog.constraints.map(
        ({ constraint_name, constraint_type, validated }) => ({
          constraint_name,
          constraint_type,
          validated,
        }),
      ),
      [
        {
          constraint_name: "AccountDeletionSideEffect_attempts_check",
          constraint_type: "c",
          validated: true,
        },
        {
          constraint_name: "AccountDeletionSideEffect_claimGeneration_check",
          constraint_type: "c",
          validated: true,
        },
      ],
    );
    const constraintDefinitions = Object.fromEntries(
      catalog.constraints.map((row) => [
        row.constraint_name,
        String(row.definition).replaceAll(/\s+/gu, " "),
      ]),
    );
    assert.match(
      constraintDefinitions.AccountDeletionSideEffect_attempts_check ?? "",
      /^CHECK \(\(?attempts >= 0\)?\)$/u,
    );
    assert.match(
      constraintDefinitions.AccountDeletionSideEffect_claimGeneration_check ??
        "",
      /^CHECK \(\(?"claimGeneration" >= 0\)?\)$/u,
    );
    assert.deepEqual(
      catalog.indexes.map(({ index_name, valid, ready }) => ({
        index_name,
        valid,
        ready,
      })),
      [
        {
          index_name:
            "AccountDeletionSideEffect_status_processingStartedAt_idx",
          valid: true,
          ready: true,
        },
      ],
    );
    assert.match(
      catalog.indexes[0]?.definition ?? "",
      /^CREATE INDEX "AccountDeletionSideEffect_status_processingStartedAt_idx" ON public\."AccountDeletionSideEffect" USING btree \(status, "processingStartedAt"\)$/u,
    );
  } else {
    assert.deepEqual(catalog.columns, []);
    assert.deepEqual(catalog.constraints, []);
    assert.deepEqual(catalog.indexes, []);
  }
  const expectedFunctions = preparationApplied
    ? [...(mediaKeyApplied ? expectation.functions : expectation.preparationFunctions)].sort((a, b) =>
        a.identity.localeCompare(b.identity),
      )
    : [];
  const actualFunctions = catalog.functions
    .filter((row) =>
      FUNCTION_GRANTS.has(`${row.function_name}(${row.identity_arguments})`),
    )
    .sort((a, b) =>
      `${a.function_name}(${a.identity_arguments})`.localeCompare(
        `${b.function_name}(${b.identity_arguments})`,
      ),
    );
  assert.equal(
    actualFunctions.length,
    expectedFunctions.length,
    "Prepared function count drifted",
  );
  for (const [index, expected] of expectedFunctions.entries()) {
    const actual = actualFunctions[index];
    assert.equal(
      `${actual.function_name}(${actual.identity_arguments})`,
      expected.identity,
    );
    assert.equal(actual.owner_name, target.ownerRole);
    assert.equal(actual.language_name, "plpgsql");
    assert.equal(actual.function_kind, "f");
    assert.equal(actual.security_definer, true);
    assert.equal(actual.leakproof, false);
    assert.equal(actual.volatility, expected.volatility);
    assert.equal(actual.parallel_safety, expected.parallelSafety);
    assert.deepEqual(actual.function_config, ["search_path=pg_catalog"]);
    assert.equal(actual.source_md5, expected.sourceMd5);
    const expectedGrantees = activationApplied
      ? ENABLED_FUNCTION_GRANTS.get(expected.identity)
      : expected.grantees;
    assert.ok(
      expectedGrantees,
      `Missing function grants for ${expected.identity}`,
    );
    assert.equal(
      actual.runtime_execute,
      expectedGrantees.includes(target.runtimeRole),
    );
    assert.equal(
      actual.worker_execute,
      expectedGrantees.includes(target.workerRole),
    );
    assert.equal(actual.public_execute, false);
    assert.deepEqual(
      actual.nonowner_acl,
      expectedGrantees.map((role) => `${role}:EXECUTE:false`).sort(),
    );
  }
  return Object.freeze({
    state,
    preparationApplied,
    mediaKeyApplied,
    activationApplied,
    forceApplied,
    installedFunctionCount: actualFunctions.length,
    reviewedFunctionCount: expectedFunctions.length,
    activationBlockerCount: requireActivationReady
      ? catalog.activationBlockerCount
      : null,
    rlsEnabled: activationApplied,
    rlsForced: forceApplied,
    rowDataRead: requireActivationReady,
    sanitizedActivationBlockers: requireActivationReady,
    productionChanged: false,
  });
}

export async function runAccountDeletionInspection(config, expectation) {
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name:
      "grainline-account-deletion-side-effect-release-inspection",
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const catalog = await readAccountDeletionCatalog(client, expectation, {
      inspectActivationBlockers: config.requireActivationReady,
    });
    let result;
    try {
      result = verifyAccountDeletionCatalog(
        catalog,
        expectation,
        config.acceptedStates,
        config.requireActivationReady,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      open = false;
      throw new AccountDeletionCatalogVerificationError(error, catalog);
    }
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      result,
      catalog,
      transaction: {
        isolation: "repeatable read",
        readOnly: true,
        rolledBack: true,
      },
      retained: {
        catalogMetadataOnly: !config.requireActivationReady,
        rowData: config.requireActivationReady,
        sanitizedActivationBlockers: config.requireActivationReady,
        identifiers: false,
        credentials: false,
        functionBodies: false,
      },
      productionChanged: false,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function buildAccountDeletionFailureEvidence(config, git, error) {
  assert.ok(error instanceof AccountDeletionCatalogVerificationError);
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    status: "failed",
    git,
    mode: "production-owner-catalog-read-only",
    releaseCommit: config.releaseCommit,
    directUrlSha256: config.directUrlSha256,
    failure: error.failure,
    catalog: error.catalog,
    transaction: Object.freeze({
      isolation: "repeatable read",
      readOnly: true,
      rolledBack: true,
    }),
    retained: Object.freeze({
      catalogMetadataOnly: !config.requireActivationReady,
      rowData: config.requireActivationReady,
      sanitizedActivationBlockers: config.requireActivationReady,
      identifiers: false,
      credentials: false,
      functionBodies: false,
    }),
    productionChanged: false,
  });
}

export function writeAccountDeletionInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assert.doesNotMatch(
    serialized,
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:userId|email)"\s*:/iu,
    "Evidence contains private data",
  );
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    "Evidence is not a private regular file",
  );
}

export async function main(env = process.env) {
  let config;
  let git;
  try {
    config = parseAccountDeletionInspectionConfig(env);
    git = assertAccountDeletionInspectionGitState(
      readAccountDeletionInspectionGitState(),
      config.releaseCommit,
    );
    const expectation = buildAccountDeletionPreparationExpectation();
    const evidence = Object.freeze({
      ...(await runAccountDeletionInspection(config, expectation)),
      git,
    });
    writeAccountDeletionInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(
      `${JSON.stringify({ status: evidence.status, result: evidence.result })}\n`,
    );
  } catch (error) {
    if (
      config &&
      git &&
      error instanceof AccountDeletionCatalogVerificationError
    ) {
      try {
        writeAccountDeletionInspectionEvidence(
          config.evidencePath,
          buildAccountDeletionFailureEvidence(config, git, error),
        );
      } catch {}
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write(
      "AccountDeletionSideEffect Production inspection failed closed\n",
    );
    process.exitCode = 1;
  });
}
