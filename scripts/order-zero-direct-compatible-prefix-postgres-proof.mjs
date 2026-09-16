#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS,
  ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS,
  ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS,
  verifyOrderZeroDirectCompatiblePrefix,
} from "./stage-order-zero-direct-compatible-prefix.mjs";

const { Client } = pg;
const PROOF_URL_ENV = "ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderZeroDirectCompatiblePrefixProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_URL_ENV];
  assert.ok(databaseUrl, `${PROOF_URL_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `proof requires the ${DATABASE_NAME} database`,
  );
  assert.ok(parsed.username, "proof URL must identify its database role");
  assert.notEqual(
    parsed.username,
    RUNTIME_ROLE,
    "catalog proof must use the disposable migration owner",
  );
  return Object.freeze({
    databaseUrl,
    expectedRole: decodeURIComponent(parsed.username),
  });
}

function expectedFunctions() {
  return [
    ...ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS.map(
      ([name, identityArguments]) => ({
        name,
        identityArguments,
        runtimeExecute: true,
      }),
    ),
    ...ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS.map(
      ([name, identityArguments]) => ({
        name,
        identityArguments,
        runtimeExecute: false,
      }),
    ),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

async function verifyIdentityAndReadOnly(client, expectedRole) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name,
      pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(result.rows, [{
    current_user_name: expectedRole,
    session_user_name: expectedRole,
    read_only: "on",
  }]);
}

async function verifyMigrationLedger(client) {
  const expected = ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.map((member) => ({
    migration_name: member.migration,
    checksum: member.sha256,
  }));
  const result = await client.query(`
    SELECT
      migration_name,
      checksum,
      finished_at IS NOT NULL AS finished,
      rolled_back_at IS NULL AS not_rolled_back,
      applied_steps_count::integer AS applied_steps
    FROM public._prisma_migrations
    WHERE migration_name = ANY($1::text[])
    ORDER BY migration_name
  `, [expected.map((entry) => entry.migration_name)]);
  assert.equal(result.rows.length, expected.length, "compatible prefix ledger is incomplete");
  for (let index = 0; index < expected.length; index += 1) {
    assert.deepEqual(result.rows[index], {
      ...expected[index],
      finished: true,
      not_rolled_back: true,
      applied_steps: 1,
    });
  }
}

export async function verifyTablePosture(client) {
  const result = await client.query(`
    SELECT
      class.relname AS table_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege($1, class.oid, 'SELECT') AS runtime_select,
      pg_catalog.has_table_privilege($1, class.oid, 'INSERT') AS runtime_insert,
      pg_catalog.has_table_privilege($1, class.oid, 'UPDATE') AS runtime_update,
      pg_catalog.has_table_privilege($1, class.oid, 'DELETE') AS runtime_delete
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = ANY($2::text[])
      AND class.relkind = 'r'
    ORDER BY class.relname
  `, [RUNTIME_ROLE, ["Order", "SellerDeauthorizationApplication"]]);
  assert.deepEqual(result.rows, [
    {
      table_name: "Order",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    },
    {
      table_name: "SellerDeauthorizationApplication",
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
      runtime_select: false,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
    },
  ]);
}

export async function verifyFunctionCatalog(client) {
  const expected = expectedFunctions();
  const result = await client.query(`
    WITH expected(function_name, identity_arguments) AS (
      SELECT * FROM unnest($1::text[], $2::text[])
    )
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
      procedure.prosecdef AS security_definer,
      procedure.proconfig AS configuration,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege($3, procedure.oid, 'EXECUTE')
        AS runtime_execute,
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
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
        WHERE role.rolname = $3
          AND acl.privilege_type = 'EXECUTE'
          AND acl.is_grantable
      ) AS runtime_grantable
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.function_name
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
     AND namespace.nspname = 'public'
    ORDER BY procedure.proname
  `, [
    expected.map((entry) => entry.name),
    expected.map((entry) => entry.identityArguments),
    RUNTIME_ROLE,
  ]);
  assert.equal(result.rows.length, expected.length, "function catalog is incomplete");
  for (let index = 0; index < expected.length; index += 1) {
    const row = result.rows[index];
    assert.equal(row.function_name, expected[index].name);
    assert.equal(row.identity_arguments, expected[index].identityArguments);
    assert.equal(row.security_definer, true, `${row.function_name} must be SECURITY DEFINER`);
    assert.deepEqual(row.configuration, ["search_path=pg_catalog"]);
    assert.notEqual(row.owner_name, RUNTIME_ROLE);
    assert.equal(row.runtime_execute, expected[index].runtimeExecute);
    assert.equal(row.public_execute, false);
    assert.equal(row.runtime_grantable, false);
  }
}

export async function verifyConstraintsAndTrigger(client) {
  const constraints = await client.query(`
    SELECT
      class.relname AS table_name,
      catalog_constraint.conname,
      catalog_constraint.convalidated,
      catalog_constraint.contype AS constraint_type
    FROM pg_catalog.pg_constraint AS catalog_constraint
    JOIN pg_catalog.pg_class AS class ON class.oid = catalog_constraint.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN (
      SELECT * FROM unnest($1::text[], $2::text[])
        AS expected(table_name, constraint_name)
    ) AS expected
      ON expected.table_name = class.relname
     AND expected.constraint_name = catalog_constraint.conname
    WHERE namespace.nspname = 'public'
    ORDER BY class.relname, catalog_constraint.conname
  `, [
    ["CheckoutStockReservation", "Order", "Order"],
    [
      "CheckoutStockReservation_sourceSnapshot_check",
      "Order_provider_claim_mutual_exclusion_check",
      "Order_sellerDeauthorization_check",
    ],
  ]);
  assert.deepEqual(constraints.rows, [
    {
      table_name: "CheckoutStockReservation",
      conname: "CheckoutStockReservation_sourceSnapshot_check",
      convalidated: true,
      constraint_type: "c",
    },
    {
      table_name: "Order",
      conname: "Order_provider_claim_mutual_exclusion_check",
      convalidated: true,
      constraint_type: "c",
    },
    {
      table_name: "Order",
      conname: "Order_sellerDeauthorization_check",
      convalidated: true,
      constraint_type: "c",
    },
  ]);
  const trigger = await client.query(`
    SELECT
      trigger.tgenabled,
      trigger.tgtype::integer AS trigger_type,
      trigger.tgnargs::integer AS argument_count,
      trigger.tgqual IS NULL AS unconditional,
      procedure.proname AS function_name,
      function_namespace.nspname AS function_schema,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS class ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_catalog.pg_namespace AS function_namespace
      ON function_namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'SellerDeauthorizationApplication'
      AND trigger.tgname = 'SellerDeauthorizationApplication_immutable'
      AND NOT trigger.tgisinternal
  `);
  assert.deepEqual(trigger.rows, [{
    tgenabled: "O",
    trigger_type: 27,
    argument_count: 0,
    unconditional: true,
    function_name: "grainline_seller_deauthorization_application_immutable",
    function_schema: "public",
    identity_arguments: "",
  }]);
}

export async function proveOrderZeroDirectCompatiblePrefixPostgres(
  env = process.env,
) {
  const config = parseOrderZeroDirectCompatiblePrefixProofConfig(env);
  verifyOrderZeroDirectCompatiblePrefix();
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await verifyIdentityAndReadOnly(client, config.expectedRole);
    await verifyMigrationLedger(client);
    await verifyTablePosture(client);
    await verifyFunctionCatalog(client);
    await verifyConstraintsAndTrigger(client);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return Object.freeze({
    status: "passed",
    migrationCount: ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.length,
    functionCount: expectedFunctions().length,
    productionChanged: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  proveOrderZeroDirectCompatiblePrefixPostgres()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(
        `Order zero-direct compatible PostgreSQL proof failed closed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
