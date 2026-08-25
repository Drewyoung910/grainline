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
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS,
  orderPaymentEventCompatibleFunctionSources,
} from "./verify-order-payment-event-compatible-production-scope.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/u;
const EVIDENCE_PREFIX =
  "order-payment-event-compatible-production-postflight-";
const PRIVATE_FUNCTION_IDENTITIES = new Set([
  "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_order_refund_reconciliation_immutable()",
]);

export const ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-payment-compatible-runtime-read-only";

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
    throw new Error(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe positive integer`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderPaymentEventCompatiblePostflightConfig(
  env = process.env,
  {
    assertRuntimeDatabaseIsolation = assertVercelRuntimeDatabaseIsolation,
  } = {},
) {
  assertDeterministicPostgresEnvironment(
    env,
    "OrderPaymentEvent compatible production postflight",
  );
  if (
    env.ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRM
      !== ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("OrderPaymentEvent compatible postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent compatible postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent compatible postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("OrderPaymentEvent compatible release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(
    env,
    "ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "OrderPaymentEvent compatible evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readOrderPaymentEventCompatiblePostflightGitState(
  cwd = process.cwd(),
) {
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

export function assertOrderPaymentEventCompatiblePostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "OrderPaymentEvent compatible postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT order_payment_compatible_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT order_payment_compatible_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT order_payment_compatible_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
  return caught;
}

export async function verifyOrderPaymentEventCompatibleRuntimeIdentity(
  client,
  expected,
  migrationRole = MIGRATION_ROLE,
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
      role.rolcreatedb,
      role.rolcreaterole,
      role.rolreplication,
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
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    member_of_owner: false,
  }]);
}

async function readRelationPosture(client, relationName) {
  const rows = (await client.query(`
    SELECT
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = relation.oid) AS policy_count,
      pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, 'SELECT')
        AS runtime_can_select,
      pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, 'INSERT')
        AS runtime_can_insert,
      pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, 'UPDATE')
        AS runtime_can_update,
      pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, 'DELETE')
        AS runtime_can_delete,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
        ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = ANY(
            ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]
          )
      ) AS public_has_crud,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
         ) AS acl
        WHERE acl.grantee NOT IN (
          relation.relowner,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
        )
           OR (
             acl.grantee = (
               SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
             )
             AND (
               acl.privilege_type <> ALL(
                 ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]
               )
               OR acl.grantor <> relation.relowner
               OR acl.is_grantable
             )
           )) AS invalid_table_acl_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = relation.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped) AS column_acl_count
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = $1
      AND relation.relkind = 'r'
  `, [relationName])).rows;
  assert.equal(rows.length, 1, `${relationName} relation is not exact`);
  return rows[0];
}

export async function proveOrderPaymentEventCompatibleRuntimeCatalog(
  client,
  migrationRole = MIGRATION_ROLE,
  root = process.cwd(),
) {
  const payment = await readRelationPosture(client, "OrderPaymentEvent");
  assert.deepEqual(payment, {
    owner_name: migrationRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_can_select: true,
    runtime_can_insert: true,
    runtime_can_update: true,
    runtime_can_delete: true,
    public_has_crud: false,
    invalid_table_acl_count: 0,
    column_acl_count: 0,
  });

  const reconciliation = await readRelationPosture(
    client,
    "OrderRefundReconciliation",
  );
  assert.deepEqual(reconciliation, {
    owner_name: migrationRole,
    rls_enabled: true,
    rls_forced: true,
    policy_count: 0,
    runtime_can_select: false,
    runtime_can_insert: false,
    runtime_can_update: false,
    runtime_can_delete: false,
    public_has_crud: false,
    invalid_table_acl_count: 0,
    column_acl_count: 0,
  });

  const expectedSources = orderPaymentEventCompatibleFunctionSources(root);
  const expected = Object.entries(expectedSources);
  const functionNames = [...new Set(expected.map(([identity]) =>
    identity.slice(0, identity.indexOf("("))
  ))];
  const functions = (await client.query(`
    SELECT
      procedure.proname || '(' || pg_catalog.replace(
        pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
      ) || ')' AS identity,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.prokind AS function_kind,
      procedure.proleakproof AS leakproof,
      procedure.proconfig AS config,
      procedure.prosrc AS function_source,
      pg_catalog.has_function_privilege(
        CURRENT_USER, procedure.oid, 'EXECUTE'
      ) AS runtime_can_execute,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) AS acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ) AS public_can_execute,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl
        WHERE acl.privilege_type <> 'EXECUTE'
           OR acl.grantee = 0
           OR acl.grantee NOT IN (
             procedure.proowner,
             (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
           )
           OR (
             acl.grantee = (
               SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
             )
             AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
           )) AS invalid_acl_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY($1::text[])
    ORDER BY identity
  `, [functionNames])).rows;
  assert.equal(functions.length, expected.length, "function count drifted");
  functions.forEach((entry, index) => {
    const [identity, source] = expected[index];
    assert.equal(entry.identity, identity, "function identity drifted");
    assert.equal(entry.owner_name, migrationRole, `${identity} owner drifted`);
    assert.equal(entry.function_kind, "f", `${identity} kind drifted`);
    assert.equal(
      entry.security_definer,
      identity !== "grainline_order_refund_reconciliation_immutable()",
      `${identity} security mode drifted`,
    );
    assert.equal(entry.leakproof, false, `${identity} leakproof drifted`);
    assert.deepEqual(
      entry.config,
      ["search_path=pg_catalog"],
      `${identity} search_path drifted`,
    );
    assert.equal(
      entry.runtime_can_execute,
      !PRIVATE_FUNCTION_IDENTITIES.has(identity),
      `${identity} runtime EXECUTE drifted`,
    );
    assert.equal(entry.public_can_execute, false, `${identity} PUBLIC drifted`);
    assert.equal(entry.invalid_acl_count, 0, `${identity} ACL drifted`);
    assert.equal(
      sha256(entry.function_source ?? ""),
      sha256(source),
      `${identity} body drifted`,
    );
  });
  return Object.freeze({ functionCount: functions.length });
}

export async function proveOrderPaymentEventCompatibleRuntimeBoundaries(client) {
  const predecessorRead = await client.query(
    'SELECT pg_catalog.count(*)::integer AS count FROM public."OrderPaymentEvent" WHERE false',
  );
  assert.deepEqual(predecessorRead.rows, [{ count: 0 }]);

  await expectSqlState(
    client,
    () => client.query(
      'SELECT id FROM public."OrderRefundReconciliation" LIMIT 1',
    ),
    "42501",
    "private reconciliation table read",
  );
  await expectSqlState(
    client,
    () => client.query(`
      SELECT public.grainline_blocked_checkout_refund_record_core(
        NULL::text,
        NULL::bigint,
        NULL::text,
        NULL::bigint,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::integer
      )
    `),
    "42501",
    "private refund-record core execute",
  );
  const invalidActor = await expectSqlState(
    client,
    () => client.query(`
      SELECT public.grainline_seller_refund_claim(
        'order-payment-compatible-postflight-absent-actor',
        'order-payment-compatible-postflight-absent-order'
      )
    `),
    "P0001",
    "fixed seller refund claim",
  );
  assert.match(
    invalidActor.message,
    /seller refund actor (?:does not exist|is not active)/iu,
    "fixed seller refund claim did not reach its source validation",
  );
}

export async function runOrderPaymentEventCompatiblePostflight(config) {
  const git = assertOrderPaymentEventCompatiblePostflightGitState(
    readOrderPaymentEventCompatiblePostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-payment-compatible-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.databaseUrl)),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await verifyOrderPaymentEventCompatibleRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    const catalog = await proveOrderPaymentEventCompatibleRuntimeCatalog(client);
    await proveOrderPaymentEventCompatibleRuntimeBoundaries(client);
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "order-payment-event-compatible-production-postflight",
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      target: Object.freeze({
        databaseName: config.runtimeIdentity.databaseName,
        databaseUrlSha256: config.databaseUrlSha256,
        endpointId: config.runtimeIdentity.endpointId,
        region: config.runtimeIdentity.region,
        role: config.runtimeIdentity.runtimeRole,
      }),
      runs: Object.freeze({
        mainCiRunId: config.mainCiRunId,
        migrationRunId: config.migrationRunId,
      }),
      proof: Object.freeze({
        compatibleMigrationCount: ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length,
        functionCount: catalog.functionCount,
        orderPaymentEventPredecessorCrudRetained: true,
        orderPaymentEventRlsEnabled: false,
        orderRefundReconciliationPolicyCount: 0,
        orderRefundReconciliationRlsEnabled: true,
        orderRefundReconciliationRlsForced: true,
        postflightReadOnly: true,
        publicOrUnreviewedAuthority: false,
        productionChangedByPostflight: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "order_payment_event_predecessor_crud_and_rls_off",
          "order_refund_reconciliation_policyless_enable_force",
          "exact_migration_derived_function_bodies_and_acls",
          "predecessor_direct_read_succeeds",
          "private_reconciliation_direct_read_denied",
          "private_refund_record_core_execute_denied",
          "fixed_seller_refund_claim_reaches_source_validation",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeOrderPaymentEventCompatiblePostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeOrderPaymentEventCompatiblePostflightEvidence(
  pathname,
  evidence,
) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("OrderPaymentEvent compatible evidence is not mode 0600");
  }
}

async function main() {
  try {
    const config = parseOrderPaymentEventCompatiblePostflightConfig();
    const evidence = await runOrderPaymentEventCompatiblePostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent compatible production postflight failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
