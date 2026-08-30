#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
  ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS,
  ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
  ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS,
  orderPaymentEventInvariantFunctionSources,
  verifyOrderPaymentEventInvariantsMigrationBytes,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  assertOrderPaymentSignedDisputeIdentityProductionScope,
  parseOrderPaymentSignedDisputeIdentityScopeEnvironment,
  readOrderPaymentSignedDisputeIdentityProductionSnapshotFromClient,
} from "./verify-order-payment-signed-dispute-identity-production-scope.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const RUNTIME_ROLE = "grainline_app_runtime";

export const ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);

const CONSTRAINT_FRAGMENTS = Object.freeze({
  OrderPaymentEvent_amountCents_check: ["amountCents", ">= 0"],
  OrderPaymentEvent_currency_check: ["currency", "[a-z]{3}"],
  OrderPaymentEvent_eventType_check: ["eventType", "REFUND", "DISPUTE"],
  OrderPaymentEvent_source_shape_check: [
    "charge.refunded",
    "latestRefundId",
    "refundIds",
    "SELLER_REFUND_RECORDED",
    "CASE_REFUND_RECORDED",
    "BLOCKED_CHECKOUT_REFUND_RECORDED",
  ],
  OrderPaymentEvent_text_shape_check: ["btrim", "jsonb_typeof", "metadata"],
  OrderPaymentEvent_timestamp_immutable_shape_check: ["updatedAt", "createdAt"],
});

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
  return row?.migration_name === ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION
    && row.checksum === ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function parseOrderPaymentEventInvariantsScopeEnvironment(
  env = process.env,
) {
  const stage = required(env, "ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGE");
  if (!ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent invariant scope stage is invalid");
  }
  const predecessor = parseOrderPaymentSignedDisputeIdentityScopeEnvironment({
    ...env,
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: predecessor.directUrl,
    identity: predecessor.identity,
    stage,
  });
}

export function assertOrderPaymentEventInvariantsLedger(rows, stage) {
  if (
    !Array.isArray(rows)
    || !ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGES.includes(stage)
    || rows.some((row) => row?.migration_name !== ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION)
  ) {
    throw new Error("OrderPaymentEvent invariant ledger is invalid");
  }
  const applied = rows.length === 1 && isAppliedRow(rows[0]);
  if (
    rows.length > 1
    || (rows.length === 1 && !applied)
    || (stage === "before" && rows.length !== 0)
    || (stage === "after" && !applied)
  ) {
    throw new Error("OrderPaymentEvent invariant ledger is not at the reviewed stage");
  }
  return applied;
}

function assertConstraints(rows, applied) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("OrderPaymentEvent invariant constraints exist before migration");
    }
    return;
  }
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS.length
    || !rows.every((row, index) => {
      const name = ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS[index];
      const definition = row?.definition ?? "";
      return row?.constraint_name === name
        && row.constraint_type === "c"
        && row.validated === true
        && CONSTRAINT_FRAGMENTS[name].every((fragment) =>
          definition.includes(fragment)
        );
    })
  ) {
    throw new Error("OrderPaymentEvent invariant constraint catalog drifted");
  }
}

function assertFunctions(rows, applied, migrationRole, root) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("OrderPaymentEvent invariant functions exist before migration");
    }
    return;
  }
  const sources = orderPaymentEventInvariantFunctionSources(root);
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS.length
    || !rows.every((row, index) => {
      const name = ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS[index];
      return row?.identity === `${name}()`
        && row.owner_name === migrationRole
        && row.security_definer === (
          name !== "grainline_order_payment_event_immutable"
        )
        && row.function_kind === "f"
        && row.language_name === "plpgsql"
        && row.volatility === "v"
        && row.parallel_safety === "u"
        && row.leakproof === false
        && Array.isArray(row.config)
        && row.config.length === 1
        && row.config[0] === "search_path=pg_catalog"
        && row.runtime_can_execute === false
        && row.public_can_execute === false
        && Number(row.invalid_acl_count) === 0
        && sha256(row.function_source ?? "") === sha256(sources[`${name}()`]);
    })
  ) {
    throw new Error("OrderPaymentEvent invariant function catalog drifted");
  }
}

function assertTriggers(rows, applied) {
  if (!applied) {
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error("OrderPaymentEvent invariant triggers exist before migration");
    }
    return;
  }
  const expectedRelations = Object.freeze({
    grainline_order_currency_payment_immutable: "Order",
    grainline_order_payment_event_immutable: "OrderPaymentEvent",
    grainline_order_payment_event_validate_insert: "OrderPaymentEvent",
  });
  if (
    !Array.isArray(rows)
    || rows.length !== ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS.length
    || !rows.every((row, index) => {
      const name = ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS[index];
      return row?.trigger_name === name
        && row.relation_name === expectedRelations[name]
        && row.function_name === name
        && row.definition.includes(`TRIGGER ${name}`)
        && row.definition.includes(`EXECUTE FUNCTION ${name}()`);
    })
  ) {
    throw new Error("OrderPaymentEvent invariant trigger catalog drifted");
  }
}

export function assertOrderPaymentEventInvariantsProductionScope(
  snapshot,
  stage,
  {
    assertPredecessor = assertOrderPaymentSignedDisputeIdentityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  const applied = assertOrderPaymentEventInvariantsLedger(
    snapshot?.candidateLedgerRows,
    stage,
  );
  const predecessor = assertPredecessor(
    snapshot?.signedDisputeIdentity,
    "after",
    { migrationRole, runtimeRole, root },
  );
  assertConstraints(snapshot?.constraints, applied);
  assertFunctions(snapshot?.functions, applied, migrationRole, root);
  assertTriggers(snapshot?.triggers, applied);
  return Object.freeze({
    signedDisputeIdentityApplied: predecessor.signedDisputeIdentityApplied,
    orderPaymentEventInvariantsApplied: applied,
    validatedConstraintCount: applied
      ? ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS.length
      : 0,
    triggerCount: applied ? ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS.length : 0,
    orderPaymentEventRlsEnabled: false,
    predecessorRuntimeCrudRetained: true,
    state: applied ? "invariants-prepared" : "invariants-predecessor",
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
            OR acl.grantee NOT IN (
              procedure.proowner,
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
            )) AS invalid_acl_count
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($2::text[])
     ORDER BY identity`,
    [runtimeRole, ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS],
  )).rows;
}

export async function readOrderPaymentEventInvariantsProductionSnapshotFromClient(
  client,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventInvariantsMigrationBytes(root);
  const signedDisputeIdentity =
    await readOrderPaymentSignedDisputeIdentityProductionSnapshotFromClient(
      client,
      { runtimeRole, root },
    );
  const candidateLedgerRows = (await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id`,
    [ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION],
  )).rows;
  const constraints = (await client.query(
    `SELECT constraint_record.conname AS constraint_name,
            constraint_record.contype AS constraint_type,
            constraint_record.convalidated AS validated,
            pg_catalog.pg_get_constraintdef(constraint_record.oid, true) AS definition
       FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = 'public."OrderPaymentEvent"'::regclass
        AND constraint_record.conname = ANY($1::text[])
      ORDER BY constraint_name`,
    [ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS],
  )).rows;
  const functions = await readFunctions(client, runtimeRole);
  const triggers = (await client.query(
    `SELECT trigger_record.tgname AS trigger_name,
            relation.relname AS relation_name,
            procedure.proname AS function_name,
            pg_catalog.pg_get_triggerdef(trigger_record.oid, true) AS definition
       FROM pg_catalog.pg_trigger AS trigger_record
       JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_record.tgfoid
      WHERE namespace.nspname = 'public'
        AND trigger_record.tgname = ANY($1::text[])
        AND NOT trigger_record.tgisinternal
      ORDER BY trigger_name`,
    [ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS],
  )).rows;
  return Object.freeze({
    signedDisputeIdentity,
    candidateLedgerRows,
    constraints,
    functions,
    triggers,
  });
}

export async function readOrderPaymentEventInvariantsProductionSnapshot(
  connectionString,
  { runtimeRole = RUNTIME_ROLE, root = process.cwd() } = {},
) {
  verifyOrderPaymentEventInvariantsMigrationBytes(root);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-invariants-scope-proof",
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
      await readOrderPaymentEventInvariantsProductionSnapshotFromClient(
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

export async function verifyOrderPaymentEventInvariantsProductionScope(
  config,
  {
    readSnapshot = readOrderPaymentEventInvariantsProductionSnapshot,
    assertPredecessor = assertOrderPaymentSignedDisputeIdentityProductionScope,
    migrationRole = MIGRATION_ROLE,
    runtimeRole = RUNTIME_ROLE,
    root = process.cwd(),
  } = {},
) {
  return assertOrderPaymentEventInvariantsProductionScope(
    await readSnapshot(config.directUrl, { runtimeRole, root }),
    config.stage,
    { assertPredecessor, migrationRole, runtimeRole, root },
  );
}

async function main() {
  try {
    const config = parseOrderPaymentEventInvariantsScopeEnvironment();
    const result = await verifyOrderPaymentEventInvariantsProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "OrderPaymentEvent invariant production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
