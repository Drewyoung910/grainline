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
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS,
  orderPaymentEventTransitionAuthorityFunctionSources,
  verifyOrderPaymentEventTransitionAuthorityMigrationBytes,
} from "./order-payment-event-transition-authority-catalog.mjs";
import {
  assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot,
  proveOrderPaymentEventAggregatePrivateExecutionDenied,
  readOrderPaymentEventAggregateAuthorityRuntimeSnapshot,
} from "./order-payment-event-aggregate-authority-production-postflight.mjs";
import {
  proveOrderPaymentEventReadAuthorityRuntimeBoundaries,
  proveOrderPaymentEventReadAuthorityRuntimeCatalog,
  verifyOrderPaymentEventReadAuthorityRuntimeIdentity,
} from "./order-payment-event-read-authority-production-postflight.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/u;
const EVIDENCE_PREFIX =
  "order-payment-event-transition-authority-production-postflight-";

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-payment-transition-authority-runtime-read-only";

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

export function parseOrderPaymentEventTransitionAuthorityPostflightConfig(
  env = process.env,
  {
    assertRuntimeDatabaseIsolation = assertVercelRuntimeDatabaseIsolation,
  } = {},
) {
  assertDeterministicPostgresEnvironment(
    env,
    "OrderPaymentEvent transition-authority production postflight",
  );
  if (
    env.ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_CONFIRM
      !== ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "OrderPaymentEvent transition-authority postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent transition-authority postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `OrderPaymentEvent transition-authority postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error(
      "OrderPaymentEvent transition-authority postflight release commit is invalid",
    );
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
    "ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "OrderPaymentEvent transition-authority postflight evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    inspectionRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_INSPECTION_RUN_ID",
    ),
    mainCiRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readOrderPaymentEventTransitionAuthorityPostflightGitState(
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

export function assertOrderPaymentEventTransitionAuthorityPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "OrderPaymentEvent transition-authority postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

function assertTransitionColumns(rows) {
  assert.deepEqual(rows, [{
    column_name: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS[0],
    type_name: "boolean",
    not_null: true,
    default_expression: "false",
  }]);
}

function assertTransitionFunctions(rows, root, functionOwner) {
  const expectedSources = orderPaymentEventTransitionAuthorityFunctionSources(root);
  const byIdentity = new Map(rows.map((row) => [row?.identity, row]));
  assert.equal(
    rows.length,
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES.length,
  );
  assert.equal(
    byIdentity.size,
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES.length,
  );
  for (const identity of ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES) {
    const row = byIdentity.get(identity);
    assert.equal(row?.owner_name, functionOwner, `${identity} owner drifted`);
    assert.equal(row?.security_definer, true, `${identity} security mode drifted`);
    assert.equal(row?.function_kind, "f", `${identity} kind drifted`);
    assert.equal(
      row?.language_name,
      identity.endsWith("(text)") ? "sql" : "plpgsql",
      `${identity} language drifted`,
    );
    assert.equal(row?.volatility, "v", `${identity} volatility drifted`);
    assert.equal(row?.parallel_safety, "u", `${identity} parallel mode drifted`);
    assert.equal(row?.leakproof, false, `${identity} leakproof drifted`);
    assert.deepEqual(row?.config, ["search_path=pg_catalog"]);
    assert.equal(row?.runtime_can_execute, false, `${identity} runtime EXECUTE drifted`);
    assert.equal(row?.public_can_execute, false, `${identity} PUBLIC EXECUTE drifted`);
    assert.equal(Number(row?.invalid_acl_count), 0, `${identity} ACL drifted`);
    assert.equal(
      sha256(row?.function_source ?? ""),
      sha256(expectedSources[identity]),
      `${identity} body drifted`,
    );
  }
}

function assertTransitionTriggers(rows, functionOwner) {
  const byName = new Map(rows.map((row) => [row?.trigger_name, row]));
  assert.equal(rows.length, ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS.length);
  assert.equal(byName.size, ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS.length);
  assert.deepEqual(byName.get("grainline_order_payment_open_dispute_guard"), {
    trigger_name: "grainline_order_payment_open_dispute_guard",
    relation_schema: "public",
    table_name: "Order",
    enabled: "O",
    trigger_type: 23,
    argument_count: 0,
    constraint_trigger: false,
    deferrable: false,
    initially_deferred: false,
    update_columns: ["paymentOpenDisputeBlocked"],
    function_identity: "grainline_order_payment_open_dispute_guard()",
    function_schema: "public",
    function_owner: functionOwner,
    function_kind: "f",
  });
  assert.deepEqual(byName.get("grainline_order_payment_open_dispute_refresh"), {
    trigger_name: "grainline_order_payment_open_dispute_refresh",
    relation_schema: "public",
    table_name: "OrderPaymentEvent",
    enabled: "O",
    trigger_type: 5,
    argument_count: 0,
    constraint_trigger: false,
    deferrable: false,
    initially_deferred: false,
    update_columns: [],
    function_identity: "grainline_order_payment_open_dispute_refresh()",
    function_schema: "public",
    function_owner: functionOwner,
    function_kind: "f",
  });
}

function assertTransitionAggregate(row) {
  const total = BigInt(row?.total_order_count ?? "-1");
  const blocked = BigInt(row?.open_dispute_blocked_count ?? "-1");
  assert.ok(total >= 0n);
  assert.ok(blocked >= 0n && blocked <= total);
}

export async function readOrderPaymentEventTransitionAuthorityRuntimeSnapshot(
  client,
) {
  const columns = (await client.query(`
    SELECT
      attribute.attname AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
      attribute.attnotnull AS not_null,
      pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
        AS default_expression
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = relation.oid
     AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'Order'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname = ANY($1::text[])
    ORDER BY attribute.attname
  `, [ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS])).rows;

  const functions = (await client.query(`
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
           OR acl.is_grantable
           OR acl.grantee <> procedure.proowner) AS invalid_acl_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY($1::text[])
    ORDER BY identity
  `, [ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS])).rows;

  const triggers = (await client.query(`
    SELECT
      trigger.tgname AS trigger_name,
      namespace.nspname AS relation_schema,
      relation.relname AS table_name,
      trigger.tgenabled AS enabled,
      trigger.tgtype::integer AS trigger_type,
      trigger.tgnargs::integer AS argument_count,
      (trigger.tgconstraint <> 0::oid) AS constraint_trigger,
      trigger.tgdeferrable AS deferrable,
      trigger.tginitdeferred AS initially_deferred,
      ARRAY(
        SELECT attribute.attname
          FROM pg_catalog.unnest(trigger.tgattr::smallint[])
               WITH ORDINALITY AS watched(attnum, position)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = trigger.tgrelid
           AND attribute.attnum = watched.attnum
         ORDER BY watched.position
      )::text[] AS update_columns,
      procedure.proname || '(' || pg_catalog.replace(
        pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
      ) || ')' AS function_identity,
      procedure_namespace.nspname AS function_schema,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS function_owner,
      procedure.prokind AS function_kind
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_catalog.pg_namespace AS procedure_namespace
      ON procedure_namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
      AND trigger.tgname = ANY($1::text[])
    ORDER BY trigger.tgname
  `, [ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS])).rows;

  const projectionAggregate = (await client.query(`
    SELECT
      pg_catalog.count(*)::bigint AS total_order_count,
      pg_catalog.count(*) FILTER (
        WHERE "paymentOpenDisputeBlocked"
      )::bigint AS open_dispute_blocked_count
    FROM public."Order"
  `)).rows[0];
  return Object.freeze({ columns, functions, triggers, projectionAggregate });
}

export function assertOrderPaymentEventTransitionAuthorityRuntimeSnapshot(
  snapshot,
  { functionOwner = MIGRATION_ROLE, root = process.cwd() } = {},
) {
  assertTransitionColumns(snapshot?.columns ?? []);
  assertTransitionFunctions(snapshot?.functions ?? [], root, functionOwner);
  assertTransitionTriggers(snapshot?.triggers ?? [], functionOwner);
  assertTransitionAggregate(snapshot?.projectionAggregate);
  return Object.freeze({
    privateFunctionCount:
      ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES.length,
    projectionColumnCount: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS.length,
    projectionQueryProven: true,
    triggerCount: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS.length,
  });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT order_payment_transition_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT order_payment_transition_expected_failure");
  await client.query("RELEASE SAVEPOINT order_payment_transition_expected_failure");
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function proveOrderPaymentEventTransitionPrivateExecutionDenied(
  client,
) {
  const operations = [
    [
      "open-dispute state",
      () => client.query(
        "SELECT public.grainline_order_payment_open_dispute_state($1::text)",
        ["order-payment-transition-postflight-absent"],
      ),
    ],
    [
      "open-dispute guard",
      () => client.query(
        "SELECT public.grainline_order_payment_open_dispute_guard()",
      ),
    ],
    [
      "open-dispute refresh",
      () => client.query(
        "SELECT public.grainline_order_payment_open_dispute_refresh()",
      ),
    ],
  ];
  for (const [label, operation] of operations) {
    await expectSqlState(client, operation, "42501", label);
  }
  return Object.freeze({ deniedFunctionCount: operations.length });
}

export async function runOrderPaymentEventTransitionAuthorityPostflight(config) {
  const git = assertOrderPaymentEventTransitionAuthorityPostflightGitState(
    readOrderPaymentEventTransitionAuthorityPostflightGitState(),
    config.releaseCommit,
  );
  verifyOrderPaymentEventTransitionAuthorityMigrationBytes();
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-payment-transition-authority-postflight",
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
    await verifyOrderPaymentEventReadAuthorityRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    const readCatalog = await proveOrderPaymentEventReadAuthorityRuntimeCatalog(
      client,
    );
    const readBoundary =
      await proveOrderPaymentEventReadAuthorityRuntimeBoundaries(client);
    const aggregate = assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
      await readOrderPaymentEventAggregateAuthorityRuntimeSnapshot(client),
    );
    const aggregateDenial =
      await proveOrderPaymentEventAggregatePrivateExecutionDenied(client);
    const transition = assertOrderPaymentEventTransitionAuthorityRuntimeSnapshot(
      await readOrderPaymentEventTransitionAuthorityRuntimeSnapshot(client),
    );
    const transitionDenial =
      await proveOrderPaymentEventTransitionPrivateExecutionDenied(client);
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "order-payment-event-transition-authority-production-postflight",
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
        aggregatePrivateFunctionCount: aggregate.privateFunctionCount,
        aggregateProjectionColumnCount: aggregate.projectionColumnCount,
        aggregateTriggerCount: aggregate.triggerCount,
        deniedAggregatePrivateFunctionCount: aggregateDenial.deniedFunctionCount,
        deniedTransitionPrivateFunctionCount:
          transitionDenial.deniedFunctionCount,
        orderPaymentEventPredecessorCrudRetained: true,
        orderPaymentEventRlsEnabled: false,
        postflightReadOnly: true,
        readAuthorityFunctionCount: readCatalog.functionCount,
        readAuthorityProjectionCount: readBoundary.projectionCount,
        rowsExported: false,
        transitionPrivateFunctionCount: transition.privateFunctionCount,
        transitionProjectionColumnCount: transition.projectionColumnCount,
        transitionProjectionQueryProven: transition.projectionQueryProven,
        transitionTriggerCount: transition.triggerCount,
        publicOrUnreviewedAuthority: false,
        productionChangedByPostflight: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "sealed_five_function_read_authority_catalog_and_boundaries",
          "exact_predecessor_aggregate_projection_catalog_and_denials",
          "exact_open_dispute_column_and_two_trigger_bindings",
          "exact_three_transition_function_bodies_modes_search_paths_and_acls",
          "bounded_open_dispute_projection_query_through_runtime_role",
          "all_three_private_transition_functions_denied_to_runtime",
          "order_payment_event_predecessor_crud_retained_and_rls_off",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeOrderPaymentEventTransitionAuthorityPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeOrderPaymentEventTransitionAuthorityPostflightEvidence(
  pathname,
  evidence,
) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|password|rawRows|userIds|providerIds/iu.test(serialized)) {
    throw new Error(
      "OrderPaymentEvent transition-authority postflight evidence contains forbidden data",
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
    throw new Error(
      "OrderPaymentEvent transition-authority postflight evidence is not mode 0600",
    );
  }
}

async function main() {
  try {
    const config = parseOrderPaymentEventTransitionAuthorityPostflightConfig();
    const evidence = await runOrderPaymentEventTransitionAuthorityPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent transition-authority production postflight failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
