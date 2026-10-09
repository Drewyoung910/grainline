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

export const CLERK_WEBHOOK_EVENT_MIGRATION =
  "20261008120000_prepare_clerk_webhook_event_authority";
export const CLERK_WEBHOOK_EVENT_INSPECTION_CONFIRMATION =
  "inspect-reviewed-clerk-webhook-event-authority";
export const REVIEWED_CLERK_WEBHOOK_EVENT_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXPECTED_STATES = Object.freeze({
  pending: Object.freeze(["pending"]),
  complete: Object.freeze(["complete"]),
  compatible: Object.freeze(["pending", "complete"]),
});
const FUNCTION_IDENTITIES = Object.freeze([
  "grainline_clerk_webhook_begin(text, text)",
  "grainline_clerk_webhook_complete(text, bigint)",
  "grainline_clerk_webhook_fail(text, bigint, text)",
  "grainline_clerk_webhook_health_summary()",
  "grainline_clerk_webhook_prune_batch(integer)",
]);

export class ClerkWebhookEventCatalogVerificationError extends Error {
  constructor(cause, catalog) {
    super("Production ClerkWebhookEvent catalog did not match the reviewed contract");
    this.name = "ClerkWebhookEventCatalogVerificationError";
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

function sourceFunctionContract(sql, identity) {
  const parsed = parseIdentity(identity);
  const start = sql.search(new RegExp(
    `CREATE FUNCTION public\\.${escapeRegularExpression(parsed.name)}\\s*\\(`,
    "u",
  ));
  assert.ok(start >= 0, `${identity} is absent from its reviewed migration`);
  const remainder = sql.slice(start);
  const bodyMatch = remainder.match(
    /\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1\s*;/u,
  );
  assert.ok(bodyMatch, `${identity} has no parseable dollar-quoted body`);
  const header = remainder.slice(0, bodyMatch.index);
  assert.match(header, /\bLANGUAGE\s+plpgsql\b/iu);
  assert.match(header, /\bSECURITY\s+DEFINER\b/iu);
  assert.match(header, /\bSET\s+search_path\s*=\s*pg_catalog\b/iu);
  return Object.freeze({
    ...parsed,
    identity,
    language: "plpgsql",
    volatility: /\bSTABLE\b/iu.test(header) ? "s" : /\bIMMUTABLE\b/iu.test(header) ? "i" : "v",
    parallelSafety: /\bPARALLEL\s+SAFE\b/iu.test(header) ? "s" : /\bPARALLEL\s+RESTRICTED\b/iu.test(header) ? "r" : "u",
    sourceMd5: createHash("md5").update(bodyMatch[2], "utf8").digest("hex"),
  });
}

export function buildClerkWebhookEventCatalogExpectation(root = process.cwd()) {
  const migrationPath = path.join(
    root,
    "prisma",
    "migrations",
    CLERK_WEBHOOK_EVENT_MIGRATION,
    "migration.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  return Object.freeze({
    migration: CLERK_WEBHOOK_EVENT_MIGRATION,
    checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
    functions: Object.freeze(FUNCTION_IDENTITIES.map((identity) =>
      sourceFunctionContract(sql, identity))),
  });
}

export function parseClerkWebhookEventInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "ClerkWebhookEvent production inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
    || env.GITHUB_RUN_ATTEMPT !== "1"
  ) {
    throw new Error("ClerkWebhookEvent inspection requires a first-attempt manual main dispatch");
  }
  const releaseCommit = required(env, "CLERK_WEBHOOK_EVENT_INSPECT_RELEASE_COMMIT");
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error("ClerkWebhookEvent inspection commit must match dispatched main");
  }
  if (env.CLERK_WEBHOOK_EVENT_INSPECT_CONFIRM !== CLERK_WEBHOOK_EVENT_INSPECTION_CONFIRMATION) {
    throw new Error("ClerkWebhookEvent inspection confirmation is not exact");
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
  const target = REVIEWED_CLERK_WEBHOOK_EVENT_TARGET;
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
  const expectedState = env.CLERK_WEBHOOK_EVENT_EXPECTED_STATE ?? "compatible";
  const acceptedStates = EXPECTED_STATES[expectedState];
  if (!acceptedStates) {
    throw new Error("ClerkWebhookEvent expected state is invalid");
  }
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(required(env, "CLERK_WEBHOOK_EVENT_INSPECT_EVIDENCE_PATH"));
  const expectedPath = path.join(
    runnerTemp,
    `clerk-webhook-event-production-inspection-${releaseCommit}-${expectedState}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error("ClerkWebhookEvent evidence path is not fresh and exact");
  }
  return Object.freeze({
    acceptedStates,
    directUrl,
    directUrlSha256,
    evidencePath,
    expectedState,
    identity,
    mode: "production-owner-catalog-read-only",
    releaseCommit,
  });
}

export function readClerkWebhookEventInspectionGitState(cwd = process.cwd()) {
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

export function assertClerkWebhookEventInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("ClerkWebhookEvent inspection checkout is not exact and clean");
  }
  return Object.freeze({ head: state.head, clean: true });
}

export async function readClerkWebhookEventCatalog(client, expectation) {
  const functionNames = expectation.functions.map(({ name }) => name);
  const [identity, migrations, table, columns, constraints, functions] = await Promise.all([
    client.query(`
      SELECT CURRENT_USER::text AS current_user,
             SESSION_USER::text AS session_user,
             pg_catalog.current_database()::text AS database_name,
             pg_catalog.current_setting('transaction_read_only') AS read_only,
             pg_catalog.current_setting('transaction_isolation') AS isolation,
             owner_role.rolbypassrls AS owner_bypass_rls,
             runtime_role.rolbypassrls AS runtime_bypass_rls,
             runtime_role.rolsuper AS runtime_superuser,
             runtime_role.rolinherit AS runtime_inherit
        FROM pg_catalog.pg_roles AS owner_role
        JOIN pg_catalog.pg_roles AS runtime_role
          ON runtime_role.rolname = 'grainline_app_runtime'
       WHERE owner_role.rolname = CURRENT_USER
    `),
    client.query(`
      SELECT migration_name, checksum,
             finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS rolled_back,
             applied_steps_count::text AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
    `, [expectation.migration]),
    client.query(`
      SELECT class.relname::text AS table_name,
             pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
             class.relrowsecurity AS rls_enabled,
             class.relforcerowsecurity AS rls_forced,
             (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = class.oid) AS policy_count,
             pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS runtime_select,
             pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS runtime_insert,
             pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS runtime_update,
             pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS runtime_delete,
             EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
               COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'SELECT') AS public_select,
             EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
               COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'INSERT') AS public_insert,
             EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
               COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'UPDATE') AS public_update,
             EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
               COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'DELETE') AS public_delete
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = 'ClerkWebhookEvent'
         AND class.relkind = 'r'
    `),
    client.query(`
      SELECT attribute.attname::text AS column_name,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS data_type,
             attribute.attnotnull AS not_null,
             pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)::text AS default_expression
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef AS default_value
          ON default_value.adrelid = attribute.attrelid
         AND default_value.adnum = attribute.attnum
       WHERE namespace.nspname = 'public'
         AND class.relname = 'ClerkWebhookEvent'
         AND attribute.attname = 'claimGeneration'
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    `),
    client.query(`
      SELECT constraint_name.conname::text AS constraint_name,
             constraint_name.contype::text AS constraint_type,
             constraint_name.convalidated AS validated,
             pg_catalog.pg_get_constraintdef(constraint_name.oid, true)::text AS definition
        FROM pg_catalog.pg_constraint AS constraint_name
        JOIN pg_catalog.pg_class AS class ON class.oid = constraint_name.conrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = 'ClerkWebhookEvent'
         AND constraint_name.conname = 'ClerkWebhookEvent_claimGeneration_check'
    `),
    client.query(`
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
             pg_catalog.has_function_privilege('grainline_app_runtime', procedure.oid, 'EXECUTE') AS runtime_execute,
             EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
                WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
             ) AS public_execute,
             ARRAY(
               SELECT pg_catalog.format('%s:%s:%s',
                 CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                      ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
                 acl.privilege_type,
                 CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END)
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
    `, [functionNames]),
  ]);
  if (identity.rows.length !== 1 || table.rows.length !== 1) {
    throw new Error("ClerkWebhookEvent production roles or table are missing or ambiguous");
  }
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    migrations: Object.freeze(migrations.rows.map((row) => Object.freeze(row))),
    table: Object.freeze(table.rows[0]),
    columns: Object.freeze(columns.rows.map((row) => Object.freeze(row))),
    constraints: Object.freeze(constraints.rows.map((row) => Object.freeze(row))),
    functions: Object.freeze(functions.rows.map((row) => Object.freeze({
      ...row,
      function_config: Object.freeze([...(row.function_config ?? [])]),
      nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
    }))),
  });
}

export function verifyClerkWebhookEventCatalog(
  catalog,
  expectation,
  acceptedStates = EXPECTED_STATES.compatible,
) {
  const target = REVIEWED_CLERK_WEBHOOK_EVENT_TARGET;
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
  });
  assert.deepEqual(catalog?.table, {
    table_name: "ClerkWebhookEvent",
    owner_name: target.ownerRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    public_select: false,
    public_insert: false,
    public_update: false,
    public_delete: false,
  });
  assert.ok(Array.isArray(catalog?.migrations) && catalog.migrations.length <= 1);
  const installed = catalog.migrations.length === 1;
  const state = installed ? "complete" : "pending";
  assert.equal(acceptedStates.includes(state), true, "ClerkWebhookEvent state is outside the reviewed release state");
  if (installed) {
    assert.deepEqual(catalog.migrations[0], {
      migration_name: expectation.migration,
      checksum: expectation.checksum,
      finished: true,
      rolled_back: false,
      applied_steps_count: "1",
    });
    assert.equal(catalog.columns.length, 1);
    assert.equal(catalog.columns[0]?.column_name, "claimGeneration");
    assert.equal(catalog.columns[0]?.data_type, "bigint");
    assert.equal(catalog.columns[0]?.not_null, true);
    assert.match(catalog.columns[0]?.default_expression ?? "", /^(?:0|'0'::bigint|0::bigint)$/u);
    assert.deepEqual(catalog.constraints, [{
      constraint_name: "ClerkWebhookEvent_claimGeneration_check",
      constraint_type: "c",
      validated: true,
      definition: catalog.constraints[0]?.definition,
    }]);
    assert.match(
      (catalog.constraints[0]?.definition ?? "").replaceAll(/\s+/gu, " "),
      /^CHECK \(\(?"claimGeneration" >= 0\)?\)$/u,
    );
  } else {
    assert.deepEqual(catalog.columns, []);
    assert.deepEqual(catalog.constraints, []);
  }
  const expectedFunctions = installed ? expectation.functions : [];
  const actualFunctions = [...(catalog?.functions ?? [])].sort((left, right) =>
    `${left.function_name}(${left.identity_arguments})`.localeCompare(
      `${right.function_name}(${right.identity_arguments})`,
    ));
  const sortedExpected = [...expectedFunctions].sort((left, right) =>
    left.identity.localeCompare(right.identity));
  assert.equal(actualFunctions.length, sortedExpected.length, "Installed Clerk webhook function count drifted");
  for (const [index, expected] of sortedExpected.entries()) {
    const actual = actualFunctions[index];
    assert.equal(`${actual?.function_name}(${actual?.identity_arguments})`, expected.identity);
    assert.equal(actual.owner_name, target.ownerRole);
    assert.equal(actual.language_name, expected.language);
    assert.equal(actual.function_kind, "f");
    assert.equal(actual.security_definer, true);
    assert.equal(actual.leakproof, false);
    assert.equal(actual.volatility, expected.volatility);
    assert.equal(actual.parallel_safety, expected.parallelSafety);
    assert.equal(exactArray(actual.function_config, ["search_path=pg_catalog"]), true);
    assert.equal(actual.source_md5, expected.sourceMd5);
    assert.equal(actual.runtime_execute, true);
    assert.equal(actual.public_execute, false);
    assert.equal(exactArray(actual.nonowner_acl, [`${target.runtimeRole}:EXECUTE:false`]), true);
  }
  return Object.freeze({
    state,
    migrationApplied: installed,
    installedFunctionCount: actualFunctions.length,
    reviewedFunctionCount: expectation.functions.length,
    rlsEnabled: false,
    rlsForced: false,
    predecessorRuntimeCrudRetained: true,
    rowDataRead: false,
    productionChanged: false,
  });
}

export async function runClerkWebhookEventInspection(config, expectation) {
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-clerk-webhook-event-production-inspection",
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const catalog = await readClerkWebhookEventCatalog(client, expectation);
    let result;
    try {
      result = verifyClerkWebhookEventCatalog(catalog, expectation, config.acceptedStates);
    } catch (error) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      throw new ClerkWebhookEventCatalogVerificationError(error, catalog);
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

export function buildClerkWebhookEventFailureEvidence(config, git, error) {
  assert.ok(error instanceof ClerkWebhookEventCatalogVerificationError);
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

export function writeClerkWebhookEventInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:clerkId|userId|email|svixId)"\s*:/iu.test(serialized)) {
    throw new Error("ClerkWebhookEvent evidence contains private data");
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
    throw new Error("ClerkWebhookEvent evidence is not a private regular file");
  }
}

async function main() {
  let config;
  let git;
  try {
    config = parseClerkWebhookEventInspectionConfig(process.env);
    git = assertClerkWebhookEventInspectionGitState(
      readClerkWebhookEventInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runClerkWebhookEventInspection(
      config,
      buildClerkWebhookEventCatalogExpectation(),
    );
    const evidence = Object.freeze({ generatedAt: new Date().toISOString(), status: "passed", git, ...result });
    writeClerkWebhookEventInspectionEvidence(config.evidencePath, evidence);
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
    if (config && git && error instanceof ClerkWebhookEventCatalogVerificationError) {
      try {
        writeClerkWebhookEventInspectionEvidence(
          config.evidencePath,
          buildClerkWebhookEventFailureEvidence(config, git, error),
        );
        process.stderr.write("ClerkWebhookEvent production inspection failed closed with sanitized catalog evidence.\n");
      } catch {
        process.stderr.write("ClerkWebhookEvent production inspection failed closed.\n");
      }
    } else {
      process.stderr.write("ClerkWebhookEvent production inspection failed closed.\n");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
