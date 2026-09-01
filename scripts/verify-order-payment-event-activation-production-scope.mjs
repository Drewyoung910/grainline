#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  buildOrderPaymentEventActivationCandidate,
} from "./build-order-payment-event-activation-candidate.mjs";
import {
  ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES,
  orderPaymentEventActivationFunctionCatalog,
} from "./order-payment-event-activation-catalog.mjs";
import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
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
export const ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseOrderPaymentEventActivationScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "OrderPaymentEvent activation production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("OrderPaymentEvent activation scope requires manual main");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(env, "ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGE");
  if (!ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent activation scope stage is invalid");
  }
  const identity = parseVercelRuntimeDatabaseIdentity(directUrl, "DIRECT_URL");
  const reviewed = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
  if (
    identity.isPooler
    || identity.username !== MIGRATION_ROLE
    || identity.endpointId !== reviewed.endpointId
    || identity.region !== reviewed.region
    || identity.databaseName !== reviewed.databaseName
  ) {
    throw new Error("DIRECT_URL is not the reviewed production migration owner");
  }
  return Object.freeze({ directUrl, identity, stage });
}

function isAppliedRow(row, checksum) {
  return row?.migration_name === ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION
    && row.checksum === checksum
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

function classifyLedger(rows, stage, checksum) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    )
    || rows.length > 1
  ) {
    throw new Error("OrderPaymentEvent activation ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0], checksum);
  if (
    (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error("OrderPaymentEvent activation ledger is at the wrong stage");
  }
  return applied;
}

export function assertOrderPaymentEventActivationProductionScope(
  snapshot,
  stage,
  {
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
    expectedForce = false,
  } = {},
) {
  if (typeof expectedForce !== "boolean") {
    throw new Error("OrderPaymentEvent expected FORCE posture is invalid");
  }
  const release = verifyOrderPaymentEventActivationRelease(root, {
    allowReviewedForceSuccessor: true,
    allowReviewedOrderParticipantListSuccessor: true,
  });
  const applied = classifyLedger(
    snapshot?.ledgerRows,
    stage,
    release.migrationSha256,
  );
  const table = snapshot?.table;
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== applied
    || table.rls_forced !== expectedForce
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== !applied
    || table.runtime_can_insert !== !applied
    || table.runtime_can_update !== !applied
    || table.runtime_can_delete !== !applied
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.column_acl_count) !== 0
    || Number(table.validated_constraint_count) !== 6
    || Number(table.required_index_count) !== 7
    || Number(table.required_trigger_count) !== 7
    || Number(table.order_payment_event_trigger_count) !== 4
    || Number(table.invalid_row_count) !== 0
  ) {
    throw new Error("OrderPaymentEvent activation table posture drifted");
  }

  const expected = orderPaymentEventActivationFunctionCatalog(root);
  const byIdentity = new Map(
    Array.isArray(snapshot?.functions)
      ? snapshot.functions.map((row) => [row?.identity, row])
      : [],
  );
  if (byIdentity.size !== expected.length || snapshot.functions.length !== expected.length) {
    throw new Error("OrderPaymentEvent activation function inventory drifted");
  }
  for (const entry of expected) {
    const row = byIdentity.get(entry.identity);
    const runtimeExpected = applied ? entry.runtimeAfter : entry.runtimeBefore;
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
      || row.runtime_can_execute !== runtimeExpected
      || row.public_can_execute !== false
      || Number(row.invalid_acl_count) !== 0
    ) {
      throw new Error(`OrderPaymentEvent activation function drifted: ${entry.identity}`);
    }
  }

  if (
    Number(snapshot?.unexpectedNamedFunctionCount) !== 0
    || Number(snapshot?.directFunctionCount)
      !== ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length
    || Number(snapshot?.reviewedDirectFunctionCount)
      !== ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length
  ) {
    throw new Error("OrderPaymentEvent activation function surface is not exact");
  }
  return Object.freeze({
    state: applied
      ? expectedForce ? "force-hardened" : "activated"
      : "transition-authority-prepared",
    orderPaymentEventRlsEnabled: applied,
    orderPaymentEventRlsForced: applied && expectedForce,
    policyCount: 0,
    runtimeTablePrivileges: applied ? 0 : 4,
    runtimeFunctionCount: applied ? 16 : 18,
    privateFunctionCount: applied ? 13 : 11,
    rowDataChangedByProof: false,
    productionChangedByProof: false,
    runtimeRole,
  });
}

async function readTable(client, runtimeRole) {
  return (await client.query(`
    WITH required_indexes(index_name) AS (
      VALUES
        ('OrderPaymentEvent_pkey'),
        ('OrderPaymentEvent_stripeEventId_key'),
        ('OrderPaymentEvent_id_orderId_key'),
        ('OrderPaymentEvent_orderId_createdAt_idx'),
        ('OrderPaymentEvent_eventType_createdAt_idx'),
        ('OrderPaymentEvent_stripeObjectId_idx'),
        ('OrderPaymentEvent_order_dispute_event_time_idx')
    ), required_triggers(
      relation_name,
      trigger_name,
      function_name,
      trigger_type
    ) AS (
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
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege($1, class.oid, 'SELECT') AS runtime_can_select,
      pg_catalog.has_table_privilege($1, class.oid, 'INSERT') AS runtime_can_insert,
      pg_catalog.has_table_privilege($1, class.oid, 'UPDATE') AS runtime_can_update,
      pg_catalog.has_table_privilege($1, class.oid, 'DELETE') AS runtime_can_delete,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
        ) AS acl WHERE acl.grantee = 0
          AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      ) AS public_has_crud,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.aclexplode(
         COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
       ) AS acl
       WHERE acl.grantee NOT IN (
         class.relowner,
         (SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = $1)
       ) OR (acl.grantee = (
         SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = $1
       ) AND (acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')
         OR acl.grantor <> class.relowner OR acl.is_grantable)))
        AS invalid_table_acl_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_attribute AS attribute
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = class.oid AND attribute.attnum > 0
         AND NOT attribute.attisdropped) AS column_acl_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = class.oid AND constraint_row.convalidated
         AND constraint_row.conname IN (
           'OrderPaymentEvent_amountCents_check','OrderPaymentEvent_currency_check',
           'OrderPaymentEvent_eventType_check','OrderPaymentEvent_source_shape_check',
           'OrderPaymentEvent_text_shape_check',
           'OrderPaymentEvent_timestamp_immutable_shape_check'
         )) AS validated_constraint_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_index AS index_row
       JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
       JOIN required_indexes ON required_indexes.index_name = index_class.relname
       WHERE index_row.indrelid = class.oid AND index_row.indisvalid
         AND index_row.indisready AND index_row.indislive) AS required_index_count,
      (SELECT pg_catalog.count(*)::integer
         FROM required_triggers
         JOIN pg_catalog.pg_class AS trigger_class
           ON trigger_class.relname = required_triggers.relation_name
          AND trigger_class.relnamespace = 'public'::pg_catalog.regnamespace
         JOIN pg_catalog.pg_trigger AS trigger_row
           ON trigger_row.tgrelid = trigger_class.oid
          AND trigger_row.tgname = required_triggers.trigger_name
          AND trigger_row.tgtype = required_triggers.trigger_type
          AND NOT trigger_row.tgisinternal
          AND trigger_row.tgenabled = 'O'
         JOIN pg_catalog.pg_proc AS trigger_function
           ON trigger_function.oid = trigger_row.tgfoid
          AND trigger_function.proname = required_triggers.function_name
          AND trigger_function.pronamespace =
              'public'::pg_catalog.regnamespace)
        AS required_trigger_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = class.oid AND NOT trigger_row.tgisinternal)
        AS order_payment_event_trigger_count,
      (SELECT pg_catalog.count(*)::integer FROM public."OrderPaymentEvent" AS payment
       WHERE payment."eventType" NOT IN ('REFUND','DISPUTE')
          OR payment."amountCents" < 0 OR payment.currency !~ '^[a-z]{3}$'
          OR payment."stripeObjectId" IS NULL OR payment."stripeObjectType" IS NULL
          OR payment.metadata IS NULL OR pg_catalog.jsonb_typeof(payment.metadata) <> 'object'
          OR payment."updatedAt" IS DISTINCT FROM payment."createdAt") AS invalid_row_count
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
  `, [runtimeRole])).rows[0];
}

async function readFunctions(client, runtimeRole, root) {
  const expected = orderPaymentEventActivationFunctionCatalog(root);
  const names = [...new Set(expected.map((entry) => entry.name))];
  const rows = (await client.query(`
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
           pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
             AS runtime_can_execute,
           EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
           ) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
             AS public_can_execute,
           (SELECT pg_catalog.count(*)::integer FROM pg_catalog.aclexplode(
             COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
           ) AS acl WHERE acl.privilege_type <> 'EXECUTE' OR acl.grantee = 0
             OR acl.grantee NOT IN (
               procedure.proowner,
               (SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = $1)
             ) OR (acl.grantee = (
               SELECT role.oid FROM pg_catalog.pg_roles AS role WHERE role.rolname = $1
             ) AND (acl.grantor <> procedure.proowner OR acl.is_grantable)))
             AS invalid_acl_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE procedure.pronamespace = 'public'::pg_catalog.regnamespace
       AND procedure.proname = ANY($2::text[])
     ORDER BY identity
  `, [runtimeRole, names])).rows;
  const expectedIdentitySet = new Set(expected.map((entry) => entry.identity));
  const unexpectedNamedFunctionCount = rows.filter(
    (row) => !expectedIdentitySet.has(row.identity),
  ).length;
  const directFunctionSurface = (await client.query(`
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
  return {
    rows,
    unexpectedNamedFunctionCount,
    directFunctionCount: Number(directFunctionSurface?.direct_function_count),
    reviewedDirectFunctionCount: Number(
      directFunctionSurface?.reviewed_direct_function_count,
    ),
  };
}

export async function readOrderPaymentEventActivationProductionSnapshotFromClient(
  client,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  const ledgerRows = (await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = $1
     ORDER BY started_at, id
  `, [ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION])).rows;
  const functions = await readFunctions(client, runtimeRole, root);
  return Object.freeze({
    ledgerRows,
    table: await readTable(client, runtimeRole),
    functions: functions.rows,
    unexpectedNamedFunctionCount: functions.unexpectedNamedFunctionCount,
    directFunctionCount: functions.directFunctionCount,
    reviewedDirectFunctionCount: functions.reviewedDirectFunctionCount,
  });
}

export async function readOrderPaymentEventActivationProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-activation-scope-proof",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    if (readOnly !== "on") throw new Error("activation scope is not read-only");
    const snapshot = await readOrderPaymentEventActivationProductionSnapshotFromClient(
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

async function main() {
  try {
    const config = parseOrderPaymentEventActivationScopeEnvironment();
    const snapshot = await readOrderPaymentEventActivationProductionSnapshot(
      config.directUrl,
    );
    process.stdout.write(`${JSON.stringify(
      assertOrderPaymentEventActivationProductionScope(snapshot, config.stage),
    )}\n`);
  } catch {
    process.stderr.write(
      "OrderPaymentEvent activation production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
