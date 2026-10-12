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
export const ACCOUNT_DELETION_ACTIVATION_MIGRATION =
  "20261011180000_enable_account_deletion_side_effect_rls";
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
  prepared: Object.freeze(["prepared"]),
  compatible: Object.freeze(["pending", "prepared"]),
});

export class AccountDeletionCatalogVerificationError extends Error {
  constructor(cause, catalog) {
    super(
      "Production AccountDeletionSideEffect catalog did not match the reviewed preparation contract",
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
  const preparationSql = readFileSync(preparationPath, "utf8");
  const activationSql = readFileSync(activationPath, "utf8");
  return Object.freeze({
    migration: ACCOUNT_DELETION_PREPARATION_MIGRATION,
    checksum: createHash("sha256").update(preparationSql, "utf8").digest("hex"),
    activation: Object.freeze({
      migration: ACCOUNT_DELETION_ACTIVATION_MIGRATION,
      checksum: createHash("sha256")
        .update(activationSql, "utf8")
        .digest("hex"),
    }),
    functions: Object.freeze(
      [...FUNCTION_GRANTS.keys()].map((identity) =>
        sourceFunctionContract(preparationSql, identity),
      ),
    ),
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

export async function readAccountDeletionCatalog(client, expectation) {
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
    [[expectation.migration, expectation.activation.migration]],
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
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text AS identity_arguments,
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
  });
}

export function verifyAccountDeletionCatalog(
  catalog,
  expectation,
  acceptedStates = EXPECTED_STATES.compatible,
) {
  const target = REVIEWED_ACCOUNT_DELETION_TARGET;
  const preparationRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.migration,
  );
  const activationRows = catalog.migrations.filter(
    (row) => row.migration_name === expectation.activation.migration,
  );
  assert.ok(preparationRows.length <= 1 && activationRows.length <= 1);
  assert.equal(
    activationRows.length,
    0,
    "Activation migration must remain unapplied at the preparation boundary",
  );
  const prepared = preparationRows.length === 1;
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
    worker_schema_acl: prepared ? ["USAGE:false"] : [],
    worker_unreviewed_membership: false,
  });
  const state = prepared ? "prepared" : "pending";
  assert.ok(
    acceptedStates.includes(state),
    "Installed state is outside the reviewed boundary",
  );
  if (prepared)
    assert.deepEqual(preparationRows[0], {
      migration_name: expectation.migration,
      checksum: expectation.checksum,
      finished: true,
      rolled_back: false,
      applied_steps_count: "1",
    });
  assert.deepEqual(catalog.table, {
    table_name: "AccountDeletionSideEffect",
    owner_name: target.ownerRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    runtime_other: false,
    worker_select: prepared,
    worker_insert: prepared,
    worker_update: prepared,
    worker_delete: prepared,
    worker_other: false,
    worker_explicit_column_authority: false,
    public_column_authority: false,
    public_table_authority: false,
  });
  if (prepared) {
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
  const expectedFunctions = prepared
    ? [...expectation.functions].sort((a, b) =>
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
    assert.equal(
      actual.runtime_execute,
      expected.grantees.includes(target.runtimeRole),
    );
    assert.equal(
      actual.worker_execute,
      expected.grantees.includes(target.workerRole),
    );
    assert.equal(actual.public_execute, false);
    assert.deepEqual(
      actual.nonowner_acl,
      expected.grantees.map((role) => `${role}:EXECUTE:false`).sort(),
    );
  }
  return Object.freeze({
    state,
    preparationApplied: prepared,
    activationApplied: false,
    installedFunctionCount: actualFunctions.length,
    reviewedFunctionCount: expectation.functions.length,
    rlsEnabled: false,
    rlsForced: false,
    rowDataRead: false,
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
      "grainline-account-deletion-side-effect-production-inspection",
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const catalog = await readAccountDeletionCatalog(client, expectation);
    let result;
    try {
      result = verifyAccountDeletionCatalog(
        catalog,
        expectation,
        config.acceptedStates,
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
        catalogMetadataOnly: true,
        rowData: false,
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
      catalogMetadataOnly: true,
      rowData: false,
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
