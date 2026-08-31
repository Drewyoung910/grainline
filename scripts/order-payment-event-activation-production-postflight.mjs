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
  ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES,
  orderPaymentEventActivationFunctionCatalog,
} from "./order-payment-event-activation-catalog.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  verifyOrderPaymentEventActivationRelease,
} from "./verify-order-payment-event-activation-release.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/u;
const EVIDENCE_PREFIX =
  "order-payment-event-activation-production-postflight-";

export const ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-payment-event-activation-runtime-read-only";

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

export function parseOrderPaymentEventActivationPostflightConfig(
  env = process.env,
  {
    assertRuntimeDatabaseIsolation = assertVercelRuntimeDatabaseIsolation,
  } = {},
) {
  assertDeterministicPostgresEnvironment(
    env,
    "OrderPaymentEvent activation production postflight",
  );
  if (
    env.ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM
      !== ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("OrderPaymentEvent activation postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent activation postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent activation postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("OrderPaymentEvent activation postflight release commit is invalid");
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
    "ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "OrderPaymentEvent activation postflight evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readOrderPaymentEventActivationPostflightGitState(
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

export function assertOrderPaymentEventActivationPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "OrderPaymentEvent activation postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT order_payment_activation_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT order_payment_activation_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT order_payment_activation_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function verifyOrderPaymentEventActivationRuntimeIdentity(
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

async function readOrderPaymentEventActivationRuntimeCatalog(
  client,
  root = process.cwd(),
) {
  const table = (await client.query(`
    WITH required_indexes(index_name) AS (
      VALUES
        ('OrderPaymentEvent_pkey'),
        ('OrderPaymentEvent_stripeEventId_key'),
        ('OrderPaymentEvent_id_orderId_key'),
        ('OrderPaymentEvent_orderId_createdAt_idx'),
        ('OrderPaymentEvent_eventType_createdAt_idx'),
        ('OrderPaymentEvent_stripeObjectId_idx'),
        ('OrderPaymentEvent_order_dispute_event_time_idx')
    ), required_triggers(relation_name, trigger_name, function_name, trigger_type) AS (
      VALUES
        ('OrderPaymentEvent','grainline_order_payment_event_validate_insert',
         'grainline_order_payment_event_validate_insert',7),
        ('OrderPaymentEvent','grainline_order_payment_event_immutable',
         'grainline_order_payment_event_immutable',27),
        ('OrderPaymentEvent','grainline_order_payment_projection_refresh',
         'grainline_order_payment_projection_refresh',5),
        ('OrderPaymentEvent','grainline_order_payment_open_dispute_refresh',
         'grainline_order_payment_open_dispute_refresh',5),
        ('Order','grainline_order_currency_payment_immutable',
         'grainline_order_currency_payment_immutable',19),
        ('Order','grainline_order_payment_projection_guard',
         'grainline_order_payment_projection_guard',23),
        ('Order','grainline_order_payment_open_dispute_guard',
         'grainline_order_payment_open_dispute_guard',23)
    )
    SELECT
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
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
        ) AS acl WHERE acl.grantee = 0
          AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      ) AS public_has_crud,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.aclexplode(
         COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
       ) AS acl WHERE acl.grantee NOT IN (
         relation.relowner,
         (SELECT role.oid FROM pg_catalog.pg_roles AS role
           WHERE role.rolname = CURRENT_USER)
       ) OR (acl.grantee = (
         SELECT role.oid FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = CURRENT_USER
       ) AND (acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')
         OR acl.grantor <> relation.relowner OR acl.is_grantable)))
        AS invalid_table_acl_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_attribute AS attribute
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0
         AND NOT attribute.attisdropped) AS column_acl_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_constraint AS item
       WHERE item.conrelid = relation.oid AND item.convalidated
         AND item.conname IN (
           'OrderPaymentEvent_amountCents_check','OrderPaymentEvent_currency_check',
           'OrderPaymentEvent_eventType_check','OrderPaymentEvent_source_shape_check',
           'OrderPaymentEvent_text_shape_check',
           'OrderPaymentEvent_timestamp_immutable_shape_check'
         )) AS validated_constraint_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_index AS item
       JOIN pg_catalog.pg_class AS index_class ON index_class.oid = item.indexrelid
       JOIN required_indexes ON required_indexes.index_name = index_class.relname
       WHERE item.indrelid = relation.oid AND item.indisvalid
         AND item.indisready AND item.indislive) AS required_index_count,
      (SELECT pg_catalog.count(*)::integer
         FROM required_triggers
         JOIN pg_catalog.pg_class AS trigger_class
           ON trigger_class.relname = required_triggers.relation_name
          AND trigger_class.relnamespace = 'public'::pg_catalog.regnamespace
         JOIN pg_catalog.pg_trigger AS trigger_row
           ON trigger_row.tgrelid = trigger_class.oid
          AND trigger_row.tgname = required_triggers.trigger_name
          AND trigger_row.tgtype = required_triggers.trigger_type
          AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
         JOIN pg_catalog.pg_proc AS trigger_function
           ON trigger_function.oid = trigger_row.tgfoid
          AND trigger_function.proname = required_triggers.function_name
          AND trigger_function.pronamespace =
              'public'::pg_catalog.regnamespace) AS required_trigger_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = relation.oid
         AND NOT trigger_row.tgisinternal) AS order_payment_event_trigger_count
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
  `)).rows[0];

  const expected = orderPaymentEventActivationFunctionCatalog(root);
  const names = [...new Set(expected.map((entry) => entry.name))];
  const functions = (await client.query(`
    SELECT procedure.proname || '(' || pg_catalog.replace(
             pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
           ) || ')' AS identity,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           procedure.prokind AS function_kind,
           language.lanname AS language_name,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.proconfig AS config,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.has_function_privilege(
             CURRENT_USER, procedure.oid, 'EXECUTE'
           ) AS runtime_can_execute,
           pg_catalog.has_function_privilege(
             CURRENT_USER, procedure.oid, 'EXECUTE WITH GRANT OPTION'
           ) AS runtime_execute_grantable,
           EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
           ) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
             AS public_can_execute,
           (SELECT pg_catalog.count(*)::integer FROM pg_catalog.aclexplode(
             COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
           ) AS acl WHERE acl.privilege_type <> 'EXECUTE' OR acl.grantee = 0
             OR acl.grantee NOT IN (
               procedure.proowner,
               (SELECT role.oid FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = CURRENT_USER)
             ) OR (acl.grantee = (
               SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = CURRENT_USER
             ) AND (acl.grantor <> procedure.proowner OR acl.is_grantable)))
             AS invalid_acl_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE procedure.pronamespace = 'public'::pg_catalog.regnamespace
       AND procedure.proname = ANY($1::text[])
     ORDER BY identity
  `, [names])).rows;
  const expectedIdentitySet = new Set(expected.map((entry) => entry.identity));
  const directSurface = (await client.query(`
    SELECT
      pg_catalog.count(*)::integer AS direct_function_count,
      pg_catalog.count(*) FILTER (
        WHERE procedure.proname || '(' || pg_catalog.replace(
          pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
        ) || ')' = ANY($1::text[])
      )::integer AS reviewed_direct_function_count
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.pronamespace = 'public'::pg_catalog.regnamespace
       AND pg_catalog.strpos(procedure.prosrc, '"OrderPaymentEvent"') > 0
  `, [ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES])).rows[0];
  return Object.freeze({
    table,
    functions,
    unexpectedNamedFunctionCount: functions.filter(
      (row) => !expectedIdentitySet.has(row.identity),
    ).length,
    directFunctionCount: Number(directSurface?.direct_function_count),
    reviewedDirectFunctionCount: Number(
      directSurface?.reviewed_direct_function_count,
    ),
  });
}

export function assertOrderPaymentEventActivationRuntimeCatalog(
  snapshot,
  { migrationRole = MIGRATION_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventActivationRelease(root);
  const table = snapshot?.table;
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== true
    || table.rls_forced !== false
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== false
    || table.runtime_can_insert !== false
    || table.runtime_can_update !== false
    || table.runtime_can_delete !== false
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.column_acl_count) !== 0
    || Number(table.validated_constraint_count) !== 6
    || Number(table.required_index_count) !== 7
    || Number(table.required_trigger_count) !== 7
    || Number(table.order_payment_event_trigger_count) !== 4
  ) {
    throw new Error("OrderPaymentEvent activation runtime table posture drifted");
  }

  const expected = orderPaymentEventActivationFunctionCatalog(root);
  const rows = Array.isArray(snapshot?.functions) ? snapshot.functions : [];
  const byIdentity = new Map(rows.map((row) => [row?.identity, row]));
  if (rows.length !== expected.length || byIdentity.size !== expected.length) {
    throw new Error("OrderPaymentEvent activation runtime function inventory drifted");
  }
  for (const entry of expected) {
    const row = byIdentity.get(entry.identity);
    if (
      row?.owner_name !== migrationRole
      || row.function_kind !== "f"
      || row.language_name !== entry.language
      || row.volatility !== entry.volatility
      || row.parallel_safety !== entry.parallelSafety
      || row.security_definer !== entry.securityDefiner
      || row.leakproof !== false
      || JSON.stringify(row.config) !== JSON.stringify(["search_path=pg_catalog"])
      || row.source_md5 !== entry.sourceMd5
      || row.runtime_can_execute !== entry.runtimeAfter
      || row.runtime_execute_grantable !== false
      || row.public_can_execute !== false
      || Number(row.invalid_acl_count) !== 0
    ) {
      throw new Error(
        `OrderPaymentEvent activation runtime function drifted: ${entry.identity}`,
      );
    }
  }
  if (
    Number(snapshot?.unexpectedNamedFunctionCount) !== 0
    || Number(snapshot?.directFunctionCount)
      !== ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length
    || Number(snapshot?.reviewedDirectFunctionCount)
      !== ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length
  ) {
    throw new Error("OrderPaymentEvent activation runtime function surface is not exact");
  }
  return Object.freeze({
    functionCount: expected.length,
    privateFunctionCount: expected.filter((entry) => !entry.runtimeAfter).length,
    runtimeFunctionCount: expected.filter((entry) => entry.runtimeAfter).length,
    policyCount: 0,
    rlsEnabled: true,
    rlsForced: false,
  });
}

export async function proveOrderPaymentEventActivationRuntimeBoundaries(client) {
  for (const [label, sql, sqlState] of [
    ["direct select", 'SELECT id FROM public."OrderPaymentEvent" LIMIT 1', "42501"],
    ["direct insert", 'INSERT INTO public."OrderPaymentEvent" DEFAULT VALUES', "25006"],
    ["direct update", 'UPDATE public."OrderPaymentEvent" SET id = id WHERE false', "25006"],
    ["direct delete", 'DELETE FROM public."OrderPaymentEvent" WHERE false', "25006"],
  ]) {
    await expectSqlState(client, () => client.query(sql), sqlState, label);
  }
  await expectSqlState(
    client,
    () => client.query(
      "SELECT public.grainline_case_seller_refund_apply($1, $2)",
      ["order-payment-activation-postflight-absent-case", "absent-event"],
    ),
    "42501",
    "retired Case entry point",
  );
  await expectSqlState(
    client,
    () => client.query(`
      SELECT * FROM public.grainline_blocked_checkout_refund_claim(
        $1, $2, $3, $4, $5
      )
    `, ["absent-event", 1, "absent-session", "absent-order", 500]),
    "42501",
    "retired blocked-checkout entry point",
  );

  const marker = "order-payment-activation-postflight-absent";
  const results = [];
  results.push(await client.query(`SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes(
      $1::text, ARRAY[$2::text]::text[]
    )`, [marker, marker]));
  results.push(await client.query(`SELECT * FROM public.grainline_order_payment_seller_refund_outcomes(
      $1::text, ARRAY[$2::text]::text[]
    )`, [marker, marker]));
  results.push(await client.query(`SELECT * FROM public.grainline_order_payment_buyer_export_page(
      $1::text, 1::integer, NULL::bigint, NULL::text
    )`, [marker]));
  results.push(await client.query(`SELECT * FROM public.grainline_order_payment_seller_export_page(
      $1::text, 1::integer, NULL::bigint, NULL::text
    )`, [marker]));
  for (const result of results) assert.equal(result.rowCount, 0);
  await expectSqlState(
    client,
    () => client.query(`SELECT * FROM public.grainline_order_payment_staff_timeline(
      $1::text, $2::text, 1::integer
    )`, [marker, marker]),
    "42501",
    "non-staff timeline",
  );
  await expectSqlState(
    client,
    () => client.query(
      "SELECT public.grainline_seller_refund_claim($1, $2)",
      [marker, marker],
    ),
    "25006",
    "fixed writer read-only fence",
  );
  return Object.freeze({
    directTableOperationsDenied: 4,
    directTablePrivilegeDenials: 1,
    directTableReadOnlyFences: 3,
    retainedReadFunctionsExecuted: 5,
    retiredFunctionExecutionsDenied:
      ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES.length,
    writeFunctionReadOnlyFenceProven: true,
  });
}

export async function proveOrderPaymentEventActivationRuntimePosture(
  client,
  expectedIdentity,
  { migrationRole = MIGRATION_ROLE, root = process.cwd() } = {},
) {
  const transaction = await client.query(`
    SELECT
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(transaction.rows, [{
    isolation: "repeatable read",
    read_only: "on",
  }]);
  await verifyOrderPaymentEventActivationRuntimeIdentity(
    client,
    expectedIdentity,
    migrationRole,
  );
  const catalog = assertOrderPaymentEventActivationRuntimeCatalog(
    await readOrderPaymentEventActivationRuntimeCatalog(client, root),
    { migrationRole, root },
  );
  const boundaries = await proveOrderPaymentEventActivationRuntimeBoundaries(
    client,
  );
  return Object.freeze({ ...catalog, ...boundaries });
}

export async function runOrderPaymentEventActivationPostflight(config) {
  const git = assertOrderPaymentEventActivationPostflightGitState(
    readOrderPaymentEventActivationPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-payment-event-activation-postflight",
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
    const proof = await proveOrderPaymentEventActivationRuntimePosture(
      client,
      config.runtimeIdentity,
    );
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "order-payment-event-activation-production-postflight",
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
        ...proof,
        postflightReadOnly: true,
        publicOrUnreviewedAuthority: false,
        rowsExported: false,
        runtimeTableOrColumnAuthority: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "policyless_enable_no_force_table_posture",
          "zero_runtime_or_public_table_or_column_authority",
          "exact_29_function_source_mode_owner_and_acl_catalog",
          "exact_25_direct_reference_function_surface",
          "direct_select_acl_denied_and_all_three_dml_operations_engine_fenced",
          "both_retired_predecessor_entry_points_denied",
          "five_fixed_read_boundaries_execute_without_row_export",
          "granted_fixed_writer_reaches_engine_read_only_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeOrderPaymentEventActivationPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeOrderPaymentEventActivationPostflightEvidence(
  pathname,
  evidence,
) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|password|rawRows|userIds|providerIds/iu.test(serialized)) {
    throw new Error(
      "OrderPaymentEvent activation postflight evidence contains forbidden data",
    );
  }
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("OrderPaymentEvent activation postflight evidence is not mode 0600");
  }
}

async function main() {
  try {
    const config = parseOrderPaymentEventActivationPostflightConfig();
    const evidence = await runOrderPaymentEventActivationPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent activation production postflight failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
