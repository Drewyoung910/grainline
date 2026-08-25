#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  collectNotificationPolicyIssues,
  readNotificationPolicyState,
} from "./audit-runtime-db-grants.mjs";
import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
  blockedCheckoutRefundDeliveryFunctionSources,
  verifyBlockedCheckoutRefundDeliveryMigrationBytes,
} from "./build-blocked-checkout-refund-delivery-migration.mjs";
import {
  assertOrderPaymentEventCompatibleProductionScope,
  parseOrderPaymentEventCompatibleScopeEnvironment,
  readOrderPaymentEventCompatibleProductionSnapshotFromClient,
} from "./verify-order-payment-event-compatible-production-scope.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const CORE_IDENTITY = "grainline_notification_create_core";
const ORDER_WRAPPER_IDENTITY = "grainline_notification_create_order_event";

export const BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGES = Object.freeze([
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isAppliedRow(row) {
  return row?.migration_name === BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION
    && row.checksum === BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function parseBlockedCheckoutRefundDeliveryScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE",
  );
  if (!BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "blocked-checkout refund delivery scope stage must be before, after, or restart",
    );
  }
  const predecessor = parseOrderPaymentEventCompatibleScopeEnvironment({
    ...env,
    ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertBlockedCheckoutRefundDeliveryLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name !== BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    )
  ) {
    throw new Error("blocked-checkout refund delivery ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "blocked-checkout refund delivery ledger is not at the exact reviewed stage",
    );
  }
  return applied;
}

function assertNotificationTable(table, migrationRole) {
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== true
    || table.rls_forced !== true
    || table.runtime_can_select !== true
    || table.runtime_can_insert !== false
    || table.runtime_can_update !== false
    || table.runtime_can_delete !== false
    || table.runtime_can_update_read !== true
    || Number(table.runtime_other_update_count) !== 0
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.invalid_column_acl_count) !== 0
    || Number(table.runtime_read_update_acl_count) !== 1
  ) {
    throw new Error("Notification FORCE table authority drifted");
  }
}

function assertNotificationFunctions(
  functions,
  candidateApplied,
  migrationRole,
  root,
) {
  const sources = blockedCheckoutRefundDeliveryFunctionSources(root);
  const expected = new Map([
    [
      CORE_IDENTITY,
      {
        source: candidateApplied
          ? sources.candidateCore
          : sources.predecessorCore,
        runtimeCanExecute: false,
      },
    ],
    [
      ORDER_WRAPPER_IDENTITY,
      { source: sources.orderWrapper, runtimeCanExecute: true },
    ],
  ]);
  if (
    !Array.isArray(functions)
    || functions.length !== expected.size
    || !functions.every((entry) => {
      const wanted = expected.get(entry.identity);
      return wanted
        && entry.owner_name === migrationRole
        && entry.security_definer === true
        && entry.function_kind === "f"
        && entry.language_name === "plpgsql"
        && entry.volatility === "v"
        && entry.parallel_safety === "u"
        && entry.leakproof === false
        && Array.isArray(entry.config)
        && entry.config.length === 1
        && entry.config[0] === "search_path=pg_catalog"
        && entry.runtime_can_execute === wanted.runtimeCanExecute
        && entry.public_can_execute === false
        && Number(entry.invalid_acl_count) === 0
        && sha256(entry.function_source ?? "") === sha256(wanted.source);
    })
  ) {
    throw new Error("blocked-checkout Notification function catalog drifted");
  }
}

export function assertBlockedCheckoutRefundDeliveryProductionScope(
  snapshot,
  stage,
  {
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const predecessor = assertOrderPaymentEventCompatibleProductionScope(
    snapshot?.orderPaymentEventCompatible,
    "after",
    { migrationRole, root },
  );
  const candidateApplied = assertBlockedCheckoutRefundDeliveryLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  assertNotificationTable(snapshot?.notificationTable, migrationRole);
  const policyIssues = collectNotificationPolicyIssues(
    snapshot?.notificationPolicies,
    runtimeRole,
    true,
  );
  if (policyIssues.length !== 0) {
    throw new Error("Notification FORCE policy catalog drifted");
  }
  assertNotificationFunctions(
    snapshot?.notificationFunctions,
    candidateApplied,
    migrationRole,
    root,
  );
  return Object.freeze({
    compatibleMigrationPrefixLength:
      predecessor.compatibleMigrationPrefixLength,
    blockedCheckoutRefundDeliveryApplied: candidateApplied,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    notificationRlsEnabled: true,
    notificationRlsForced: true,
    notificationPolicyCount: 2,
    notificationGenericCoreRuntimePrivate: true,
    state: candidateApplied ? "delivery-compatible" : "delivery-predecessor",
    productionChangedByProof: false,
  });
}

async function readNotificationTable(client, runtimeRole) {
  const rows = (await client.query(
    `SELECT
       pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
       relation.relrowsecurity AS rls_enabled,
       relation.relforcerowsecurity AS rls_forced,
       pg_catalog.has_table_privilege($1, relation.oid, 'SELECT')
         AS runtime_can_select,
       pg_catalog.has_table_privilege($1, relation.oid, 'INSERT')
         AS runtime_can_insert,
       pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE')
         AS runtime_can_update,
       pg_catalog.has_table_privilege($1, relation.oid, 'DELETE')
         AS runtime_can_delete,
       pg_catalog.has_column_privilege($1, relation.oid, 'read', 'UPDATE')
         AS runtime_can_update_read,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_attribute AS attribute
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attname <> 'read'
           AND pg_catalog.has_column_privilege(
             $1, relation.oid, attribute.attname, 'UPDATE'
           )) AS runtime_other_update_count,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
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
         WHERE acl.grantee = 0
            OR acl.grantee NOT IN (
              relation.relowner,
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
            )
            OR (
              acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
              AND (
                acl.privilege_type <> 'SELECT'
                OR acl.grantor <> relation.relowner
                OR acl.is_grantable
              )
            )) AS invalid_table_acl_count,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND (
             attribute.attname <> 'read'
             OR acl.grantee <> (
               SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
             )
             OR acl.privilege_type <> 'UPDATE'
             OR acl.grantor <> relation.relowner
             OR acl.is_grantable
           )) AS invalid_column_acl_count,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attname = 'read'
           AND acl.grantee = (
             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
           )
           AND acl.privilege_type = 'UPDATE'
           AND acl.grantor = relation.relowner
           AND NOT acl.is_grantable) AS runtime_read_update_acl_count
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'Notification'
       AND relation.relkind = 'r'`,
    [runtimeRole],
  )).rows;
  if (rows.length !== 1) throw new Error("Notification table is missing or ambiguous");
  return rows[0];
}

async function readNotificationFunctions(client, runtimeRole) {
  return (await client.query(
    `SELECT
       procedure.proname AS identity,
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
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
           ) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) AS public_can_execute,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.privilege_type <> 'EXECUTE'
            OR acl.grantee = 0
            OR acl.grantee NOT IN (
              procedure.proowner,
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
            )
            OR (
              acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
              AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
            )) AS invalid_acl_count
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = procedure.pronamespace
     JOIN pg_catalog.pg_language AS language
       ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND procedure.oid = ANY(ARRAY[
         pg_catalog.to_regprocedure(
           'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'
         ),
         pg_catalog.to_regprocedure(
           'public.grainline_notification_create_order_event(text,text,public."NotificationType",text,text,text)'
         )
       ]::oid[])
     ORDER BY identity`,
    [runtimeRole],
  )).rows;
}

export async function readBlockedCheckoutRefundDeliveryProductionSnapshot(
  connectionString,
  {
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  verifyBlockedCheckoutRefundDeliveryMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-blocked-checkout-refund-delivery-scope-proof",
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
    const orderPaymentEventCompatible =
      await readOrderPaymentEventCompatibleProductionSnapshotFromClient(
        client,
        { runtimeRole, root },
      );
    const candidateLedgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = $1
        ORDER BY started_at, id`,
      [BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION],
    )).rows;
    const notificationTable = await readNotificationTable(client, runtimeRole);
    const notificationPolicies = await readNotificationPolicyState(client);
    const notificationFunctions = await readNotificationFunctions(
      client,
      runtimeRole,
    );
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      orderPaymentEventCompatible,
      candidateLedgerRows,
      notificationTable,
      notificationPolicies,
      notificationFunctions,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyBlockedCheckoutRefundDeliveryProductionScope(
  config,
  {
    readSnapshot = readBlockedCheckoutRefundDeliveryProductionSnapshot,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertBlockedCheckoutRefundDeliveryProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseBlockedCheckoutRefundDeliveryScopeEnvironment();
    const result = await verifyBlockedCheckoutRefundDeliveryProductionScope(
      config,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Blocked-checkout refund delivery production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
