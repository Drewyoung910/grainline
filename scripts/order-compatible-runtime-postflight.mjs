#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS,
  ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS,
  ORDER_STAFF_READ_AUTHORITY_FUNCTIONS,
} from "./order-participant-list-authority-catalog.mjs";
import {
  ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
} from "./order-compatible-production-catalog.mjs";
import {
  ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS,
} from "./order-fulfillment-authority-catalog.mjs";
import {
  ORDER_LABEL_AUTHORITY_FUNCTIONS,
  ORDER_LABEL_PRIVATE_FUNCTIONS,
} from "./order-label-authority-catalog.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-compatible-runtime-read-only";
const EVIDENCE_PREFIX = "order-compatible-runtime-postflight-";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const REVIEWED_MIGRATION_ROLE = "neondb_owner";

function withoutFirst(values) {
  return values.slice(1);
}

export const ORDER_COMPATIBLE_RUNTIME_FUNCTIONS = Object.freeze([
  ...ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS,
  ...ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS,
  ...ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS,
  ...ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS,
  ...ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS,
  ...ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS,
  ...withoutFirst(ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS),
  ...ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS,
  ...ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS,
  ...ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS,
  ...ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS,
  ...ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS,
  ...ORDER_LABEL_AUTHORITY_FUNCTIONS,
]);

export const ORDER_COMPATIBLE_PRIVATE_FUNCTIONS = Object.freeze([
  ...ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS,
  ...ORDER_STAFF_READ_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS[0],
  ...ORDER_LABEL_PRIVATE_FUNCTIONS,
  'grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  return value;
}

export function parseOrderCompatibleRuntimePostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Order compatible runtime production postflight",
  );
  if (
    env.ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRM
      !== ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("Order compatible runtime confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Order compatible runtime postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Order compatible runtime postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("Order compatible runtime release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeGuard = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(
    required(env, "ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_EVIDENCE_PATH"),
  );
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "Order compatible runtime evidence path is not fresh and exact",
    );
  }
  return Object.freeze({
    databaseUrl,
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRole: REVIEWED_MIGRATION_ROLE,
    migrationRunId: positiveInteger(
      env,
      "ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeGuard,
  });
}

export function readOrderCompatibleRuntimeGitState(cwd = process.cwd()) {
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

export function assertOrderCompatibleRuntimeGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Order compatible runtime postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

function functionName(identity) {
  return identity.slice(0, identity.indexOf("("));
}

export function orderCompatibleFunctionSourceSha256(root = process.cwd()) {
  const expectedNames = new Set([
    ...ORDER_COMPATIBLE_RUNTIME_FUNCTIONS,
    ...ORDER_COMPATIBLE_PRIVATE_FUNCTIONS,
  ].map(functionName));
  const sources = new Map();
  for (const migration of ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS) {
    const migrationPath = path.join(
      root,
      "prisma",
      "migrations",
      migration.name,
      "migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    assert.equal(
      checksum,
      migration.checksum,
      `${migration.name} bytes drifted`,
    );
    const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/g;
    for (const match of sql.matchAll(pattern)) {
      if (expectedNames.has(match[1])) sources.set(match[1], match[4]);
    }
  }
  const missing = [...expectedNames].filter((name) => !sources.has(name));
  if (missing.length > 0 || sources.size !== expectedNames.size) {
    throw new Error(
      `Order compatible function source catalog drifted: ${missing.join(",") || "unexpected source"}`,
    );
  }
  return Object.freeze(Object.fromEntries(
    [...sources].map(([name, source]) => [
      name,
      createHash("sha256").update(source).digest("hex"),
    ]),
  ));
}

export async function verifyOrderCompatibleRuntimeIdentity(
  client,
  expected,
  migrationRole,
) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin,
      pg_catalog.pg_has_role(CURRENT_USER, $1, 'MEMBER') AS member_of_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `, [migrationRole]);
  assert.deepEqual(result.rows, [{
    database_name: expected.databaseName,
    current_user_name: expected.runtimeRole,
    session_user_name: expected.runtimeRole,
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    member_of_owner: false,
  }]);
}

export async function verifyOrderCompatibleReadOnlyTransaction(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(result.rows, [{
    isolation: "repeatable read",
    read_only: "on",
  }]);
}

export async function verifyOrderCompatibleTablePosture(
  client,
  migrationRole,
) {
  const result = await client.query(`
    SELECT
      pg_catalog.pg_get_userbyid(table_class.relowner) AS owner_name,
      table_class.relrowsecurity AS rls_enabled,
      table_class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = table_class.oid) AS policy_count,
      pg_catalog.has_table_privilege(CURRENT_USER, table_class.oid, 'SELECT')
        AS can_select,
      pg_catalog.has_table_privilege(CURRENT_USER, table_class.oid, 'INSERT')
        AS can_insert,
      pg_catalog.has_table_privilege(CURRENT_USER, table_class.oid, 'UPDATE')
        AS can_update,
      pg_catalog.has_table_privilege(CURRENT_USER, table_class.oid, 'DELETE')
        AS can_delete,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              table_class.relacl,
              pg_catalog.acldefault('r', table_class.relowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      ) AS public_has_crud
    FROM pg_catalog.pg_class AS table_class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_class.relname = 'Order'
  `);
  assert.deepEqual(result.rows, [{
    owner_name: migrationRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    can_select: true,
    can_insert: true,
    can_update: true,
    can_delete: true,
    public_has_crud: false,
  }]);
}

export async function verifyOrderCompatibleFunctionCatalog(
  client,
  migrationRole,
  root = process.cwd(),
) {
  const expected = new Map([
    ...ORDER_COMPATIBLE_RUNTIME_FUNCTIONS.map((identity) => [identity, true]),
    ...ORDER_COMPATIBLE_PRIVATE_FUNCTIONS.map((identity) => [identity, false]),
  ]);
  assert.equal(expected.size, 48, "Order compatible function count drifted");
  const sourceHashes = orderCompatibleFunctionSourceSha256(root);
  const result = await client.query(`
    WITH expected(identity, runtime_execute) AS (
      SELECT * FROM unnest($1::text[], $2::boolean[])
    ), resolved AS (
      SELECT
        expected.identity,
        expected.runtime_execute,
        pg_catalog.to_regprocedure('public.' || expected.identity) AS oid
      FROM expected
    )
    SELECT
      resolved.identity,
      resolved.runtime_execute AS expected_runtime_execute,
      procedure.oid IS NOT NULL AS exists,
      procedure.proname AS function_name,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.prokind AS function_kind,
      procedure.proconfig AS function_config,
      procedure.prosrc AS function_source,
      pg_catalog.has_function_privilege(
        CURRENT_USER, procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = CURRENT_USER
         )
           AND acl.privilege_type = 'EXECUTE'
      ) AS runtime_direct_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
      ,(SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND (
             acl.grantee NOT IN (
               procedure.proowner,
               (SELECT role.oid
                  FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = CURRENT_USER)
             )
             OR (
               acl.grantee = (
                 SELECT role.oid
                   FROM pg_catalog.pg_roles AS role
                  WHERE role.rolname = CURRENT_USER
               )
               AND (
                 acl.grantor <> procedure.proowner
                 OR acl.is_grantable
               )
             )
           )) AS invalid_acl_count
    FROM resolved
    LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.oid
    ORDER BY resolved.identity
  `, [[...expected.keys()], [...expected.values()]]);
  assert.equal(result.rows.length, expected.size);
  for (const row of result.rows) {
    const shouldExecute = expected.get(row.identity);
    assert.notEqual(shouldExecute, undefined, row.identity);
    assert.equal(row.exists, true, row.identity);
    assert.equal(row.owner_name, migrationRole, row.identity);
    assert.equal(row.security_definer, true, row.identity);
    assert.equal(row.leakproof, false, row.identity);
    assert.equal(row.function_kind, "f", row.identity);
    assert.deepEqual(row.function_config, ["search_path=pg_catalog"], row.identity);
    assert.equal(row.runtime_execute, shouldExecute, row.identity);
    assert.equal(row.runtime_direct_execute, shouldExecute, row.identity);
    assert.equal(row.public_execute, false, row.identity);
    assert.equal(row.invalid_acl_count, 0, row.identity);
    assert.equal(
      createHash("sha256").update(row.function_source).digest("hex"),
      sourceHashes[row.function_name],
      `${row.identity} source drifted`,
    );
  }
}

export async function proveOrderCompatibleActorIsolation(client) {
  const marker = `order-compatible-runtime-postflight-absent-${Date.now()}`;
  const checks = [
    [
      "buyer_count",
      "SELECT public.grainline_order_buyer_count($1) = 0 AS passed",
    ],
    [
      "seller_count",
      "SELECT public.grainline_order_seller_count($1) = 0 AS passed",
    ],
    [
      "buyer_page",
      `SELECT NOT EXISTS (
         SELECT 1
           FROM public.grainline_order_buyer_page($1, 1, NULL, NULL)
       ) AS passed`,
    ],
    [
      "seller_page",
      `SELECT NOT EXISTS (
         SELECT 1
           FROM public.grainline_order_seller_page($1, 1, NULL, NULL)
       ) AS passed`,
    ],
    [
      "buyer_detail_v3",
      `WITH sample_order AS (
         SELECT orders.id FROM public."Order" AS orders
          ORDER BY orders.id LIMIT 1
       )
       SELECT NOT EXISTS (
         SELECT 1 FROM sample_order
         CROSS JOIN LATERAL public.grainline_order_buyer_detail_v3(
           $1, sample_order.id
         )
       ) AS passed`,
    ],
    [
      "seller_detail_v4",
      `WITH sample_order AS (
         SELECT orders.id FROM public."Order" AS orders
          ORDER BY orders.id LIMIT 1
       )
       SELECT NOT EXISTS (
         SELECT 1 FROM sample_order
         CROSS JOIN LATERAL public.grainline_order_seller_detail_v4(
           $1, sample_order.id
         )
       ) AS passed`,
    ],
  ];
  for (const [name, sql] of checks) {
    let result;
    try {
      result = await client.query(sql, [marker]);
    } catch (error) {
      throw new Error(
        `Order compatible actor-isolation check ${name} failed: ${
          error instanceof Error ? error.message : "unknown PostgreSQL error"
        }`,
        { cause: error },
      );
    }
    assert.deepEqual(result.rows, [{ passed: true }], name);
  }
}

export async function proveOrderCompatiblePrivateExecuteDenied(client) {
  await client.query("SAVEPOINT order_compatible_private_denial");
  let caught;
  try {
    await client.query(`
      SELECT *
        FROM public.grainline_order_staff_detail(
          'order-compatible-postflight-absent-staff',
          'order-compatible-postflight-absent-order'
        )
    `);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT order_compatible_private_denial");
  await client.query("RELEASE SAVEPOINT order_compatible_private_denial");
  assert.equal(caught?.code, "42501");
}

export async function runOrderCompatibleRuntimePostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-compatible-runtime-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await verifyOrderCompatibleReadOnlyTransaction(client);
    await verifyOrderCompatibleRuntimeIdentity(
      client,
      config.runtimeGuard,
      config.migrationRole,
    );
    await verifyOrderCompatibleTablePosture(client, config.migrationRole);
    await verifyOrderCompatibleFunctionCatalog(
      client,
      config.migrationRole,
      config.root,
    );
    await proveOrderCompatibleActorIsolation(client);
    await proveOrderCompatiblePrivateExecuteDenied(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      mainCiRunId: config.mainCiRunId,
      migrationRunId: config.migrationRunId,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      orderRlsEnabled: false,
      orderRlsForced: false,
      orderPolicyCount: 0,
      predecessorCrudRetained: true,
      runtimeFunctionCount: ORDER_COMPATIBLE_RUNTIME_FUNCTIONS.length,
      privateFunctionCount: ORDER_COMPATIBLE_PRIVATE_FUNCTIONS.length,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "engine_attested_repeatable_read_read_only_transaction",
        "actual_pooled_runtime_role_identity",
        "compatible_order_predecessor_table_posture",
        "exact_48_function_source_and_acl_catalog",
        "absent_actor_list_and_detail_isolation",
        "private_staff_projection_execute_denial",
      ],
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeOrderCompatibleRuntimePostflightEvidence(
  evidencePath,
  evidence,
) {
  const handle = openSync(evidencePath, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(evidencePath, 0o600);
}

async function main() {
  try {
    const config = parseOrderCompatibleRuntimePostflightConfig(process.env);
    assertOrderCompatibleRuntimeGitState(
      readOrderCompatibleRuntimeGitState(),
      config.releaseCommit,
    );
    const evidence = await runOrderCompatibleRuntimePostflight({
      ...config,
      root: process.cwd(),
    });
    writeOrderCompatibleRuntimePostflightEvidence(
      config.evidencePath,
      evidence,
    );
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `Order compatible runtime production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
