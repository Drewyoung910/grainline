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
  orderPaymentSignedRefundIdentityFunctionSource,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/u;
const EVIDENCE_PREFIX =
  "order-payment-signed-refund-identity-production-postflight-";
const FUNCTION_IDENTITY =
  "grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)";

export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-payment-signed-refund-identity-read-only";

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

export function parseOrderPaymentSignedRefundIdentityPostflightConfig(
  env = process.env,
  {
    assertRuntimeDatabaseIsolation = assertVercelRuntimeDatabaseIsolation,
  } = {},
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Signed-refund identity production postflight",
  );
  if (
    env.ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRM
      !== ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("Signed-refund identity postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Signed-refund identity postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Signed-refund identity postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("Signed-refund identity release commit is invalid");
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
    "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("Signed-refund identity evidence path is not fresh and exact");
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readOrderPaymentSignedRefundIdentityPostflightGitState(
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

export function assertOrderPaymentSignedRefundIdentityPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Signed-refund identity postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT signed_refund_identity_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT signed_refund_identity_expected_failure");
  await client.query("RELEASE SAVEPOINT signed_refund_identity_expected_failure");
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function verifyOrderPaymentSignedRefundIdentityRuntimeIdentity(
  client,
  expected,
  migrationRole = MIGRATION_ROLE,
) {
  const rows = (await client.query(`
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
  `, [migrationRole])).rows;
  assert.deepEqual(rows, [{
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

export async function proveOrderPaymentSignedRefundIdentityRuntimeCatalog(
  client,
  migrationRole = MIGRATION_ROLE,
  root = process.cwd(),
) {
  verifyOrderPaymentSignedRefundIdentityMigrationBytes(root);
  const relationRows = (await client.query(`
    SELECT
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = relation.oid) AS policy_count,
      ARRAY(
        SELECT pg_catalog.upper(acl.privilege_type)
          FROM pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
         )
         ORDER BY 1
      ) AS runtime_privileges,
      ARRAY(
        SELECT pg_catalog.upper(acl.privilege_type)
          FROM pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
         ) AND acl.is_grantable
         ORDER BY 1
      ) AS runtime_grant_options,
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
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = relation.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped) AS column_acl_count
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'OrderPaymentEvent'
      AND relation.relkind = 'r'
  `)).rows;
  assert.deepEqual(relationRows, [{
    owner_name: migrationRole,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    runtime_grant_options: [],
    public_has_crud: false,
    column_acl_count: 0,
  }]);

  const functionRows = (await client.query(`
    SELECT
      procedure.proname || '(' || pg_catalog.replace(
        pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
      ) || ')' AS identity,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.prokind AS function_kind,
      language.lanname AS language_name,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_safety,
      procedure.proleakproof AS leakproof,
      procedure.proconfig AS config,
      procedure.prosrc AS function_source,
      pg_catalog.has_function_privilege(CURRENT_USER, procedure.oid, 'EXECUTE')
        AS runtime_can_execute,
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
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND procedure.oid = pg_catalog.to_regprocedure($1)
  `, [`public.${FUNCTION_IDENTITY}`])).rows;
  assert.equal(functionRows.length, 1, "signed-refund function cardinality drifted");
  const functionRow = functionRows[0];
  assert.equal(functionRow.identity, FUNCTION_IDENTITY);
  assert.equal(functionRow.owner_name, migrationRole);
  assert.equal(functionRow.security_definer, true);
  assert.equal(functionRow.function_kind, "f");
  assert.equal(functionRow.language_name, "plpgsql");
  assert.equal(functionRow.volatility, "v");
  assert.equal(functionRow.parallel_safety, "u");
  assert.equal(functionRow.leakproof, false);
  assert.deepEqual(functionRow.config, ["search_path=pg_catalog"]);
  assert.equal(functionRow.runtime_can_execute, true);
  assert.equal(functionRow.public_can_execute, false);
  assert.equal(functionRow.invalid_acl_count, 0);
  assert.equal(
    sha256(functionRow.function_source ?? ""),
    sha256(orderPaymentSignedRefundIdentityFunctionSource(root)),
    "signed-refund function body drifted",
  );
  return Object.freeze({ functionCount: 1 });
}

export async function proveOrderPaymentSignedRefundIdentityRuntimeBoundaries(
  client,
) {
  const directRead = await client.query(
    'SELECT pg_catalog.count(*)::integer AS count FROM public."OrderPaymentEvent" WHERE false',
  );
  assert.deepEqual(directRead.rows, [{ count: 0 }]);
  await expectSqlState(
    client,
    () => client.query(`
      SELECT * FROM public.grainline_order_payment_signed_refund_apply(
        'signed-refund-postflight-absent-event',
        1,
        'ch_signed_refund_postflight_absent',
        pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint,
        100,
        'usd',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
      )
    `),
    "25006",
    "signed-refund fixed function read-only lock fence",
  );
}

export async function runOrderPaymentSignedRefundIdentityPostflight(config) {
  const git = assertOrderPaymentSignedRefundIdentityPostflightGitState(
    readOrderPaymentSignedRefundIdentityPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-signed-refund-identity-postflight",
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
    await verifyOrderPaymentSignedRefundIdentityRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    const catalog = await proveOrderPaymentSignedRefundIdentityRuntimeCatalog(
      client,
    );
    await proveOrderPaymentSignedRefundIdentityRuntimeBoundaries(client);
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "order-payment-signed-refund-identity-production-postflight",
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
        functionCount: catalog.functionCount,
        exactCandidateFunctionSource: true,
        orderPaymentEventPredecessorCrudRetained: true,
        orderPaymentEventRlsEnabled: false,
        runtimeFunctionExecuteOnly: true,
        postflightReadOnly: true,
        publicOrUnreviewedAuthority: false,
        productionChangedByPostflight: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "exact_signed_refund_function_source_and_acl",
          "order_payment_event_predecessor_crud_and_rls_off",
          "predecessor_direct_empty_read_succeeds",
          "signed_refund_function_reaches_read_only_lock_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeOrderPaymentSignedRefundIdentityPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeOrderPaymentSignedRefundIdentityPostflightEvidence(
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
    throw new Error("Signed-refund identity evidence is not mode 0600");
  }
}

async function main() {
  try {
    const config = parseOrderPaymentSignedRefundIdentityPostflightConfig();
    const evidence = await runOrderPaymentSignedRefundIdentityPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `Signed-refund identity production postflight failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
