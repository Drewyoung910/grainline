#!/usr/bin/env node
import assert from "node:assert/strict";
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
import { CASE_INVARIANT_MIGRATION } from "./stage-case-invariant-migration.mjs";

const { Client } = pg;

export const CASE_INVARIANT_POSTFLIGHT_CONFIRMATION =
  "verify-production-case-invariants-read-only";

export const CASE_INVARIANT_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_case_relationship_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_authority_fields_immutable",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_status_transition_valid",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_message_author_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_message_authority_fields_immutable",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_message_maintain_thread",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_opening_evidence_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_attachment_parent_valid",
    securityDefiner: true,
  }),
]);

const constraintNames = Object.freeze([
  "Case_distinct_participants_check",
  "Case_clock_order_check",
  "Case_lifecycle_evidence_check",
  "Case_resolution_shape_check",
  "Case_resolution_marks_check",
  "CaseMessage_body_check",
]);

const triggerNames = Object.freeze([
  "grainline_case_relationship_valid",
  "grainline_case_authority_fields_immutable",
  "grainline_case_status_transition_valid",
  "grainline_case_message_author_valid",
  "grainline_case_message_authority_fields_immutable",
  "grainline_case_message_maintain_thread",
  "grainline_case_opening_evidence_valid",
  "grainline_case_message_delete_keeps_opening_evidence",
  "grainline_case_attachment_parent_valid",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseCaseInvariantPostflightConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "Case invariant production postflight",
  );
  if (
    env.CASE_INVARIANT_POSTFLIGHT_CONFIRM
      !== CASE_INVARIANT_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("Case invariant production postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Case invariant postflight rejects privileged database keys: ${
        privilegedKeys.join(", ")
      }`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Case invariant postflight rejects aliased PostgreSQL URLs: ${
        unreviewedUrlKeys.join(", ")
      }`,
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
  return Object.freeze({ databaseUrl, runtimeGuard });
}

async function verifyReadOnlyTransaction(client) {
  const result = await client.query(`
    SELECT pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(result.rows, [{ read_only: "on" }]);
}

async function verifyRuntimeIdentity(client) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS current_user_name,
           session_user AS session_user_name,
           role.rolsuper,
           role.rolbypassrls,
           role.rolinherit,
           role.rolcanlogin,
           pg_catalog.pg_has_role(
             current_user,
             'neondb_owner',
             'MEMBER'
           ) AS member_of_owner
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  `);
  assert.deepEqual(result.rows, [{
    database_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName,
    current_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    session_user_name: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    member_of_owner: false,
  }]);
}

async function verifyTableBoundary(client) {
  const result = await client.query(`
    SELECT relation.relname,
           relation.relrowsecurity,
           relation.relforcerowsecurity,
           pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
           (
             SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid = relation.oid
           ) AS policy_count,
           pg_catalog.has_table_privilege(
             current_user, relation.oid, 'SELECT'
           ) AS can_select,
           pg_catalog.has_table_privilege(
             current_user, relation.oid, 'INSERT'
           ) AS can_insert,
           pg_catalog.has_table_privilege(
             current_user, relation.oid, 'UPDATE'
           ) AS can_update,
           pg_catalog.has_table_privilege(
             current_user, relation.oid, 'DELETE'
           ) AS can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  `);
  assert.equal(result.rows.length, 3);
  for (const row of result.rows) {
    assert.equal(row.relrowsecurity, false);
    assert.equal(row.relforcerowsecurity, false);
    assert.equal(row.owner_name, "neondb_owner");
    assert.equal(row.policy_count, 0);
    assert.equal(row.can_select, true);
    assert.equal(row.can_insert, true);
    assert.equal(row.can_update, true);
    assert.equal(row.can_delete, true);
  }
}

async function verifyConstraintCatalog(client) {
  const result = await client.query(`
    SELECT constraint_state.conname,
           constraint_state.convalidated
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conname = ANY($1::text[])
       AND constraint_state.conrelid IN (
         'public."Case"'::pg_catalog.regclass,
         'public."CaseMessage"'::pg_catalog.regclass
       )
     ORDER BY constraint_state.conname
  `, [constraintNames]);
  assert.deepEqual(
    result.rows.map((row) => row.conname),
    [...constraintNames].sort(),
  );
  assert.equal(result.rows.every((row) => row.convalidated), true);

  const authorKind = await client.query(`
    SELECT NOT attribute.attnotnull AS nullable
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
             'public."CaseMessage"'::pg_catalog.regclass
       AND attribute.attname = 'authorKind'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  `);
  assert.deepEqual(authorKind.rows, [{ nullable: false }]);
}

async function verifyFunctionCatalog(client) {
  const result = await client.query(`
    SELECT procedure.proname,
           procedure.prosecdef,
           procedure.provolatile,
           procedure.proparallel,
           procedure.proconfig,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           pg_catalog.has_function_privilege(
             current_user, procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
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
           ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($1::text[])
       AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
     ORDER BY procedure.proname
  `, [CASE_INVARIANT_FUNCTIONS.map((entry) => entry.name)]);
  assert.equal(result.rows.length, CASE_INVARIANT_FUNCTIONS.length);
  for (const expected of CASE_INVARIANT_FUNCTIONS) {
    const row = result.rows.find((entry) => entry.proname === expected.name);
    assert.ok(row, `${expected.name} is missing`);
    assert.equal(row.prosecdef, expected.securityDefiner);
    assert.equal(row.provolatile, "v");
    assert.equal(row.proparallel, "u");
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.owner_name, "neondb_owner");
    assert.equal(row.runtime_execute, false);
    assert.equal(row.public_execute, false);
  }
}

async function verifyTriggerCatalog(client) {
  const result = await client.query(`
    SELECT trigger.tgname,
           relation.relname AS table_name,
           trigger.tgenabled,
           trigger.tgdeferrable,
           trigger.tginitdeferred
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND NOT trigger.tgisinternal
       AND trigger.tgname = ANY($1::text[])
     ORDER BY trigger.tgname
  `, [triggerNames]);
  assert.deepEqual(
    result.rows.map((row) => row.tgname),
    [...triggerNames].sort(),
  );
  assert.equal(result.rows.every((row) => row.tgenabled === "O"), true);
  const deferred = result.rows
    .filter((row) => row.tgdeferrable && row.tginitdeferred)
    .map((row) => row.tgname)
    .sort();
  assert.deepEqual(deferred, [
    "grainline_case_message_delete_keeps_opening_evidence",
    "grainline_case_opening_evidence_valid",
  ]);
}

async function proveRuntimeCannotCallTriggerFunctions(client) {
  for (let index = 0; index < CASE_INVARIANT_FUNCTIONS.length; index += 1) {
    const entry = CASE_INVARIANT_FUNCTIONS[index];
    const savepoint = `case_invariant_acl_${index}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    let caught;
    try {
      await client.query(`SELECT public.${entry.name}()`);
    } catch (error) {
      caught = error;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    assert.equal(caught?.code, "42501", `${entry.name} remained callable`);
  }
}

export async function runCaseInvariantProductionPostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-case-invariant-production-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    await verifyReadOnlyTransaction(client);
    await verifyRuntimeIdentity(client);
    await verifyTableBoundary(client);
    await verifyConstraintCatalog(client);
    await verifyFunctionCatalog(client);
    await verifyTriggerCatalog(client);
    await proveRuntimeCannotCallTriggerFunctions(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      migration: CASE_INVARIANT_MIGRATION,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      transactionReadOnly: true,
      caseFamilyRlsEnabled: false,
      caseFamilyRlsForced: false,
      policyCount: 0,
      constraintCount: constraintNames.length,
      functionCount: CASE_INVARIANT_FUNCTIONS.length,
      triggerCount: triggerNames.length,
      runtimeTriggerFunctionExecute: false,
      productionChanged: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main() {
  try {
    const result = await runCaseInvariantProductionPostflight(
      parseCaseInvariantPostflightConfig(process.env),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Case invariant production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
