#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
  orderPaymentEventReadAuthorityFunctionSources,
  verifyOrderPaymentEventReadAuthorityMigrationBytes,
} from "./order-payment-event-read-authority-catalog.mjs";
import {
  assertOrderPaymentEventInvariantsProductionScope,
  parseOrderPaymentEventInvariantsScopeEnvironment,
  readOrderPaymentEventInvariantsProductionSnapshotFromClient,
} from "./verify-order-payment-event-invariants-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";

export const ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGES = Object.freeze([
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
  return row?.migration_name === ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION
    && row.checksum === ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseOrderPaymentEventReadAuthorityScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGE",
  );
  if (!ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent read-authority scope stage is invalid");
  }
  const predecessor = parseOrderPaymentEventInvariantsScopeEnvironment({
    ...env,
    ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertOrderPaymentEventReadAuthorityLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGES.includes(stage)
    || rows.some(
      (row) => row?.migration_name
        !== ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
    )
  ) {
    throw new Error("OrderPaymentEvent read-authority ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error(
      "OrderPaymentEvent read-authority ledger is not at the reviewed stage",
    );
  }
  return applied;
}

function assertFunctions(rows, applied, migrationRole, root) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error(
        "OrderPaymentEvent read-authority functions exist before migration",
      );
    }
    return;
  }
  const sources = orderPaymentEventReadAuthorityFunctionSources(root);
  const byIdentity = new Map(
    Array.isArray(rows) ? rows.map((row) => [row?.identity, row]) : [],
  );
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.length
    || byIdentity.size !== ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.length
    || !ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.every((identity) => {
      const row = byIdentity.get(identity);
      return row?.identity === identity
        && row.owner_name === migrationRole
        && row.security_definer === true
        && row.function_kind === "f"
        && row.language_name === "plpgsql"
        && row.volatility === "s"
        && row.parallel_safety === "s"
        && row.leakproof === false
        && Array.isArray(row.config)
        && row.config.length === 1
        && row.config[0] === "search_path=pg_catalog"
        && row.runtime_can_execute === true
        && row.runtime_execute_grantable === false
        && row.public_can_execute === false
        && Number(row.invalid_acl_count) === 0
        && sha256(row.function_source ?? "") === sha256(sources[identity]);
    })
  ) {
    throw new Error("OrderPaymentEvent read-authority function catalog drifted");
  }
}

export function assertOrderPaymentEventReadAuthorityProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertOrderPaymentEventInvariantsProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const applied = assertOrderPaymentEventReadAuthorityLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  const predecessor = assertPredecessor(
    snapshot?.orderPaymentEventInvariants,
    "after",
    { migrationRole, runtimeRole, root },
  );
  assertFunctions(snapshot?.functions, applied, migrationRole, root);
  return Object.freeze({
    orderPaymentEventInvariantsApplied:
      predecessor.orderPaymentEventInvariantsApplied,
    orderPaymentEventReadAuthorityApplied: applied,
    runtimeFunctionCount: applied
      ? ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.length
      : 0,
    runtimeExecuteOnly: applied,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied
      ? "read-authority-prepared"
      : "read-authority-predecessor",
    productionChangedByProof: false,
  });
}

async function readFunctions(client, runtimeRole) {
  const names = ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.map(
    (identity) => identity.slice(0, identity.indexOf("(")),
  );
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
       pg_catalog.has_function_privilege(
         $1, procedure.oid, 'EXECUTE WITH GRANT OPTION'
       ) AS runtime_execute_grantable,
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
            OR acl.grantee NOT IN (
              procedure.proowner,
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
            )) AS invalid_acl_count
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = procedure.pronamespace
     JOIN pg_catalog.pg_language AS language
       ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($2::text[])
     ORDER BY identity`,
    [runtimeRole, names],
  )).rows;
}

export async function readOrderPaymentEventReadAuthorityProductionSnapshotFromClient(
  client,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
  const orderPaymentEventInvariants =
    await readOrderPaymentEventInvariantsProductionSnapshotFromClient(
      client,
      { runtimeRole, root },
    );
  const candidateLedgerRows = (await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id`,
    [ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION],
  )).rows;
  const functions = await readFunctions(client, runtimeRole);
  return Object.freeze({
    orderPaymentEventInvariants,
    candidateLedgerRows,
    functions,
  });
}

export async function readOrderPaymentEventReadAuthorityProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-read-authority-scope-proof",
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
      await readOrderPaymentEventReadAuthorityProductionSnapshotFromClient(
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

export async function verifyOrderPaymentEventReadAuthorityProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentEventReadAuthorityProductionSnapshot,
    assertPredecessor = assertOrderPaymentEventInvariantsProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentEventReadAuthorityProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentEventReadAuthorityScopeEnvironment();
    const result =
      await verifyOrderPaymentEventReadAuthorityProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "OrderPaymentEvent read-authority production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
