#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
  orderPaymentSignedRefundIdentityFunctionSource,
  predecessorOrderPaymentSignedRefundFunctionSource,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  assertBlockedCheckoutTransferBindingProductionScope,
  parseBlockedCheckoutTransferBindingScopeEnvironment,
  readBlockedCheckoutTransferBindingProductionSnapshotFromClient,
} from "./verify-blocked-checkout-transfer-binding-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const FUNCTION_IDENTITY =
  "public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)";

export const ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGES = Object.freeze([
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
  return row?.migration_name === ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION
    && row.checksum === ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseOrderPaymentSignedRefundIdentityScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGE",
  );
  if (!ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "signed-refund identity scope stage must be before, after, or restart",
    );
  }
  const predecessor = parseBlockedCheckoutTransferBindingScopeEnvironment({
    ...env,
    BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertOrderPaymentSignedRefundIdentityLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name !== ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    )
  ) {
    throw new Error("signed-refund identity ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "signed-refund identity ledger is not at the exact reviewed stage",
    );
  }
  return applied;
}

export function assertOrderPaymentSignedRefundIdentityFunction(
  row,
  applied,
  migrationRole = MIGRATION_ROLE,
  root = process.cwd(),
) {
  const expectedSource = applied
    ? orderPaymentSignedRefundIdentityFunctionSource(root)
    : predecessorOrderPaymentSignedRefundFunctionSource(root);
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
    || sha256(row.function_source ?? "") !== sha256(expectedSource)
  ) {
    throw new Error("signed-refund identity function catalog drifted");
  }
}

export function assertOrderPaymentSignedRefundIdentityProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertBlockedCheckoutTransferBindingProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const predecessor = assertPredecessor(
    snapshot?.blockedCheckoutTransferBinding,
    "after",
    { migrationRole, runtimeRole, root },
  );
  const applied = assertOrderPaymentSignedRefundIdentityLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  assertOrderPaymentSignedRefundIdentityFunction(
    snapshot?.signedRefundFunction ?? null,
    applied,
    migrationRole,
    root,
  );
  return Object.freeze({
    blockedCheckoutTransferBindingApplied:
      predecessor.blockedCheckoutTransferBindingApplied,
    signedRefundIdentityApplied: applied,
    runtimeExecuteOnly: true,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied
      ? "signed-refund-identity-compatible"
      : "signed-refund-identity-predecessor",
    productionChangedByProof: false,
  });
}

async function readSignedRefundFunction(client, runtimeRole) {
  const rows = (await client.query(
    `SELECT
       pg_catalog.quote_ident(namespace.nspname)
         || '.' || pg_catalog.quote_ident(procedure.proname)
         || '(' || pg_catalog.replace(
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
         SELECT 1
           FROM pg_catalog.aclexplode(
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
  if (rows.length !== 1) {
    throw new Error("signed-refund identity function cardinality drifted");
  }
  return rows[0];
}

export async function readOrderPaymentSignedRefundIdentityProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentSignedRefundIdentityMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-signed-refund-identity-scope-proof",
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
    const blockedCheckoutTransferBinding =
      await readBlockedCheckoutTransferBindingProductionSnapshotFromClient(
        client,
        { runtimeRole, root },
      );
    const candidateLedgerRows = (await client.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = $1
        ORDER BY started_at, id`,
      [ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION],
    )).rows;
    const signedRefundFunction = await readSignedRefundFunction(
      client,
      runtimeRole,
    );
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      blockedCheckoutTransferBinding,
      candidateLedgerRows,
      signedRefundFunction,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export async function verifyOrderPaymentSignedRefundIdentityProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentSignedRefundIdentityProductionSnapshot,
    assertPredecessor = assertBlockedCheckoutTransferBindingProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentSignedRefundIdentityProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentSignedRefundIdentityScopeEnvironment();
    const result = await verifyOrderPaymentSignedRefundIdentityProductionScope(
      config,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Signed-refund identity production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
