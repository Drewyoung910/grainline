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
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  checkoutStockReservationFunctionSourceSha256,
} from "./checkout-stock-reservation-function-source-catalog.mjs";

const { Client } = pg;
export const RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRMATION =
  "verify-production-checkout-stock-reservation-authority-runtime-read-only";
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const EVIDENCE_PREFIX =
  "checkout-stock-reservation-authority-production-postflight-";

const TARGET_CONSTRAINTS = Object.freeze([
  "CheckoutStockReservation_payloadHash_check",
  "CheckoutStockReservation_repairClaim_check",
  "CheckoutStockReservation_repairGeneration_check",
  "CheckoutStockReservation_reservedItems_array_chk",
  "CheckoutStockReservation_status_chk",
  "StripeWebhookEvent_sourceObjectId_check",
]);
const TARGET_INDEXES = Object.freeze([
  "CheckoutStockReservation_active_lock_key",
  "CheckoutStockReservation_buyerId_checkoutGroupId_idx",
  "CheckoutStockReservation_buyerId_createdAt_idx",
  "CheckoutStockReservation_checkoutLockKey_idx",
  "CheckoutStockReservation_pkey",
  "CheckoutStockReservation_repair_claim_idx",
  "CheckoutStockReservation_sellerId_createdAt_idx",
  "CheckoutStockReservation_status_expiresAt_idx",
  "CheckoutStockReservation_stripeSessionId_key",
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
  if (!SAFE_POSITIVE_INTEGER.test(raw)) throw new Error(`${key} is invalid`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${key} is invalid`);
  return value;
}

export function parseReservationAuthorityPostflightConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "CheckoutStockReservation compatible authority production postflight",
  );
  if (
    env.CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRM
      !== RESERVATION_AUTHORITY_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("reservation authority postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  const unreviewedKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (privilegedKeys.length > 0 || unreviewedKeys.length > 0) {
    throw new Error("reservation authority postflight rejects privileged or aliased database keys");
  }
  const releaseCommit = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) throw new Error("release commit is invalid");
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(
    env,
    "CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("reservation authority evidence path is not fresh and exact");
  }
  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: createHash("sha256").update(databaseUrl).digest("hex"),
    evidencePath,
    inspectionRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_INSPECTION_RUN_ID",
    ),
    mainCiRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_AUTHORITY_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readReservationAuthorityPostflightGitState(cwd = process.cwd()) {
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

export function assertReservationAuthorityPostflightGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("reservation authority postflight requires the exact clean release commit");
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT reservation_authority_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT reservation_authority_expected_failure");
  await client.query("RELEASE SAVEPOINT reservation_authority_expected_failure");
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function verifyReservationAuthorityRuntimeIdentity(
  client,
  expected,
  migrationRole = MIGRATION_ROLE,
  expectedSessionRole = expected.runtimeRole,
) {
  const result = await client.query(`
    SELECT pg_catalog.current_database() AS database_name,
           CURRENT_USER AS current_user_name,
           SESSION_USER AS session_user_name,
           role.rolsuper, role.rolbypassrls, role.rolinherit,
           role.rolcanlogin, role.rolcreatedb, role.rolcreaterole,
           role.rolreplication,
           pg_catalog.pg_has_role(CURRENT_USER, $1, 'MEMBER') AS member_of_owner
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = CURRENT_USER
  `, [migrationRole]);
  assert.deepEqual(result.rows, [{
    database_name: expected.databaseName,
    current_user_name: expected.runtimeRole,
    session_user_name: expectedSessionRole,
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

export async function verifyReservationCompatibleTablePosture(
  client,
  migrationRole = MIGRATION_ROLE,
) {
  const result = await client.query(`
    SELECT relation.relrowsecurity AS rls_enabled,
           relation.relforcerowsecurity AS rls_forced,
           pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
           (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = relation.oid) AS policy_count,
           ARRAY(SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
                   FROM pg_catalog.aclexplode(COALESCE(relation.relacl,
                     pg_catalog.acldefault('r', relation.relowner))) AS acl
                  WHERE acl.grantee = (SELECT oid FROM pg_catalog.pg_roles
                                        WHERE rolname = CURRENT_USER)
                  ORDER BY 1) AS runtime_privileges,
           ARRAY(SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
                   FROM pg_catalog.aclexplode(COALESCE(relation.relacl,
                     pg_catalog.acldefault('r', relation.relowner))) AS acl
                  WHERE acl.grantee = (SELECT oid FROM pg_catalog.pg_roles
                                        WHERE rolname = CURRENT_USER)
                    AND acl.is_grantable ORDER BY 1) AS runtime_grant_options,
           ARRAY(SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
                   FROM pg_catalog.aclexplode(COALESCE(relation.relacl,
                     pg_catalog.acldefault('r', relation.relowner))) AS acl
                  WHERE acl.grantee = 0 ORDER BY 1) AS public_privileges,
           ARRAY(SELECT DISTINCT pg_catalog.format('%I:%s', attribute.attname,
                     pg_catalog.upper(acl.privilege_type))
                   FROM pg_catalog.pg_attribute AS attribute
                   CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
                  WHERE attribute.attrelid = relation.oid
                    AND attribute.attnum > 0 AND NOT attribute.attisdropped
                    AND acl.grantee IN (0, (SELECT oid FROM pg_catalog.pg_roles
                                            WHERE rolname = CURRENT_USER))
                  ORDER BY 1) AS direct_column_privileges
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'CheckoutStockReservation'
       AND relation.relkind = 'r'
  `);
  assert.deepEqual(result.rows, [{
    rls_enabled: false,
    rls_forced: false,
    owner_name: migrationRole,
    policy_count: 0,
    runtime_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    runtime_grant_options: [],
    public_privileges: [],
    direct_column_privileges: [],
  }]);
}

export async function verifyReservationCompatibleSchema(client) {
  const columns = await client.query(`
    SELECT relation.relname AS table_name,
           attribute.attname AS column_name,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
             AS data_type,
           attribute.attnotnull AS not_null,
           pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
             AS column_default
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS default_value
        ON default_value.adrelid = attribute.attrelid
       AND default_value.adnum = attribute.attnum
     WHERE namespace.nspname = 'public'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND (relation.relname, attribute.attname) IN (
         ('StripeWebhookEvent', 'sourceObjectId'),
         ('CheckoutStockReservation', 'repairGeneration'),
         ('CheckoutStockReservation', 'repairClaimedAt'),
         ('CheckoutStockReservation', 'repairClaimKind'),
         ('CheckoutStockReservation', 'lastRepairError'),
         ('CheckoutStockReservation', 'lastRepairAttemptAt')
       )
     ORDER BY table_name, column_name
  `);
  const columnsByIdentity = new Map(columns.rows.map((row) => [
    `${row.table_name}.${row.column_name}`,
    row,
  ]));
  const expectedColumns = [
    {
      table_name: "CheckoutStockReservation",
      column_name: "lastRepairAttemptAt",
      data_type: "timestamp(3) without time zone",
      not_null: false,
      column_default: null,
    },
    {
      table_name: "CheckoutStockReservation",
      column_name: "lastRepairError",
      data_type: "character varying(100)",
      not_null: false,
      column_default: null,
    },
    {
      table_name: "CheckoutStockReservation",
      column_name: "repairClaimKind",
      data_type: "character varying(32)",
      not_null: false,
      column_default: null,
    },
    {
      table_name: "CheckoutStockReservation",
      column_name: "repairClaimedAt",
      data_type: "timestamp(3) without time zone",
      not_null: false,
      column_default: null,
    },
    {
      table_name: "CheckoutStockReservation",
      column_name: "repairGeneration",
      data_type: "bigint",
      not_null: true,
      column_default: "0",
    },
    {
      table_name: "StripeWebhookEvent",
      column_name: "sourceObjectId",
      data_type: "character varying(255)",
      not_null: false,
      column_default: null,
    },
  ];
  assert.equal(columnsByIdentity.size, expectedColumns.length);
  for (const expected of expectedColumns) {
    assert.deepEqual(
      columnsByIdentity.get(`${expected.table_name}.${expected.column_name}`),
      expected,
    );
  }

  const constraints = await client.query(`
    SELECT constraint_state.conname AS constraint_name,
           constraint_state.contype AS constraint_type,
           constraint_state.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(constraint_state.oid, true) AS definition
      FROM pg_catalog.pg_constraint AS constraint_state
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = constraint_state.connamespace
     WHERE namespace.nspname = 'public'
       AND constraint_state.conname = ANY($1::text[])
     ORDER BY constraint_state.conname
  `, [TARGET_CONSTRAINTS]);
  assert.deepEqual(
    constraints.rows.map((row) => row.constraint_name),
    [...TARGET_CONSTRAINTS].sort(),
  );
  for (const row of constraints.rows) {
    assert.equal(row.constraint_type, "c", row.constraint_name);
    assert.equal(row.validated, true, row.constraint_name);
  }
  const constraintByName = new Map(
    constraints.rows.map((row) => [row.constraint_name, row.definition]),
  );
  assert.match(constraintByName.get("CheckoutStockReservation_repairGeneration_check") ?? "", /"repairGeneration" >= 0/);
  assert.match(constraintByName.get("CheckoutStockReservation_payloadHash_check") ?? "", /payloadHash[\s\S]*deleted[\s\S]*A-Za-z0-9_-/);
  assert.match(constraintByName.get("CheckoutStockReservation_repairClaim_check") ?? "", /repairClaimedAt[\s\S]*repairClaimKind[\s\S]*CRON[\s\S]*ACCOUNT/);
  assert.match(constraintByName.get("CheckoutStockReservation_reservedItems_array_chk") ?? "", /jsonb_typeof[\s\S]*array/);
  assert.match(constraintByName.get("CheckoutStockReservation_status_chk") ?? "", /RESERVED[\s\S]*SESSION_CREATED[\s\S]*COMPLETED[\s\S]*RESTORED/);
  assert.match(constraintByName.get("StripeWebhookEvent_sourceObjectId_check") ?? "", /sourceObjectId[\s\S]*255/);

  const indexes = await client.query(`
    SELECT indexname AS index_name
      FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'CheckoutStockReservation'
     ORDER BY indexname
  `);
  assert.deepEqual(indexes.rows.map((row) => row.index_name), [...TARGET_INDEXES].sort());

  const triggers = await client.query(`
    SELECT trigger.tgname AS trigger_name,
           procedure.proname AS function_name,
           trigger.tgenabled AS enabled
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'CheckoutStockReservation'
       AND NOT trigger.tgisinternal
  `);
  assert.deepEqual(triggers.rows, [{
    trigger_name: "CheckoutStockReservation_normalize_write",
    function_name: "grainline_checkout_reservation_normalize_write",
    enabled: "O",
  }]);
}

export async function verifyReservationCompatibleFunctionCatalog(
  client,
  migrationRole = MIGRATION_ROLE,
) {
  const names = CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.map((entry) => entry.name);
  const args = CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.map((entry) => entry.argumentTypes);
  const result = await client.query(`
    WITH expected(function_name, identity_arguments) AS (
      SELECT * FROM unnest($1::text[], $2::text[])
    )
    SELECT procedure.proname AS function_name,
           pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           procedure.prokind AS function_kind,
           language.lanname AS language_name,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_mode,
           procedure.proconfig AS function_config,
           procedure.prosrc AS function_source,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_proc AS actual
              JOIN pg_catalog.pg_namespace AS actual_namespace
                ON actual_namespace.oid = actual.pronamespace
             WHERE actual_namespace.nspname = 'public'
               AND (
                 actual.proname LIKE 'grainline_checkout_reservation_%'
                 OR (actual.proname = 'grainline_stripe_webhook_bind_source'
                     AND pg_catalog.oidvectortypes(actual.proargtypes)
                       = 'text, text, bigint, text')
                 OR (actual.proname = 'grainline_stripe_webhook_begin'
                     AND pg_catalog.oidvectortypes(actual.proargtypes)
                       = 'text, text, text')
               )) AS actual_function_count,
           pg_catalog.has_function_privilege(CURRENT_USER, procedure.oid, 'EXECUTE')
             AS runtime_execute,
           EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,
                     pg_catalog.acldefault('f', procedure.proowner))) AS acl
                    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
             AS public_execute,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner))) AS acl
             WHERE acl.privilege_type <> 'EXECUTE'
                OR acl.grantee = 0
                OR acl.grantee NOT IN (procedure.proowner,
                     (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER))
                OR (acl.grantee = (SELECT oid FROM pg_catalog.pg_roles
                                    WHERE rolname = CURRENT_USER)
                    AND (acl.grantor <> procedure.proowner OR acl.is_grantable)))
             AS invalid_acl_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      JOIN expected ON expected.function_name = procedure.proname
                   AND expected.identity_arguments = pg_catalog.oidvectortypes(procedure.proargtypes)
     WHERE namespace.nspname = 'public'
     ORDER BY procedure.proname, identity_arguments
  `, [names, args]);
  assert.equal(result.rows.length, CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.length);
  const expected = new Map(CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.map((entry) => [
    `${entry.name}(${entry.argumentTypes})`,
    entry,
  ]));
  const sourceHashes = checkoutStockReservationFunctionSourceSha256();
  for (const row of result.rows) {
    const signature = `${row.function_name}(${row.identity_arguments})`;
    const contract = expected.get(signature);
    assert.ok(contract, signature);
    assert.equal(row.owner_name, migrationRole, signature);
    assert.equal(row.function_kind, "f", signature);
    assert.equal(row.language_name, contract.language ?? "plpgsql", signature);
    assert.equal(row.security_definer, true, signature);
    assert.equal(row.leakproof, false, signature);
    assert.equal(row.volatility, contract.volatility, signature);
    assert.equal(row.parallel_mode, contract.parallelSafety, signature);
    assert.deepEqual(row.function_config, ["search_path=pg_catalog"], signature);
    assert.equal(row.runtime_execute, contract.runtimeExecute, signature);
    assert.equal(row.public_execute, false, signature);
    assert.equal(row.invalid_acl_count, 0, signature);
    assert.equal(
      row.actual_function_count,
      CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.length,
      signature,
    );
    assert.equal(
      createHash("sha256").update(row.function_source).digest("hex"),
      sourceHashes[signature],
      `${signature} source drifted`,
    );
  }
}

export async function runReservationAuthorityPostflight(config) {
  const git = assertReservationAuthorityPostflightGitState(
    readReservationAuthorityPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-reservation-authority-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.databaseUrl)),
  });
  let open = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const transaction = await client.query(`
      SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
             pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{ isolation: "repeatable read", read_only: "on" }]);
    await verifyReservationAuthorityRuntimeIdentity(client, config.runtimeIdentity);
    await verifyReservationCompatibleTablePosture(client);
    await verifyReservationCompatibleSchema(client);
    await verifyReservationCompatibleFunctionCatalog(client);
    const directRead = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."CheckoutStockReservation"
    `);
    assert.equal(Number.isSafeInteger(directRead.rows[0]?.count), true);
    const fixedRead = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_checkout_reservation_export(
          'grainline-authority-postflight-absent-user'
        )
    `);
    assert.deepEqual(fixedRead.rows, [{ count: 0 }]);
    await expectSqlState(
      client,
      () => client.query(`SELECT public.grainline_checkout_reservation_restore_items('[]'::jsonb)`),
      "42501",
      "private helper execution",
    );
    await expectSqlState(
      client,
      () => client.query(`SELECT public.grainline_checkout_reservation_prune_batch(1)`),
      "25006",
      "fixed write read-only fence",
    );
    await client.query("ROLLBACK");
    open = false;
    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "checkout-stock-reservation-authority-production-postflight",
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      target: Object.freeze({
        databaseName: config.runtimeIdentity.databaseName,
        databaseUrlSha256: config.databaseUrlSha256,
        endpointId: config.runtimeIdentity.endpointId,
        region: config.runtimeIdentity.region,
        role: config.runtimeIdentity.runtimeRole,
      }),
      runs: Object.freeze({
        inspectionRunId: config.inspectionRunId,
        mainCiRunId: config.mainCiRunId,
        migrationRunId: config.migrationRunId,
      }),
      proof: Object.freeze({
        functionCount: 20,
        policyCount: 0,
        predecessorCrudRetained: true,
        reservationCount: directRead.rows[0].count,
        rlsEnabled: false,
        rlsForced: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "compatible_predecessor_crud_and_policyless_rls_off_posture",
          "exact_columns_constraints_indexes_and_trigger",
          "exact_twenty_function_source_mode_owner_and_acl_catalog",
          "direct_aggregate_read_compatible",
          "fixed_export_succeeds",
          "private_helper_execution_denied",
          "fixed_write_reaches_read_only_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeReservationAuthorityPostflightEvidence(config.evidencePath, evidence);
    return evidence;
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeReservationAuthorityPostflightEvidence(pathname, evidence) {
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
    throw new Error("reservation authority evidence is not mode 0600");
  }
}

async function main() {
  try {
    const evidence = await runReservationAuthorityPostflight(
      parseReservationAuthorityPostflightConfig(),
    );
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.productionChangedByPostflight === false,
    })}\n`);
  } catch (error) {
    process.stderr.write(`reservation authority production postflight failed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
