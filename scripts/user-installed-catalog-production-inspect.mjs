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
import {
  USER_AUTHORITY_FUNCTIONS,
  USER_AUTHORITY_GROUPS,
  USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES,
} from "./user-authority-catalog.mjs";

const { Client } = pg;

export const USER_INSTALLED_CATALOG_INSPECTION_CONFIRMATION =
  "inspect-reviewed-user-installed-catalog";

export const REVIEWED_USER_INSTALLED_CATALOG_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
  staffRole: "grainline_staff_read_runtime",
});

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
export const USER_ACCEPTED_PREDECESSOR_MIGRATIONS = Object.freeze([
  "20261003100000_prepare_user_clerk_identity_authority",
  "20261003230000_prepare_user_current_clerk_authorities",
  "20261004000000_prepare_user_clerk_provider_lifecycle",
  "20261004010000_prepare_user_owner_private_authorities",
  "20261004020000_prepare_user_signed_unsubscribe_authorities",
  "20261004030000_prepare_user_email_delivery_authorities",
  "20261004040000_prepare_user_public_member_aggregate",
  "20261004050000_prepare_user_public_seller_state",
]);
export const USER_COMPLETE_AUTHORITY_MIGRATIONS = Object.freeze(
  USER_AUTHORITY_GROUPS.map(({ migration }) => migration),
);
const USER_INSTALLED_PREFIX_MODES = Object.freeze({
  predecessor: Object.freeze([USER_ACCEPTED_PREDECESSOR_MIGRATIONS.length]),
  "successor-progress": Object.freeze(
    Array.from(
      { length: USER_COMPLETE_AUTHORITY_MIGRATIONS.length - USER_ACCEPTED_PREDECESSOR_MIGRATIONS.length + 1 },
      (_, index) => USER_ACCEPTED_PREDECESSOR_MIGRATIONS.length + index,
    ),
  ),
  complete: Object.freeze([USER_COMPLETE_AUTHORITY_MIGRATIONS.length]),
});

export class UserInstalledCatalogVerificationError extends Error {
  constructor(cause, catalog) {
    super("Production User catalog did not match the reviewed source contract");
    this.name = "UserInstalledCatalogVerificationError";
    this.catalog = catalog;
    this.failure = Object.freeze({
      code: "CATALOG_VERIFICATION_REJECTED",
      name: cause instanceof Error ? cause.name : "Error",
      message: cause instanceof Error
        ? String(cause.message).slice(0, 8_000)
        : "Unknown catalog verification failure",
    });
  }
}

function required(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function parseIdentity(identity) {
  const match = identity.match(/^([a-z0-9_]+)\((.*)\)$/u);
  assert.ok(match, `Invalid reviewed function identity: ${identity}`);
  return Object.freeze({ name: match[1], identityArguments: match[2] });
}

function sourceFunctionContract(sql, identity, runtimeExecute) {
  const parsed = parseIdentity(identity);
  const startPattern = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION public\\.${escapeRegularExpression(parsed.name)}\\s*\\(`,
    "u",
  );
  const start = sql.search(startPattern);
  assert.ok(start >= 0, `${identity} is absent from its reviewed migration`);
  const remainder = sql.slice(start);
  const bodyMatch = remainder.match(
    /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1\s*;/u,
  );
  assert.ok(bodyMatch, `${identity} has no parseable dollar-quoted body`);
  const header = remainder.slice(0, bodyMatch.index);
  const language = header.match(/\bLANGUAGE\s+([a-z]+)/iu)?.[1]?.toLowerCase();
  assert.ok(language === "plpgsql" || language === "sql", `${identity} language drifted`);
  assert.match(header, /\bSECURITY\s+DEFINER\b/iu, `${identity} must be SECURITY DEFINER`);
  assert.match(
    header,
    /\bSET\s+search_path\s*=\s*pg_catalog\b/iu,
    `${identity} must pin search_path to pg_catalog`,
  );
  const volatility = /\bIMMUTABLE\b/iu.test(header)
    ? "i"
    : /\bSTABLE\b/iu.test(header) ? "s" : "v";
  const parallelSafety = /\bPARALLEL\s+SAFE\b/iu.test(header)
    ? "s"
    : /\bPARALLEL\s+RESTRICTED\b/iu.test(header) ? "r" : "u";
  const staffExecute = USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES.includes(parsed.name);
  const nonownerAcl = runtimeExecute
    ? [`${REVIEWED_USER_INSTALLED_CATALOG_TARGET.runtimeRole}:EXECUTE:false`]
    : staffExecute
      ? [`${REVIEWED_USER_INSTALLED_CATALOG_TARGET.staffRole}:EXECUTE:false`]
      : [];
  return Object.freeze({
    ...parsed,
    identity,
    language,
    volatility,
    parallelSafety,
    securityDefiner: true,
    functionConfig: Object.freeze(["search_path=pg_catalog"]),
    sourceMd5: createHash("md5").update(bodyMatch[2], "utf8").digest("hex"),
    containsDynamicExecute: /\bEXECUTE\b/iu.test(bodyMatch[2]),
    runtimeExecute,
    staffExecute,
    nonownerAcl: Object.freeze(nonownerAcl),
  });
}

export function buildUserInstalledCatalogExpectation(root = process.cwd()) {
  const groups = USER_AUTHORITY_GROUPS.map((group) => {
    const migrationPath = path.join(
      root,
      "prisma",
      "migrations",
      group.migration,
      "migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");
    return Object.freeze({
      migration: group.migration,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      functions: Object.freeze(group.functions.map((entry) =>
        sourceFunctionContract(sql, entry.identity, entry.runtimeExecute))),
    });
  });
  return Object.freeze({
    groups: Object.freeze(groups),
    functions: Object.freeze(USER_AUTHORITY_FUNCTIONS.map((entry) => {
      const group = [...groups].reverse().find(({ functions }) =>
        functions.some(({ identity }) => identity === entry.identity));
      return group.functions.find(({ identity }) => identity === entry.identity);
    })),
  });
}

export function parseUserInstalledCatalogInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "User installed-catalog production inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
    || env.GITHUB_RUN_ATTEMPT !== "1"
  ) {
    throw new Error("User installed-catalog inspection requires a first-attempt manual main dispatch");
  }
  const releaseCommit = required(env, "USER_INSTALLED_CATALOG_INSPECT_RELEASE_COMMIT");
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error("User installed-catalog inspection commit must match dispatched main");
  }
  if (env.USER_INSTALLED_CATALOG_INSPECT_CONFIRM !== USER_INSTALLED_CATALOG_INSPECTION_CONFIRMATION) {
    throw new Error("User installed-catalog inspection confirmation is not exact");
  }
  for (const forbidden of ["DATABASE_URL", "GRANT_AUDIT_DATABASE_URL"]) {
    if (Object.hasOwn(env, forbidden)) {
      throw new Error(`${forbidden} must remain absent from owner-only inspection`);
    }
  }
  const directUrl = required(env, "DIRECT_URL");
  const expectedDigest = required(env, "PRODUCTION_MIGRATION_DIRECT_URL_SHA256");
  const directUrlSha256 = createHash("sha256").update(directUrl, "utf8").digest("hex");
  if (!SHA256_PATTERN.test(expectedDigest) || expectedDigest !== directUrlSha256) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }
  const target = REVIEWED_USER_INSTALLED_CATALOG_TARGET;
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  if (
    identity.isPooler
    || identity.endpointId !== target.endpointId
    || identity.databaseName !== target.databaseName
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || required(env, "MIGRATION_DB_ROLE") !== target.ownerRole
    || required(env, "RUNTIME_DB_ROLE") !== target.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const prefixMode = env.USER_INSTALLED_CATALOG_EXPECTED_PREFIX ?? "predecessor";
  const acceptedAppliedCounts = USER_INSTALLED_PREFIX_MODES[prefixMode];
  if (!acceptedAppliedCounts) {
    throw new Error("User installed-catalog expected prefix mode is invalid");
  }
  const evidencePath = path.resolve(required(env, "USER_INSTALLED_CATALOG_INSPECT_EVIDENCE_PATH"));
  const evidenceSuffix = prefixMode === "predecessor" ? "" : `-${prefixMode}`;
  const expectedPath = path.join(
    runnerTemp,
    `user-installed-catalog-production-inspection-${releaseCommit}${evidenceSuffix}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error("User installed-catalog evidence path is not fresh and exact");
  }
  return Object.freeze({
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    mode: "production-owner-catalog-read-only",
    prefixMode,
    acceptedAppliedCounts,
    releaseCommit,
  });
}

export function readUserInstalledCatalogInspectionGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertUserInstalledCatalogInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("User installed-catalog inspection checkout is not exact and clean");
  }
  return Object.freeze({ head: state.head, clean: true });
}

export async function readUserInstalledCatalog(client, expectation) {
  const migrationNames = expectation.groups.map(({ migration }) => migration);
  const functionNames = [...new Set(expectation.functions.map(({ name }) => name))];
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner_role.rolbypassrls AS owner_bypass_rls,
           runtime_role.rolbypassrls AS runtime_bypass_rls,
           runtime_role.rolsuper AS runtime_superuser,
           runtime_role.rolinherit AS runtime_inherit,
           staff_role.rolbypassrls AS staff_bypass_rls,
           staff_role.rolsuper AS staff_superuser,
           staff_role.rolinherit AS staff_inherit
      FROM pg_catalog.pg_roles AS owner_role
      JOIN pg_catalog.pg_roles AS runtime_role
        ON runtime_role.rolname = 'grainline_app_runtime'
      JOIN pg_catalog.pg_roles AS staff_role
        ON staff_role.rolname = 'grainline_staff_read_runtime'
     WHERE owner_role.rolname = CURRENT_USER
  `);
  if (identity.rows.length !== 1) {
    throw new Error("User installed-catalog roles are missing or ambiguous");
  }
  const migrations = await client.query(`
    SELECT migration_name,
           checksum,
           finished_at IS NOT NULL AS finished,
           rolled_back_at IS NOT NULL AS rolled_back,
           applied_steps_count::text AS applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name
  `, [migrationNames]);
  const table = await client.query(`
    SELECT class.relname::text AS table_name,
           pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS runtime_select,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS runtime_insert,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS runtime_update,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS runtime_delete,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'SELECT') AS staff_select,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'INSERT') AS staff_insert,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'UPDATE') AS staff_update,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'DELETE') AS staff_delete,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
               ) AS acl
              WHERE acl.grantee <> class.relowner
              ORDER BY 1
           ) AS nonowner_acl,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s:%s',
               attribute.attname,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.pg_attribute AS attribute
               CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
              WHERE attribute.attrelid = class.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
              ORDER BY 1
           ) AS column_acl
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
       AND class.relkind = 'r'
  `);
  if (table.rows.length !== 1) {
    throw new Error("User table is missing or ambiguous");
  }
  const functions = await client.query(`
    SELECT procedure.proname::text AS function_name,
           pg_catalog.oidvectortypes(procedure.proargtypes)::text AS identity_arguments,
           pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
           language.lanname::text AS language_name,
           procedure.prokind AS function_kind,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0 AS contains_dynamic_execute,
           pg_catalog.has_function_privilege('grainline_app_runtime', procedure.oid, 'EXECUTE') AS runtime_execute,
           pg_catalog.has_function_privilege('grainline_staff_read_runtime', procedure.oid, 'EXECUTE') AS staff_execute,
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee <> procedure.proowner
              ORDER BY 1
           ) AS nonowner_acl
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($1::text[])
     ORDER BY procedure.proname, identity_arguments
  `, [functionNames]);
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    migrations: Object.freeze(migrations.rows.map((row) => Object.freeze(row))),
    table: Object.freeze({
      ...table.rows[0],
      nonowner_acl: Object.freeze([...(table.rows[0].nonowner_acl ?? [])]),
      column_acl: Object.freeze([...(table.rows[0].column_acl ?? [])]),
    }),
    functions: Object.freeze(functions.rows.map((row) => Object.freeze({
      ...row,
      function_config: Object.freeze([...(row.function_config ?? [])]),
      nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
    }))),
  });
}

export function verifyUserInstalledCatalog(
  catalog,
  expectation,
  acceptedAppliedCounts = USER_INSTALLED_PREFIX_MODES.predecessor,
) {
  const target = REVIEWED_USER_INSTALLED_CATALOG_TARGET;
  assert.deepEqual(catalog?.identity, {
    current_user: target.ownerRole,
    session_user: target.ownerRole,
    database_name: target.databaseName,
    read_only: "on",
    isolation: "repeatable read",
    owner_bypass_rls: true,
    runtime_bypass_rls: false,
    runtime_superuser: false,
    runtime_inherit: false,
    staff_bypass_rls: false,
    staff_superuser: false,
    staff_inherit: false,
  });
  assert.deepEqual(catalog?.table, {
    table_name: "User",
    owner_name: target.ownerRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    staff_select: false,
    staff_insert: false,
    staff_update: false,
    staff_delete: false,
    nonowner_acl: [
      `${target.runtimeRole}:DELETE:false`,
      `${target.runtimeRole}:INSERT:false`,
      `${target.runtimeRole}:SELECT:false`,
      `${target.runtimeRole}:UPDATE:false`,
    ],
    column_acl: [],
  });

  const actualLedger = new Map();
  for (const row of catalog?.migrations ?? []) {
    if (actualLedger.has(row.migration_name)) {
      throw new Error(`Duplicate User migration ledger row: ${row.migration_name}`);
    }
    actualLedger.set(row.migration_name, row);
  }
  let pendingSeen = false;
  const appliedGroups = [];
  const pendingGroups = [];
  for (const group of expectation.groups) {
    const row = actualLedger.get(group.migration);
    if (!row) {
      pendingSeen = true;
      pendingGroups.push(group);
      continue;
    }
    assert.equal(row.checksum, group.checksum, `${group.migration} checksum drifted`);
    assert.equal(row.finished, true, `${group.migration} is unfinished`);
    assert.equal(row.rolled_back, false, `${group.migration} was rolled back`);
    assert.equal(row.applied_steps_count, "1", `${group.migration} step count drifted`);
    assert.equal(pendingSeen, false, `${group.migration} bypassed a pending predecessor`);
    appliedGroups.push(group);
  }
  assert.equal(actualLedger.size, appliedGroups.length, "Unexpected User ledger rows were returned");
  assert.equal(
    acceptedAppliedCounts.includes(appliedGroups.length),
    true,
    "Production User migration prefix is outside the reviewed release state",
  );
  assert.deepEqual(
    appliedGroups.map(({ migration }) => migration),
    USER_COMPLETE_AUTHORITY_MIGRATIONS.slice(0, appliedGroups.length),
    "Production User migration prefix is not contiguous",
  );

  const expectedFunctions = [...new Map(appliedGroups
    .flatMap(({ functions }) => functions)
    .map((entry) => [entry.identity, entry])).values()]
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const actualFunctions = [...(catalog?.functions ?? [])]
    .sort((left, right) =>
      `${left.function_name}(${left.identity_arguments})`.localeCompare(
        `${right.function_name}(${right.identity_arguments})`,
      ));
  assert.equal(actualFunctions.length, expectedFunctions.length, "Installed User function count drifted");
  for (const [index, expected] of expectedFunctions.entries()) {
    const actual = actualFunctions[index];
    assert.equal(`${actual?.function_name}(${actual?.identity_arguments})`, expected.identity);
    assert.equal(actual.owner_name, target.ownerRole, `${expected.identity} owner drifted`);
    assert.equal(actual.language_name, expected.language, `${expected.identity} language drifted`);
    assert.equal(actual.function_kind, "f", `${expected.identity} kind drifted`);
    assert.equal(actual.security_definer, expected.securityDefiner, `${expected.identity} security drifted`);
    assert.equal(actual.leakproof, false, `${expected.identity} leakproof drifted`);
    assert.equal(actual.volatility, expected.volatility, `${expected.identity} volatility drifted`);
    assert.equal(actual.parallel_safety, expected.parallelSafety, `${expected.identity} parallel safety drifted`);
    assert.equal(exactArray(actual.function_config, expected.functionConfig), true, `${expected.identity} config drifted`);
    assert.equal(actual.source_md5, expected.sourceMd5, `${expected.identity} body drifted`);
    assert.equal(actual.contains_dynamic_execute, expected.containsDynamicExecute, `${expected.identity} EXECUTE posture drifted`);
    assert.equal(actual.runtime_execute, expected.runtimeExecute, `${expected.identity} runtime grant drifted`);
    assert.equal(actual.staff_execute, expected.staffExecute, `${expected.identity} staff grant drifted`);
    assert.equal(actual.public_execute, false, `${expected.identity} is executable by PUBLIC`);
    assert.equal(exactArray(actual.nonowner_acl, expected.nonownerAcl), true, `${expected.identity} ACL drifted`);
  }
  return Object.freeze({
    databaseMode: "owner-catalog-read-only",
    appliedMigrationCount: appliedGroups.length,
    pendingMigrationCount: pendingGroups.length,
    installedFunctionCount: actualFunctions.length,
    reviewedFunctionCount: expectation.functions.length,
    runtimeFunctionCount: expectedFunctions.filter(({ runtimeExecute }) => runtimeExecute).length,
    privateFunctionCount: expectedFunctions.filter(({ runtimeExecute }) => !runtimeExecute).length,
    userRlsEnabled: false,
    userRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    rowDataRead: false,
    productionChanged: false,
  });
}

export async function runUserInstalledCatalogInspection(config, expectation) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-installed-catalog-production-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const catalog = await readUserInstalledCatalog(client, expectation);
    let result;
    try {
      result = verifyUserInstalledCatalog(
        catalog,
        expectation,
        config.acceptedAppliedCounts,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      throw new UserInstalledCatalogVerificationError(error, catalog);
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      result,
      catalog,
      transaction: Object.freeze({ isolation: "repeatable read", readOnly: true, rolledBack: true }),
      retained: Object.freeze({ catalogMetadataOnly: true, rowData: false, identifiers: false, credentials: false, functionBodies: false }),
      productionChanged: false,
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function buildUserInstalledCatalogFailureEvidence(config, git, error) {
  assert.ok(
    error instanceof UserInstalledCatalogVerificationError,
    "Only catalog verification failures may retain inspection metadata",
  );
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    status: "failed",
    git,
    mode: config.mode,
    releaseCommit: config.releaseCommit,
    directUrlSha256: config.directUrlSha256,
    failure: error.failure,
    catalog: error.catalog,
    transaction: Object.freeze({ isolation: "repeatable read", readOnly: true, rolledBack: true }),
    retained: Object.freeze({ catalogMetadataOnly: true, rowData: false, identifiers: false, credentials: false, functionBodies: false }),
    productionChanged: false,
  });
}

export function writeUserInstalledCatalogInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:clerkId|userId|email)"\s*:/iu.test(serialized)) {
    throw new Error("User installed-catalog evidence contains private data");
  }
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("User installed-catalog evidence is not a private regular file");
  }
}

async function main() {
  let config;
  let git;
  try {
    config = parseUserInstalledCatalogInspectionConfig(process.env);
    git = assertUserInstalledCatalogInspectionGitState(
      readUserInstalledCatalogInspectionGitState(),
      config.releaseCommit,
    );
    const expectation = buildUserInstalledCatalogExpectation();
    const result = await runUserInstalledCatalogInspection(config, expectation);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeUserInstalledCatalogInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      result: evidence.result,
      transaction: evidence.transaction,
      retained: evidence.retained,
      productionChanged: evidence.productionChanged,
      evidenceWritten: true,
    })}\n`);
  } catch (error) {
    if (config && git && error instanceof UserInstalledCatalogVerificationError) {
      try {
        writeUserInstalledCatalogInspectionEvidence(
          config.evidencePath,
          buildUserInstalledCatalogFailureEvidence(config, git, error),
        );
        process.stderr.write(
          "User installed-catalog production inspection failed closed with sanitized catalog evidence.\n",
        );
      } catch {
        process.stderr.write("User installed-catalog production inspection failed closed.\n");
      }
    } else {
      process.stderr.write("User installed-catalog production inspection failed closed.\n");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
