#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS,
  orderPaymentEventAggregateAuthorityFunctionSources,
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  assertOrderPaymentEventReadAuthorityProductionScope,
  parseOrderPaymentEventReadAuthorityScopeEnvironment,
  readOrderPaymentEventReadAuthorityProductionSnapshotFromClient,
} from "./verify-order-payment-event-read-authority-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGES =
  Object.freeze(["before", "after", "restart"]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isAppliedRow(row) {
  return row?.migration_name === ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION
    && row.checksum === ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseOrderPaymentEventAggregateAuthorityScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGE",
  );
  if (!ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent aggregate-authority scope stage is invalid");
  }
  const predecessor = parseOrderPaymentEventReadAuthorityScopeEnvironment({
    ...env,
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertOrderPaymentEventAggregateAuthorityLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name
        !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
    )
  ) {
    throw new Error("OrderPaymentEvent aggregate-authority ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "OrderPaymentEvent aggregate-authority ledger is not at the reviewed stage",
    );
  }
  return applied;
}

function assertColumns(rows, applied) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("Order payment projection columns exist before migration");
    }
    return;
  }
  const byName = new Map(
    Array.isArray(rows) ? rows.map((row) => [row?.column_name, row]) : [],
  );
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.length
    || byName.size !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.length
    || !ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.every((columnName) => {
      const row = byName.get(columnName);
      return row?.column_name === columnName
        && row.type_name === "boolean"
        && row.not_null === true
        && row.default_expression === "false";
    })
  ) {
    throw new Error("Order payment projection column catalog drifted");
  }
}

function assertFunctions(rows, applied, migrationRole, root) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("Order payment projection functions exist before migration");
    }
    return;
  }
  const sources = orderPaymentEventAggregateAuthorityFunctionSources(root);
  const byIdentity = new Map(
    Array.isArray(rows) ? rows.map((row) => [row?.identity, row]) : [],
  );
  if (
    !Array.isArray(rows)
    || rows.length
      !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES.length
    || byIdentity.size
      !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES.length
    || !ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES.every(
      (identity) => {
        const row = byIdentity.get(identity);
        const language = identity.endsWith("(text)") ? "sql" : "plpgsql";
        return row?.identity === identity
          && row.owner_name === migrationRole
          && row.security_definer === true
          && row.function_kind === "f"
          && row.language_name === language
          && row.volatility === "v"
          && row.parallel_safety === "u"
          && row.leakproof === false
          && Array.isArray(row.config)
          && row.config.length === 1
          && row.config[0] === "search_path=pg_catalog"
          && row.runtime_can_execute === false
          && row.public_can_execute === false
          && Number(row.invalid_acl_count) === 0
          && sha256(row.function_source ?? "") === sha256(sources[identity]);
      },
    )
  ) {
    throw new Error("Order payment projection function catalog drifted");
  }
}

function assertTriggers(rows, applied, migrationRole) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("Order payment projection triggers exist before migration");
    }
    return;
  }
  const byName = new Map(
    Array.isArray(rows) ? rows.map((row) => [row?.trigger_name, row]) : [],
  );
  const guard = byName.get("grainline_order_payment_projection_guard");
  const refresh = byName.get("grainline_order_payment_projection_refresh");
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS.length
    || byName.size !== ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS.length
    || guard?.relation_schema !== "public"
    || guard?.table_name !== "Order"
    || guard.enabled !== "O"
    || Number(guard.trigger_type) !== 23
    || Number(guard.argument_count) !== 0
    || guard.constraint_trigger !== false
    || guard.deferrable !== false
    || guard.initially_deferred !== false
    || !Array.isArray(guard.update_columns)
    || guard.update_columns.length !== 2
    || guard.update_columns[0] !== "paymentRefundBlocked"
    || guard.update_columns[1] !== "paymentConversionDisputeBlocked"
    || guard.function_schema !== "public"
    || guard.function_owner !== migrationRole
    || guard.function_identity !== "grainline_order_payment_projection_guard()"
    || guard.function_kind !== "f"
    || refresh?.relation_schema !== "public"
    || refresh?.table_name !== "OrderPaymentEvent"
    || refresh.enabled !== "O"
    || Number(refresh.trigger_type) !== 5
    || Number(refresh.argument_count) !== 0
    || refresh.constraint_trigger !== false
    || refresh.deferrable !== false
    || refresh.initially_deferred !== false
    || !Array.isArray(refresh.update_columns)
    || refresh.update_columns.length !== 0
    || refresh.function_schema !== "public"
    || refresh.function_owner !== migrationRole
    || refresh.function_identity !== "grainline_order_payment_projection_refresh()"
    || refresh.function_kind !== "f"
  ) {
    throw new Error("Order payment projection trigger catalog drifted");
  }
}

export function assertOrderPaymentEventAggregateAuthorityProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertOrderPaymentEventReadAuthorityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const applied = assertOrderPaymentEventAggregateAuthorityLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  const predecessor = assertPredecessor(
    snapshot?.orderPaymentEventReadAuthority,
    "after",
    { migrationRole, runtimeRole, root },
  );
  assertColumns(snapshot?.columns, applied);
  assertFunctions(snapshot?.functions, applied, migrationRole, root);
  assertTriggers(snapshot?.triggers, applied, migrationRole);
  if (
    (applied && Number(snapshot?.projectionMismatchCount) !== 0)
    || (!applied && snapshot?.projectionMismatchCount !== null)
  ) {
    throw new Error("Order payment projections do not match immutable evidence");
  }
  return Object.freeze({
    orderPaymentEventReadAuthorityApplied:
      predecessor.orderPaymentEventReadAuthorityApplied,
    orderPaymentEventAggregateAuthorityApplied: applied,
    privateFunctionCount: applied
      ? ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS.length
      : 0,
    projectionColumnCount: applied
      ? ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.length
      : 0,
    projectionMismatchCount: applied ? 0 : null,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied
      ? "aggregate-authority-prepared"
      : "aggregate-authority-predecessor",
    productionChangedByProof: false,
  });
}

async function readFunctions(client, runtimeRole) {
  return (await client.query(
    `SELECT
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
       pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
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
            OR acl.is_grantable
            OR acl.grantee <> procedure.proowner) AS invalid_acl_count
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = procedure.pronamespace
     JOIN pg_catalog.pg_language AS language
       ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($2::text[])
     ORDER BY identity`,
    [runtimeRole, ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS],
  )).rows;
}

async function readColumns(client) {
  return (await client.query(
    `SELECT
       attribute.attname AS column_name,
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
       attribute.attnotnull AS not_null,
       pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
         AS default_expression
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid = attribute.attrelid
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
     ORDER BY attribute.attname`,
    [ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS],
  )).rows;
}

async function readTriggers(client) {
  return (await client.query(
    `SELECT
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
       ) AS update_columns,
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
     ORDER BY trigger.tgname`,
    [ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS],
  )).rows;
}

async function readProjectionMismatchCount(client) {
  return Number((await client.query(
    `SELECT pg_catalog.count(*)::integer AS mismatch_count
       FROM public."Order" AS orders
       CROSS JOIN LATERAL
         public.grainline_order_payment_projection_state(orders.id) AS expected
      WHERE orders."paymentRefundBlocked" IS DISTINCT FROM expected.refund_blocked
         OR orders."paymentConversionDisputeBlocked" IS DISTINCT FROM
            expected.conversion_dispute_blocked`,
  )).rows[0]?.mismatch_count);
}

export async function readOrderPaymentEventAggregateAuthorityProductionSnapshotFromClient(
  client,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
  const orderPaymentEventReadAuthority =
    await readOrderPaymentEventReadAuthorityProductionSnapshotFromClient(
      client,
      { runtimeRole, root },
    );
  const candidateLedgerRows = (await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id`,
    [ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION],
  )).rows;
  const columns = await readColumns(client);
  const functions = await readFunctions(client, runtimeRole);
  const triggers = await readTriggers(client);
  const projectionMismatchCount = columns.length
    === ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.length
    ? await readProjectionMismatchCount(client)
    : null;
  return Object.freeze({
    orderPaymentEventReadAuthority,
    candidateLedgerRows,
    columns,
    functions,
    triggers,
    projectionMismatchCount,
  });
}

export async function readOrderPaymentEventAggregateAuthorityProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-aggregate-authority-scope-proof",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    if (readOnly !== "on") throw new Error("scope transaction is not read-only");
    const snapshot =
      await readOrderPaymentEventAggregateAuthorityProductionSnapshotFromClient(
        client,
        { runtimeRole, root },
      );
    await client.query("ROLLBACK");
    open = false;
    return snapshot;
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyOrderPaymentEventAggregateAuthorityProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentEventAggregateAuthorityProductionSnapshot,
    assertPredecessor = assertOrderPaymentEventReadAuthorityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentEventAggregateAuthorityProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentEventAggregateAuthorityScopeEnvironment();
    const result =
      await verifyOrderPaymentEventAggregateAuthorityProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "OrderPaymentEvent aggregate-authority production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
