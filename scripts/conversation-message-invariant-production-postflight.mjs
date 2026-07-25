#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const { Client } = pg;

export const POSTFLIGHT_CONFIRMATION =
  "verify-production-conversation-message-invariants-rollback-only";
export const PREPARATION_RELEASE_COMMIT =
  "98a1e592b8ae3571186ede5edd3b5b95fcb9dfe1";
export const PREPARATION_DEPLOYMENT_ID =
  "dpl_GZiSfXTxXENTfqLk6LqZmJtvC3Ud";
export const PREPARATION_MIGRATION_RUN_ID = 30177568806;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseProductionInvariantPostflightConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "Conversation/Message production invariant postflight",
  );
  if (
    env.CONVERSATION_MESSAGE_INVARIANT_POSTFLIGHT_CONFIRM
    !== POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("Conversation/Message production invariant postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Conversation/Message production invariant postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Conversation/Message production invariant postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
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
  return Object.freeze({
    databaseUrl,
    runtimeGuard,
    releaseCommit: PREPARATION_RELEASE_COMMIT,
    deploymentId: PREPARATION_DEPLOYMENT_ID,
    migrationRunId: PREPARATION_MIGRATION_RUN_ID,
  });
}

function fixtureIds() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 24);
  return Object.freeze({
    userAId: `cm-postflight-a-${suffix}`,
    userBId: `cm-postflight-b-${suffix}`,
    foreignUserId: `cm-postflight-c-${suffix}`,
    conversationId: `cm-postflight-conversation-${suffix}`,
    messageId: `cm-postflight-message-${suffix}`,
    forgedMessageId: `cm-postflight-forged-${suffix}`,
    noncanonicalConversationId: `cm-postflight-noncanonical-${suffix}`,
    suffix,
  });
}

async function expectPgError(client, operation, expectedCodes, label, sequence) {
  const savepoint = `cm_postflight_expected_${sequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  if (!caught) throw new Error(`${label} unexpectedly succeeded`);
  assert.ok(
    expectedCodes.includes(caught?.code),
    `${label} failed with unexpected PostgreSQL code ${caught?.code ?? "unknown"}`,
  );
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

async function verifyCatalog(client) {
  const tables = await client.query(`
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
       AND relation.relname IN ('Conversation', 'Message')
     ORDER BY relation.relname
  `);
  assert.equal(tables.rows.length, 2);
  for (const row of tables.rows) {
    assert.equal(row.relrowsecurity, false);
    assert.equal(row.relforcerowsecurity, false);
    assert.equal(row.owner_name, "neondb_owner");
    assert.equal(row.policy_count, 0);
    assert.equal(row.can_select, true);
    assert.equal(row.can_insert, true);
    assert.equal(row.can_update, true);
    assert.equal(row.can_delete, true);
  }

  const constraint = await client.query(`
    SELECT constraint_state.conname,
           constraint_state.convalidated,
           pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
             AS definition
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid =
             'public."Conversation"'::pg_catalog.regclass
       AND constraint_state.conname =
             'Conversation_canonical_participant_pair_check'
  `);
  assert.equal(constraint.rows.length, 1);
  assert.equal(constraint.rows[0].convalidated, true);
  assert.match(constraint.rows[0].definition, /"userAId" < "userBId"/);

  const functions = await client.query(`
    SELECT procedure.proname,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           procedure.prosecdef,
           procedure.proconfig,
           pg_catalog.has_function_privilege(
             current_user, procedure.oid, 'EXECUTE'
           ) AS runtime_can_execute,
           NOT EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute_revoked
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_conversation_participants_immutable',
         'grainline_message_participants_match_conversation',
         'grainline_message_route_immutable',
         'grainline_message_maintain_thread_state'
       )
     ORDER BY procedure.proname
  `);
  assert.equal(functions.rows.length, 4);
  for (const row of functions.rows) {
    assert.equal(row.owner_name, "neondb_owner");
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog, pg_temp"]);
    assert.equal(row.runtime_can_execute, false);
    assert.equal(row.public_execute_revoked, true);
  }
  assert.equal(
    functions.rows.find((row) => (
      row.proname === "grainline_message_participants_match_conversation"
    ))?.prosecdef,
    true,
  );
  assert.equal(
    functions.rows.find((row) => (
      row.proname === "grainline_message_maintain_thread_state"
    ))?.prosecdef,
    true,
  );

  const triggers = await client.query(`
    SELECT trigger.tgname,
           relation.relname AS table_name,
           trigger.tgenabled
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND NOT trigger.tgisinternal
       AND trigger.tgname IN (
         'grainline_conversation_participants_immutable',
         'grainline_message_participants_match_conversation',
         'grainline_message_route_immutable',
         'grainline_message_maintain_thread_state'
       )
     ORDER BY trigger.tgname
  `);
  assert.equal(triggers.rows.length, 4);
  assert.equal(triggers.rows.every((row) => row.tgenabled === "O"), true);
  assert.deepEqual(
    triggers.rows.map((row) => row.table_name).sort(),
    ["Conversation", "Message", "Message", "Message"],
  );

  const index = await client.query(`
    SELECT index_state.indisvalid,
           index_state.indisready,
           pg_catalog.pg_get_indexdef(index_state.indexrelid) AS definition
      FROM pg_catalog.pg_class AS index_relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_relation.oid
     WHERE namespace.nspname = 'public'
       AND index_relation.relname = 'Message_body_trgm_idx'
  `);
  assert.equal(index.rows.length, 1);
  assert.equal(index.rows[0].indisvalid, true);
  assert.equal(index.rows[0].indisready, true);
  assert.match(index.rows[0].definition, /USING gin \(body gin_trgm_ops\)/);
}

async function proveRollbackOnlyRuntimeWrites(client, fixture) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(
      `INSERT INTO public."User" (
         id, "clerkId", email, name, "updatedAt"
       ) VALUES
         ($1, $4, $7, 'Invariant postflight A', pg_catalog.clock_timestamp()),
         ($2, $5, $8, 'Invariant postflight B', pg_catalog.clock_timestamp()),
         ($3, $6, $9, 'Invariant postflight C', pg_catalog.clock_timestamp())`,
      [
        fixture.userAId,
        fixture.userBId,
        fixture.foreignUserId,
        `clerk_cm_postflight_a_${fixture.suffix}`,
        `clerk_cm_postflight_b_${fixture.suffix}`,
        `clerk_cm_postflight_c_${fixture.suffix}`,
        `cm-postflight-a-${fixture.suffix}@example.invalid`,
        `cm-postflight-b-${fixture.suffix}@example.invalid`,
        `cm-postflight-c-${fixture.suffix}@example.invalid`,
      ],
    );
    await client.query(
      `INSERT INTO public."Conversation" (
         id, "userAId", "userBId", "createdAt", "updatedAt",
         "archivedAAt", "archivedBAt"
       ) VALUES ($1, $2, $3, $4, $4, $4, $4)`,
      [
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
        "2026-01-01T00:00:00.000Z",
      ],
    );
    await client.query(
      `INSERT INTO public."Message" (
         id, "conversationId", "senderId", "recipientId", body, "createdAt"
       ) VALUES ($1, $2, $3, $4, 'rollback-only valid message', $5)`,
      [
        fixture.messageId,
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
        "2026-01-02T00:00:00.000Z",
      ],
    );
    const parent = await client.query(
      `SELECT "updatedAt", "archivedAAt", "archivedBAt"
         FROM public."Conversation"
        WHERE id = $1`,
      [fixture.conversationId],
    );
    assert.equal(
      parent.rows[0].updatedAt.toISOString(),
      "2026-01-02T00:00:00.000Z",
    );
    assert.equal(parent.rows[0].archivedAAt, null);
    assert.equal(parent.rows[0].archivedBAt, null);

    await expectPgError(
      client,
      () => client.query(
        `INSERT INTO public."Message" (
           id, "conversationId", "senderId", "recipientId", body
         ) VALUES ($1, $2, $3, $4, 'forged')`,
        [
          fixture.forgedMessageId,
          fixture.conversationId,
          fixture.foreignUserId,
          fixture.userBId,
        ],
      ),
      ["23514"],
      "forged Message route",
      1,
    );
    await expectPgError(
      client,
      () => client.query(
        `UPDATE public."Message"
            SET "recipientId" = $1
          WHERE id = $2`,
        [fixture.foreignUserId, fixture.messageId],
      ),
      ["23514"],
      "Message route rewrite",
      2,
    );
    await expectPgError(
      client,
      () => client.query(
        `UPDATE public."Conversation"
            SET "userBId" = $1
          WHERE id = $2`,
        [fixture.foreignUserId, fixture.conversationId],
      ),
      ["23514"],
      "Conversation participant rewrite",
      3,
    );
    await expectPgError(
      client,
      () => client.query(
        `INSERT INTO public."Conversation" (
           id, "userAId", "userBId", "updatedAt"
         ) VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
        [
          fixture.noncanonicalConversationId,
          fixture.userBId,
          fixture.userAId,
        ],
      ),
      ["23514"],
      "noncanonical Conversation",
      4,
    );
    await expectPgError(
      client,
      () => client.query(
        "SELECT public.grainline_message_maintain_thread_state()",
      ),
      ["42501"],
      "direct runtime trigger-function execution",
      5,
    );

    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
  }

  const remaining = await client.query(
    `SELECT
       (
         SELECT pg_catalog.count(*)::integer
           FROM public."User"
          WHERE id = ANY($1::text[])
       ) AS users,
       (
         SELECT pg_catalog.count(*)::integer
           FROM public."Conversation"
          WHERE id = ANY($2::text[])
       ) AS conversations,
       (
         SELECT pg_catalog.count(*)::integer
           FROM public."Message"
          WHERE id = ANY($3::text[])
       ) AS messages`,
    [
      [fixture.userAId, fixture.userBId, fixture.foreignUserId],
      [fixture.conversationId, fixture.noncanonicalConversationId],
      [fixture.messageId, fixture.forgedMessageId],
    ],
  );
  assert.deepEqual(remaining.rows, [{
    users: 0,
    conversations: 0,
    messages: 0,
  }]);
  return remaining.rows[0];
}

export async function runProductionInvariantPostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-conversation-message-invariant-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  try {
    await verifyRuntimeIdentity(client);
    await verifyCatalog(client);
    const remaining = await proveRollbackOnlyRuntimeWrites(client, fixtureIds());
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      deploymentId: config.deploymentId,
      migrationRunId: config.migrationRunId,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      conversationMessageRlsEnabled: false,
      conversationMessageRlsForced: false,
      policyCount: 0,
      completedChecks: [
        "actual_pooled_runtime_role_identity",
        "preparation_catalog_and_runtime_private_trigger_acl",
        "valid_message_thread_state",
        "forged_route_and_identity_mutation_rejected",
        "direct_trigger_function_execution_rejected",
        "rollback_left_zero_fixture_rows",
      ],
      remainingFixtureRows: remaining,
      productionChanged: false,
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main() {
  try {
    const result = await runProductionInvariantPostflight(
      parseProductionInvariantPostflightConfig(process.env),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Conversation/Message production invariant postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
