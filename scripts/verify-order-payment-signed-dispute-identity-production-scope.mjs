#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
  orderPaymentSignedDisputeIdentityFunctionSource,
  predecessorOrderPaymentSignedDisputeFunctionSource,
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
import {
  assertOrderPaymentSignedRefundIdentityProductionScope,
  parseOrderPaymentSignedRefundIdentityScopeEnvironment,
  readOrderPaymentSignedRefundIdentityProductionSnapshotFromClient,
} from "./verify-order-payment-signed-refund-identity-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";
const FUNCTION_IDENTITY =
  "public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)";
const COMPATIBLE_FUNCTION_IDENTITY = FUNCTION_IDENTITY.replace(/^public\./u, "");

export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGES = Object.freeze([
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
  return row?.migration_name === ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION
    && row.checksum === ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseOrderPaymentSignedDisputeIdentityScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGE",
  );
  if (!ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGES.includes(stage)) {
    throw new Error(
      "signed-dispute identity scope stage must be before, after, or restart",
    );
  }
  const predecessor = parseOrderPaymentSignedRefundIdentityScopeEnvironment({
    ...env,
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertOrderPaymentSignedDisputeIdentityLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name
        !== ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    )
  ) {
    throw new Error("signed-dispute identity ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "signed-dispute identity ledger is not at the exact reviewed stage",
    );
  }
  return applied;
}

export function assertOrderPaymentSignedDisputeIdentityFunction(
  row,
  applied,
  migrationRole = MIGRATION_ROLE,
  root = process.cwd(),
) {
  const expectedSource = applied
    ? orderPaymentSignedDisputeIdentityFunctionSource(root)
    : predecessorOrderPaymentSignedDisputeFunctionSource(root);
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
    throw new Error("signed-dispute identity function catalog drifted");
  }
}

function predecessorSnapshotWithReviewedSignedDisputeSource(
  snapshot,
  signedDisputeFunction,
  applied,
  root,
) {
  if (!applied) return snapshot;

  const transferSnapshot = snapshot?.blockedCheckoutTransferBinding;
  const deliverySnapshot = transferSnapshot?.blockedCheckoutRefundDelivery;
  const compatibleSnapshot = deliverySnapshot?.orderPaymentEventCompatible;
  const functions = compatibleSnapshot?.functions;
  const matches = Array.isArray(functions)
    ? functions.filter(
      (entry) => entry?.identity === COMPATIBLE_FUNCTION_IDENTITY,
    )
    : [];
  if (
    matches.length !== 1
    || sha256(matches[0]?.function_source ?? "")
      !== sha256(signedDisputeFunction?.function_source ?? "")
  ) {
    throw new Error(
      "signed-dispute identity predecessor and candidate catalog views drifted",
    );
  }

  return {
    ...snapshot,
    blockedCheckoutTransferBinding: {
      ...transferSnapshot,
      blockedCheckoutRefundDelivery: {
        ...deliverySnapshot,
        orderPaymentEventCompatible: {
          ...compatibleSnapshot,
          functions: functions.map((entry) =>
            entry.identity === COMPATIBLE_FUNCTION_IDENTITY
              ? {
                ...entry,
                function_source:
                  predecessorOrderPaymentSignedDisputeFunctionSource(root),
              }
              : entry
          ),
        },
      },
    },
  };
}

export function assertOrderPaymentSignedDisputeIdentityProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertOrderPaymentSignedRefundIdentityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const applied = assertOrderPaymentSignedDisputeIdentityLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  assertOrderPaymentSignedDisputeIdentityFunction(
    snapshot?.signedDisputeFunction ?? null,
    applied,
    migrationRole,
    root,
  );
  const predecessor = assertPredecessor(
    predecessorSnapshotWithReviewedSignedDisputeSource(
      snapshot?.signedRefundIdentity,
      snapshot?.signedDisputeFunction ?? null,
      applied,
      root,
    ),
    "after",
    { migrationRole, runtimeRole, root },
  );
  return Object.freeze({
    signedRefundIdentityApplied: predecessor.signedRefundIdentityApplied,
    signedDisputeIdentityApplied: applied,
    runtimeExecuteOnly: true,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied
      ? "signed-dispute-identity-compatible"
      : "signed-dispute-identity-predecessor",
    productionChangedByProof: false,
  });
}

async function readSignedDisputeFunction(client, runtimeRole) {
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
    throw new Error("signed-dispute identity function cardinality drifted");
  }
  return rows[0];
}

export async function readOrderPaymentSignedDisputeIdentityProductionSnapshotFromClient(
  client,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes(root);
  const signedRefundIdentity =
    await readOrderPaymentSignedRefundIdentityProductionSnapshotFromClient(
      client,
      { runtimeRole, root },
    );
  const candidateLedgerRows = (await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id`,
    [ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION],
  )).rows;
  const signedDisputeFunction = await readSignedDisputeFunction(
    client,
    runtimeRole,
  );
  return Object.freeze({
    signedRefundIdentity,
    candidateLedgerRows,
    signedDisputeFunction,
  });
}

export async function readOrderPaymentSignedDisputeIdentityProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-signed-dispute-identity-scope-proof",
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
      await readOrderPaymentSignedDisputeIdentityProductionSnapshotFromClient(
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

export async function verifyOrderPaymentSignedDisputeIdentityProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentSignedDisputeIdentityProductionSnapshot,
    assertPredecessor = assertOrderPaymentSignedRefundIdentityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentSignedDisputeIdentityProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentSignedDisputeIdentityScopeEnvironment();
    const result = await verifyOrderPaymentSignedDisputeIdentityProductionScope(
      config,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "Signed-dispute identity production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
