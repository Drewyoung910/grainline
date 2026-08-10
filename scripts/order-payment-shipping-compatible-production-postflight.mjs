#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
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
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS,
  stripeWebhookEventFunctionSourceSha256,
} from "./stripe-webhook-event-function-source-catalog.mjs";

const { Client } = pg;

export const ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRMATION =
  "verify-production-order-payment-shipping-compatible-read-only";
export const ORDER_PAYMENT_SHIPPING_PRIVATE_FUNCTIONS = Object.freeze([
  ["grainline_order_item_seller_key_bind", ""],
  ["grainline_order_item_seller_key_complete", ""],
  ["grainline_order_seller_key_assert", "text"],
  ["grainline_order_seller_key_complete", ""],
]);
export const ORDER_PAYMENT_SHIPPING_RUNTIME_FUNCTIONS = Object.freeze(
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => Object.freeze([
    entry.name,
    entry.identityArguments,
  ])),
);

const REVIEWED_MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const EVIDENCE_PREFIX =
  "order-payment-shipping-compatible-production-postflight-";
const TARGET_TABLES = Object.freeze([
  "Listing",
  "Order",
  "OrderItem",
  "StripeWebhookEvent",
]);
const TARGET_CONSTRAINTS = Object.freeze([
  "Listing_id_sellerId_key",
  "Order_id_sellerProfileId_key",
  "Order_sellerProfileId_fkey",
  "OrderItem_sellerProfileId_fkey",
  "OrderItem_orderId_sellerProfileId_fkey",
  "OrderItem_listingId_sellerProfileId_fkey",
  "StripeWebhookEvent_claimGeneration_check",
]);
const TARGET_INDEXES = Object.freeze([
  "Order_sellerProfileId_createdAt_id_idx",
  "Order_sellerProfileId_fulfillmentStatus_createdAt_id_idx",
  "OrderItem_sellerProfileId_createdAt_id_idx",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function safePositiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  return value;
}

export function parseOrderPaymentShippingCompatiblePostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Order/payment/shipping compatible production postflight",
  );
  if (
    env.ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRM
      !== ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "Order/payment/shipping compatible postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Order/payment/shipping compatible postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Order/payment/shipping compatible postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_SHIPPING_COMPATIBLE_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error(
      "Order/payment/shipping compatible release commit is invalid",
    );
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeGuard = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(
    required(
      env,
      "ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH",
    ),
  );
  if (
    path.basename(evidencePath)
      !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "Order/payment/shipping compatible evidence path is not the fresh reviewed path",
    );
  }

  return Object.freeze({
    databaseUrl,
    evidencePath,
    mainCiRunId: safePositiveInteger(
      env,
      "ORDER_PAYMENT_SHIPPING_COMPATIBLE_MAIN_CI_RUN_ID",
    ),
    migrationRole: REVIEWED_MIGRATION_ROLE,
    migrationRunId: safePositiveInteger(
      env,
      "ORDER_PAYMENT_SHIPPING_COMPATIBLE_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeGuard,
  });
}

export function readOrderPaymentShippingCompatibleGitState(
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

export function assertOrderPaymentShippingCompatibleGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Order/payment/shipping compatible postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

export async function verifyRuntimeIdentity(client, expected, migrationRole) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin,
      pg_catalog.pg_has_role(CURRENT_USER, $1, 'MEMBER') AS member_of_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `, [migrationRole]);
  assert.deepEqual(result.rows, [{
    database_name: expected.databaseName,
    current_user_name: expected.runtimeRole,
    session_user_name: expected.runtimeRole,
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    member_of_owner: false,
  }]);
}

export async function verifyReadOnlyTransaction(client) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(result.rows, [{
    isolation: "repeatable read",
    read_only: "on",
  }]);
}

export async function verifyTablePosture(client, migrationRole) {
  const result = await client.query(`
    SELECT
      relation.relname AS table_name,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = relation.oid) AS policy_count,
      ARRAY(
        SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
          FROM pg_catalog.aclexplode(
            COALESCE(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )
          ) AS acl
         WHERE acl.grantee = (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = CURRENT_USER
         )
         ORDER BY 1
      ) AS runtime_privileges,
      ARRAY(
        SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
          FROM pg_catalog.aclexplode(
            COALESCE(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )
          ) AS acl
         WHERE acl.grantee = (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = CURRENT_USER
         )
           AND acl.is_grantable
         ORDER BY 1
      ) AS runtime_grant_options,
      ARRAY(
        SELECT DISTINCT pg_catalog.upper(acl.privilege_type)
          FROM pg_catalog.aclexplode(
            COALESCE(
              relation.relacl,
              pg_catalog.acldefault('r', relation.relowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
         ORDER BY 1
      ) AS public_privileges,
      ARRAY(
        SELECT DISTINCT pg_catalog.format(
          '%I:%s',
          attribute.attname,
          pg_catalog.upper(acl.privilege_type)
        )
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = relation.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND acl.grantee IN (
             0,
             (SELECT role.oid
                FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = CURRENT_USER)
           )
         ORDER BY 1
      ) AS direct_column_privileges
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'r'
      AND relation.relname = ANY($1::text[])
    ORDER BY relation.relname
  `, [TARGET_TABLES]);
  assert.equal(result.rows.length, TARGET_TABLES.length);
  for (const row of result.rows) {
    assert.equal(row.owner_name, migrationRole, row.table_name);
    assert.equal(row.rls_enabled, false, row.table_name);
    assert.equal(row.rls_forced, false, row.table_name);
    assert.equal(row.policy_count, 0, row.table_name);
    assert.deepEqual(
      row.runtime_privileges,
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
      row.table_name,
    );
    assert.deepEqual(row.runtime_grant_options, [], row.table_name);
    assert.deepEqual(row.public_privileges, [], row.table_name);
    assert.deepEqual(row.direct_column_privileges, [], row.table_name);
  }
}

export async function verifyColumnCatalog(client) {
  const result = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ('Order', 'sellerProfileId'),
         ('OrderItem', 'sellerProfileId'),
         ('StripeWebhookEvent', 'claimGeneration')
       )
     ORDER BY table_name, column_name
  `);
  assert.deepEqual(result.rows, [
    {
      table_name: "Order",
      column_name: "sellerProfileId",
      data_type: "text",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "OrderItem",
      column_name: "sellerProfileId",
      data_type: "text",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "StripeWebhookEvent",
      column_name: "claimGeneration",
      data_type: "bigint",
      is_nullable: "NO",
      column_default: "0",
    },
  ]);
}

export async function verifyConstraintAndIndexCatalog(client) {
  const constraints = await client.query(`
    SELECT
      constraint_state.conname AS constraint_name,
      constraint_state.contype AS constraint_type,
      constraint_state.convalidated AS validated,
      pg_catalog.pg_get_constraintdef(
        constraint_state.oid,
        true
      ) AS definition
    FROM pg_catalog.pg_constraint AS constraint_state
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = constraint_state.connamespace
    WHERE namespace.nspname = 'public'
      AND constraint_state.conname = ANY($1::text[])
    ORDER BY constraint_state.conname
  `, [TARGET_CONSTRAINTS]);
  assert.equal(constraints.rows.length, TARGET_CONSTRAINTS.length);
  for (const row of constraints.rows) assert.equal(row.validated, true);
  const byName = new Map(
    constraints.rows.map((row) => [row.constraint_name, row]),
  );
  assert.equal(byName.get("Listing_id_sellerId_key")?.constraint_type, "u");
  assert.equal(
    byName.get("Order_id_sellerProfileId_key")?.constraint_type,
    "u",
  );
  for (const name of TARGET_CONSTRAINTS.filter((value) =>
    value.endsWith("_fkey")
  )) {
    assert.equal(byName.get(name)?.constraint_type, "f", name);
    assert.match(byName.get(name)?.definition ?? "", /FOREIGN KEY/);
  }
  const generationCheck = byName.get(
    "StripeWebhookEvent_claimGeneration_check",
  );
  assert.equal(generationCheck?.constraint_type, "c");
  assert.match(generationCheck?.definition ?? "", /"claimGeneration" >= 0/);

  const indexes = await client.query(`
    SELECT indexname AS index_name
      FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public'
       AND indexname = ANY($1::text[])
     ORDER BY indexname
  `, [TARGET_INDEXES]);
  assert.deepEqual(
    indexes.rows.map((row) => row.index_name),
    [...TARGET_INDEXES].sort(),
  );
}

export async function verifyTriggerCatalog(client) {
  const result = await client.query(`
    SELECT
      trigger.tgname AS trigger_name,
      relation.relname AS table_name,
      trigger.tgenabled AS enabled,
      trigger.tgdeferrable AS deferrable,
      trigger.tginitdeferred AS initially_deferred
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'grainline_order_item_seller_key_bind',
        'grainline_order_item_seller_key_complete',
        'grainline_order_seller_key_complete'
      )
    ORDER BY trigger.tgname
  `);
  assert.deepEqual(result.rows, [
    {
      trigger_name: "grainline_order_item_seller_key_bind",
      table_name: "OrderItem",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_order_item_seller_key_complete",
      table_name: "OrderItem",
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
    },
    {
      trigger_name: "grainline_order_seller_key_complete",
      table_name: "Order",
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
    },
  ]);
}

export async function verifyFunctionCatalog(client, migrationRole) {
  const expected = new Map([
    ...ORDER_PAYMENT_SHIPPING_PRIVATE_FUNCTIONS.map(([name, args]) => [
      name,
      { args, runtimeExecute: false },
    ]),
    ...ORDER_PAYMENT_SHIPPING_RUNTIME_FUNCTIONS.map(([name, args]) => [
      name,
      { args, runtimeExecute: true },
    ]),
  ]);
  const result = await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS argument_types,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_mode,
      procedure.prokind AS function_kind,
      procedure.proconfig AS function_config,
      procedure.prosrc AS function_source,
      pg_catalog.has_function_privilege(
        CURRENT_USER, procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = CURRENT_USER
         )
           AND acl.privilege_type = 'EXECUTE'
      ) AS runtime_direct_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      (SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND (
             acl.grantee NOT IN (
               procedure.proowner,
               (SELECT role.oid
                  FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = CURRENT_USER)
             )
             OR (
               acl.grantee = (
                 SELECT role.oid
                   FROM pg_catalog.pg_roles AS role
                  WHERE role.rolname = CURRENT_USER
               )
               AND (
                 acl.grantor <> procedure.proowner
                 OR acl.is_grantable
               )
             )
           )) AS invalid_acl_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY($1::text[])
    ORDER BY procedure.proname
  `, [[...expected.keys()]]);
  assert.equal(result.rows.length, expected.size);
  const sourceHashes = stripeWebhookEventFunctionSourceSha256();
  for (const row of result.rows) {
    const contract = expected.get(row.function_name);
    assert.ok(contract, row.function_name);
    assert.equal(row.argument_types, contract.args, row.function_name);
    assert.equal(row.owner_name, migrationRole, row.function_name);
    assert.equal(row.function_kind, "f", row.function_name);
    assert.equal(row.security_definer, true, row.function_name);
    assert.equal(row.leakproof, false, row.function_name);
    assert.equal(row.volatility, "v", row.function_name);
    assert.equal(row.parallel_mode, "u", row.function_name);
    assert.deepEqual(
      row.function_config,
      ["search_path=pg_catalog"],
      row.function_name,
    );
    assert.equal(
      row.runtime_execute,
      contract.runtimeExecute,
      row.function_name,
    );
    assert.equal(
      row.runtime_direct_execute,
      contract.runtimeExecute,
      row.function_name,
    );
    assert.equal(row.public_execute, false, row.function_name);
    assert.equal(row.invalid_acl_count, 0, row.function_name);
    if (contract.runtimeExecute) {
      assert.equal(
        createHash("sha256")
          .update(row.function_source, "utf8")
          .digest("hex"),
        sourceHashes[row.function_name],
        `${row.function_name} source drifted`,
      );
    }
  }
}

export async function verifyIntegrityAggregates(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)
         FROM public."Order"
        WHERE "sellerProfileId" IS NULL) AS order_null_seller_count,
      (SELECT pg_catalog.count(*)
         FROM public."OrderItem"
        WHERE "sellerProfileId" IS NULL) AS item_null_seller_count,
      (SELECT pg_catalog.count(*)
         FROM public."OrderItem" AS item
         JOIN public."Listing" AS listing ON listing.id = item."listingId"
        WHERE item."sellerProfileId" IS DISTINCT FROM listing."sellerId")
        AS item_listing_mismatch_count,
      (SELECT pg_catalog.count(*)
         FROM public."OrderItem" AS item
         JOIN public."Order" AS orders ON orders.id = item."orderId"
        WHERE item."sellerProfileId" IS DISTINCT FROM orders."sellerProfileId")
        AS item_order_mismatch_count,
      (SELECT pg_catalog.count(*)
         FROM public."Order" AS orders
        WHERE NOT EXISTS (
          SELECT 1 FROM public."OrderItem" AS item
           WHERE item."orderId" = orders.id
        )) AS zero_item_order_count,
      (SELECT pg_catalog.count(*)
         FROM public."StripeWebhookEvent"
        WHERE "claimGeneration" < 0) AS invalid_claim_generation_count
  `);
  const counts = result.rows[0];
  assert.ok(counts);
  for (const [name, value] of Object.entries(counts)) {
    assert.equal(value, "0", name);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(counts).map(([name, value]) => [name, Number(value)]),
    ),
  );
}

async function provePrivateHelperDenied(client) {
  await client.query("SAVEPOINT order_compatible_expected_denial");
  let caught;
  try {
    await client.query(`
      SELECT public.grainline_order_seller_key_assert(
        'order-compatible-postflight-invalid-order'
      )
    `);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT order_compatible_expected_denial");
  await client.query("RELEASE SAVEPOINT order_compatible_expected_denial");
  assert.equal(caught?.code, "42501");
}

export async function runOrderPaymentShippingCompatiblePostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-order-payment-shipping-compatible-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await verifyReadOnlyTransaction(client);
    await verifyRuntimeIdentity(
      client,
      config.runtimeGuard,
      config.migrationRole,
    );
    await verifyTablePosture(client, config.migrationRole);
    await verifyColumnCatalog(client);
    await verifyConstraintAndIndexCatalog(client);
    await verifyTriggerCatalog(client);
    await verifyFunctionCatalog(client, config.migrationRole);
    const integrityCounts = await verifyIntegrityAggregates(client);
    await provePrivateHelperDenied(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      mainCiRunId: config.mainCiRunId,
      migrationRunId: config.migrationRunId,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      predecessorCrudRetained: true,
      privateFunctionCount: ORDER_PAYMENT_SHIPPING_PRIVATE_FUNCTIONS.length,
      runtimeFunctionCount: ORDER_PAYMENT_SHIPPING_RUNTIME_FUNCTIONS.length,
      integrityCounts,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "engine_attested_repeatable_read_read_only_transaction",
        "actual_pooled_runtime_role_identity",
        "compatible_predecessor_table_posture",
        "durable_seller_and_claim_generation_columns",
        "validated_composite_keys_foreign_keys_and_indexes",
        "seller_key_trigger_catalog",
        "exact_private_and_six_runtime_function_source_acl_catalog",
        "aggregate_backfill_and_relationship_integrity",
        "private_helper_direct_execute_denial",
      ],
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeOrderPaymentShippingCompatiblePostflightEvidence(
  evidencePath,
  evidence,
) {
  const handle = openSync(evidencePath, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(evidencePath, 0o600);
}

async function main() {
  try {
    const config = parseOrderPaymentShippingCompatiblePostflightConfig(
      process.env,
    );
    assertOrderPaymentShippingCompatibleGitState(
      readOrderPaymentShippingCompatibleGitState(),
      config.releaseCommit,
    );
    const evidence = await runOrderPaymentShippingCompatiblePostflight(config);
    writeOrderPaymentShippingCompatiblePostflightEvidence(
      config.evidencePath,
      evidence,
    );
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `Order/payment/shipping compatible production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
