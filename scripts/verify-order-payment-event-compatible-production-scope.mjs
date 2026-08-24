#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
} from "./order-refund-claim-generation-catalog.mjs";
import {
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
} from "./order-refund-record-authority-catalog.mjs";
import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
} from "./order-payment-signed-authority-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
} from "./order-refund-reconciliation-authority-catalog.mjs";
import {
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
} from "./order-refund-inactive-seller-recovery-catalog.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const MIGRATION_ROOT = path.join("prisma", "migrations");
const BASELINE_CASE_MIGRATION =
  "20260729044000_prepare_case_seller_refund_authority";

export const ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);

export const ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS = Object.freeze([
  Object.freeze({
    name: ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
    checksum: ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
    state: "claim-prepared",
  }),
  Object.freeze({
    name: ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
    checksum: ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
    state: "record-prepared",
  }),
  Object.freeze({
    name: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
    state: "signed-prepared",
  }),
  Object.freeze({
    name: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    checksum: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
    state: "reconciliation-prepared",
  }),
  Object.freeze({
    name: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    checksum: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
    state: "prepared",
  }),
]);

const REFUND_CLAIM_COLUMNS = Object.freeze([
  Object.freeze({ column_name: "refundClaimGeneration", data_type: "bigint", is_nullable: "NO" }),
  Object.freeze({ column_name: "refundClaimId", data_type: "character varying", is_nullable: "YES" }),
  Object.freeze({ column_name: "refundClaimIdempotencyScope", data_type: "character varying", is_nullable: "YES" }),
  Object.freeze({ column_name: "refundClaimProviderAuthorizedAt", data_type: "timestamp without time zone", is_nullable: "YES" }),
  Object.freeze({ column_name: "refundClaimSource", data_type: "character varying", is_nullable: "YES" }),
  Object.freeze({ column_name: "refundClaimSourceGeneration", data_type: "bigint", is_nullable: "YES" }),
  Object.freeze({ column_name: "refundClaimSourceId", data_type: "character varying", is_nullable: "YES" }),
]);

const PRIVATE_FUNCTION_IDENTITIES = new Set([
  "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_order_refund_reconciliation_immutable()",
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

export function parseOrderPaymentEventCompatibleScopeEnvironment(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "OrderPaymentEvent compatible production scope proof",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("payment compatible scope proof requires manual main");
  }
  const directUrl = required(env, "DIRECT_URL");
  const stage = required(env, "ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE");
  if (!ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGES.includes(stage)) {
    throw new Error("payment compatible scope stage is invalid");
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

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed === "") return "";
  return trimmed.split(",").map((declaration) => {
    const tokens = declaration.trim()
      .replace(/\s+DEFAULT\s+[\s\S]*$/iu, "")
      .replace(/^IN\s+/iu, "")
      .split(/\s+/u);
    if (tokens.length < 2) {
      throw new Error("reviewed payment function argument is not named");
    }
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

function migrationFunctionSources(root, migrationName) {
  const sql = readFileSync(
    path.join(root, MIGRATION_ROOT, migrationName, "migration.sql"),
    "utf8",
  );
  const sources = new Map();
  const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/gu;
  for (const match of sql.matchAll(pattern)) {
    const identity = `${match[1]}(${normalizeIdentityArguments(match[2])})`;
    sources.set(identity, match[4]);
  }
  return sources;
}

export function orderPaymentEventCompatibleFunctionSources(
  root = process.cwd(),
  prefixLength = ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length,
) {
  if (
    !Number.isInteger(prefixLength)
    || prefixLength < 0
    || prefixLength > ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length
  ) {
    throw new Error("payment compatible prefix length is invalid");
  }
  const baseline = migrationFunctionSources(root, BASELINE_CASE_MIGRATION);
  const sources = new Map();
  const caseIdentity = [...baseline.keys()].find((identity) =>
    identity.startsWith("grainline_case_seller_refund_apply(")
  );
  if (!caseIdentity) throw new Error("baseline Case seller-refund function drifted");
  sources.set(caseIdentity, baseline.get(caseIdentity));
  for (const migration of ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.slice(
    0,
    prefixLength,
  )) {
    for (const [identity, source] of migrationFunctionSources(root, migration.name)) {
      sources.set(identity, source);
    }
  }
  return Object.freeze(Object.fromEntries([...sources].sort()));
}

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function assertOrderPaymentEventCompatibleLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGES.includes(stage)
  ) {
    throw new Error("payment compatible migration ledger is invalid");
  }
  const expectedNames = new Set(
    ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.map((entry) => entry.name),
  );
  if (rows.some((row) => !expectedNames.has(row?.migration_name))) {
    throw new Error("payment compatible migration ledger has an unknown row");
  }
  let prefixLength = 0;
  let encounteredAbsent = false;
  for (const migration of ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS) {
    const matches = rows.filter((row) => row?.migration_name === migration.name);
    if (matches.length === 0) {
      encounteredAbsent = true;
      continue;
    }
    if (
      encounteredAbsent
      || matches.length !== 1
      || !isAppliedRow(matches[0], migration.checksum)
    ) {
      throw new Error("payment compatible migration ledger is not an exact prefix");
    }
    prefixLength += 1;
  }
  if (
    (stage === "before" && prefixLength !== 0)
    || (stage === "after"
      && prefixLength !== ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length)
  ) {
    throw new Error("payment compatible migration ledger is at the wrong stage");
  }
  return prefixLength;
}

function assertExactRows(actual, expected, label) {
  if (
    !Array.isArray(actual)
    || actual.length !== expected.length
    || !actual.every((entry, index) =>
      Object.entries(expected[index]).every(([key, value]) => entry?.[key] === value)
    )
  ) {
    throw new Error(`${label} is not exact`);
  }
}

function assertOrderPaymentEventTable(table, migrationRole) {
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== false
    || table.rls_forced !== false
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== true
    || table.runtime_can_insert !== true
    || table.runtime_can_update !== true
    || table.runtime_can_delete !== true
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.column_acl_count) !== 0
  ) {
    throw new Error("OrderPaymentEvent predecessor table posture drifted");
  }
}

function assertReconciliationTable(table, prefixLength, migrationRole) {
  if (prefixLength < 4) {
    if (table !== null) {
      throw new Error("OrderRefundReconciliation exists before its migration");
    }
    return;
  }
  if (
    table?.owner_name !== migrationRole
    || table.rls_enabled !== true
    || table.rls_forced !== true
    || Number(table.policy_count) !== 0
    || table.runtime_can_select !== false
    || table.runtime_can_insert !== false
    || table.runtime_can_update !== false
    || table.runtime_can_delete !== false
    || table.public_has_crud !== false
    || Number(table.invalid_table_acl_count) !== 0
    || Number(table.column_acl_count) !== 0
  ) {
    throw new Error("OrderRefundReconciliation private table posture drifted");
  }
}

function assertFunctions(functions, prefixLength, migrationRole, root) {
  const sources = orderPaymentEventCompatibleFunctionSources(root, prefixLength);
  const expected = Object.entries(sources);
  if (
    !Array.isArray(functions)
    || functions.length !== expected.length
    || !functions.every((entry, index) => {
      const [identity, source] = expected[index];
      const runtimeExpected = !PRIVATE_FUNCTION_IDENTITIES.has(identity);
      return entry.identity === identity
        && entry.owner_name === migrationRole
        && entry.function_kind === "f"
        && entry.security_definer === (identity
          !== "grainline_order_refund_reconciliation_immutable()")
        && entry.leakproof === false
        && Array.isArray(entry.config)
        && entry.config.length === 1
        && entry.config[0] === "search_path=pg_catalog"
        && entry.runtime_can_execute === runtimeExpected
        && entry.public_can_execute === false
        && Number(entry.invalid_acl_count) === 0
        && sha256(entry.function_source ?? "") === sha256(source);
    })
  ) {
    throw new Error("Order payment compatible function catalog drifted");
  }
}

export function assertOrderPaymentEventCompatibleProductionScope(
  snapshot,
  stage,
  {
    migrationRole = MIGRATION_ROLE,
    root = process.cwd(),
  } = {},
) {
  const prefixLength = assertOrderPaymentEventCompatibleLedger(
    snapshot?.ledgerRows,
    stage,
  );
  assertOrderPaymentEventTable(snapshot?.orderPaymentEventTable, migrationRole);
  assertReconciliationTable(
    snapshot?.reconciliationTable ?? null,
    prefixLength,
    migrationRole,
  );
  assertExactRows(
    snapshot?.refundClaimColumns,
    prefixLength >= 1 ? REFUND_CLAIM_COLUMNS : [],
    "Order refund claim columns",
  );
  assertExactRows(
    snapshot?.paymentEventColumns,
    prefixLength >= 3
      ? [{
          column_name: "stripeEventCreatedSeconds",
          data_type: "bigint",
          is_nullable: "YES",
        }]
      : [],
    "OrderPaymentEvent provider-time column",
  );
  assertFunctions(snapshot?.functions, prefixLength, migrationRole, root);
  const state = prefixLength === 0
    ? "predecessor"
    : ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[prefixLength - 1].state;
  return Object.freeze({
    compatibleMigrationPrefixLength: prefixLength,
    orderPaymentEventRlsEnabled: false,
    orderPaymentEventRlsForced: false,
    predecessorRuntimeCrudRetained: true,
    reconciliationPolicylessForce:
      prefixLength >= 4,
    reviewedMigrationCount: ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length,
    state,
    productionChangedByProof: false,
  });
}

async function readRelationPosture(client, relationName, runtimeRole) {
  const rows = (await client.query(
    `SELECT
       pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
       relation.relrowsecurity AS rls_enabled,
       relation.relforcerowsecurity AS rls_forced,
       (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = relation.oid) AS policy_count,
       pg_catalog.has_table_privilege($1, relation.oid, 'SELECT') AS runtime_can_select,
       pg_catalog.has_table_privilege($1, relation.oid, 'INSERT') AS runtime_can_insert,
       pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE') AS runtime_can_update,
       pg_catalog.has_table_privilege($1, relation.oid, 'DELETE') AS runtime_can_delete,
       EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
         ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = ANY(ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[])
       ) AS public_has_crud,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl
         WHERE acl.grantee NOT IN (
           relation.relowner,
           (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
         ) OR (
           acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
           AND (acl.privilege_type <> ALL(ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[])
             OR acl.grantor <> relation.relowner OR acl.is_grantable)
         )) AS invalid_table_acl_count,
       (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0 AND NOT attribute.attisdropped) AS column_acl_count
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relname = $2
       AND relation.relkind = 'r'`,
    [runtimeRole, relationName],
  )).rows;
  if (rows.length > 1) throw new Error(`${relationName} relation is ambiguous`);
  return rows[0] ?? null;
}

export async function readOrderPaymentEventCompatibleProductionSnapshot(
  connectionString,
  {
    runtimeRole = RUNTIME_ROLE,
  } = {},
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-compatible-scope-proof",
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
    if (readOnly !== "on") throw new Error("scope transaction is not read-only");
    const migrationNames = ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.map(
      (entry) => entry.name,
    );
    const ledgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])
        ORDER BY migration_name, started_at, id`,
      [migrationNames],
    )).rows;
    const orderPaymentEventTable = await readRelationPosture(
      client,
      "OrderPaymentEvent",
      runtimeRole,
    );
    if (!orderPaymentEventTable) throw new Error("OrderPaymentEvent table is missing");
    const reconciliationTable = await readRelationPosture(
      client,
      "OrderRefundReconciliation",
      runtimeRole,
    );
    const refundClaimColumns = (await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Order'
          AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [REFUND_CLAIM_COLUMNS.map((entry) => entry.column_name)],
    )).rows;
    const paymentEventColumns = (await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'OrderPaymentEvent'
          AND column_name = 'stripeEventCreatedSeconds'
        ORDER BY column_name`,
    )).rows;
    const allFunctionSources = orderPaymentEventCompatibleFunctionSources(
      process.cwd(),
      ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length,
    );
    const functionNames = [...new Set(
      Object.keys(allFunctionSources).map((identity) =>
        identity.slice(0, identity.indexOf("("))
      ),
    )];
    const functions = (await client.query(
      `SELECT
         procedure.proname || '(' || pg_catalog.replace(
           pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
         ) || ')' AS identity,
         pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
         procedure.prosecdef AS security_definer,
         procedure.prokind AS function_kind,
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
           WHERE acl.privilege_type <> 'EXECUTE' OR acl.grantee = 0
             OR acl.grantee NOT IN (
               procedure.proowner,
               (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
             ) OR (
               acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
               AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
             )) AS invalid_acl_count
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = ANY($2::text[])
       ORDER BY identity`,
      [runtimeRole, functionNames],
    )).rows;
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      ledgerRows,
      orderPaymentEventTable,
      reconciliationTable,
      refundClaimColumns,
      paymentEventColumns,
      functions,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyOrderPaymentEventCompatibleProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentEventCompatibleProductionSnapshot,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentEventCompatibleProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole }),
    config.stage,
    { migrationRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentEventCompatibleScopeEnvironment();
    const result = await verifyOrderPaymentEventCompatibleProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("OrderPaymentEvent compatible scope proof failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
