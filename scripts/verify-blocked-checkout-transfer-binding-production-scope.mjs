#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
  blockedCheckoutTransferBindingFunctionSource,
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";
import {
  assertBlockedCheckoutRefundDeliveryProductionScope,
  parseBlockedCheckoutRefundDeliveryScopeEnvironment,
  readBlockedCheckoutRefundDeliveryProductionSnapshotFromClient,
} from "./verify-blocked-checkout-refund-delivery-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const FUNCTION_IDENTITY =
  "public.grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)";

export const BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGES = Object.freeze([
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
  return row?.migration_name === BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION
    && row.checksum === BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseBlockedCheckoutTransferBindingScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE",
  );
  if (!BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "blocked-checkout transfer binding scope stage must be before, after, or restart",
    );
  }
  const predecessor = parseBlockedCheckoutRefundDeliveryScopeEnvironment({
    ...env,
    BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertBlockedCheckoutTransferBindingLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name !== BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    )
  ) {
    throw new Error("blocked-checkout transfer binding ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "blocked-checkout transfer binding ledger is not at the exact reviewed stage",
    );
  }
  return applied;
}

export function assertTransferBindingFunction(row, applied, migrationRole) {
  if (!applied) {
    if (row !== null) {
      throw new Error("blocked-checkout transfer binding function exists before its migration");
    }
    return;
  }
  if (
    row?.identity !== FUNCTION_IDENTITY
    || row.owner_name !== migrationRole
    || row.security_definer !== true
    || row.function_kind !== "f"
    || row.language_name !== "plpgsql"
    || row.volatility !== "v"
    || row.parallel_safety !== "u"
    || row.leakproof !== false
    || !Array.isArray(row.config)
    || row.config.length !== 1
    || row.config[0] !== "search_path=pg_catalog"
    || row.runtime_can_execute !== true
    || row.public_can_execute !== false
    || Number(row.invalid_acl_count) !== 0
    || sha256(row.function_source ?? "")
      !== sha256(blockedCheckoutTransferBindingFunctionSource())
  ) {
    throw new Error("blocked-checkout transfer binding function catalog drifted");
  }
}

export function assertBlockedCheckoutTransferBindingProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertBlockedCheckoutRefundDeliveryProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const predecessor = assertPredecessor(
    snapshot?.blockedCheckoutRefundDelivery,
    "after",
    { migrationRole, runtimeRole, root },
  );
  const applied = assertBlockedCheckoutTransferBindingLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  assertTransferBindingFunction(
    snapshot?.transferBindingFunction ?? null,
    applied,
    migrationRole,
  );
  return Object.freeze({
    blockedCheckoutRefundDeliveryApplied:
      predecessor.blockedCheckoutRefundDeliveryApplied,
    blockedCheckoutTransferBindingApplied: applied,
    runtimeExecuteOnly: applied,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied ? "transfer-binding-compatible" : "transfer-binding-predecessor",
    productionChangedByProof: false,
  });
}

async function readTransferBindingFunction(client, runtimeRole) {
  const rows = (await client.query(
    `SELECT
       pg_catalog.quote_ident(namespace.nspname)
         || '.' || pg_catalog.quote_ident(procedure.proname)
         || '(' || pg_catalog.replace(
           pg_catalog.oidvectortypes(procedure.proargtypes),
           ', ',
           ','
         ) || ')'
         AS identity,
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
     JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE procedure.oid = pg_catalog.to_regprocedure($2)`,
    [runtimeRole, FUNCTION_IDENTITY],
  )).rows;
  if (rows.length > 1) {
    throw new Error("blocked-checkout transfer binding function is ambiguous");
  }
  return rows[0] ?? null;
}

export async function readBlockedCheckoutTransferBindingProductionSnapshot(
  connectionString,
  {
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  verifyBlockedCheckoutTransferBindingMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-blocked-checkout-transfer-binding-scope-proof",
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
    const blockedCheckoutRefundDelivery =
      await readBlockedCheckoutRefundDeliveryProductionSnapshotFromClient(
        client,
        { runtimeRole, root },
      );
    const candidateLedgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = $1
        ORDER BY started_at, id`,
      [BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION],
    )).rows;
    const transferBindingFunction = await readTransferBindingFunction(
      client,
      runtimeRole,
    );
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      blockedCheckoutRefundDelivery,
      candidateLedgerRows,
      transferBindingFunction,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyBlockedCheckoutTransferBindingProductionScope(
  config,
  {
    assertPredecessor = assertBlockedCheckoutRefundDeliveryProductionScope,
    readSnapshot = readBlockedCheckoutTransferBindingProductionSnapshot,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertBlockedCheckoutTransferBindingProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseBlockedCheckoutTransferBindingScopeEnvironment();
    const result = await verifyBlockedCheckoutTransferBindingProductionScope(
      config,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Blocked-checkout transfer binding production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
