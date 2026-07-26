#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
  CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES,
} from "./conversation-message-authority-catalog.mjs";
import {
  collectConversationMessageFunctionIssues,
} from "./audit-runtime-db-grants.mjs";
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
  CONVERSATION_MESSAGE_AUTHORITY_RELEASE,
  verifyConversationMessageAuthorityRelease,
} from "./verify-conversation-message-authority-release.mjs";

const { Client } = pg;

export const AUTHORITY_POSTFLIGHT_CONFIRMATION =
  "verify-production-conversation-message-authority-functions-read-only";
export const AUTHORITY_RELEASE_COMMIT =
  "70770bed92db778bb2a6c61b592433cb7508578f";
export const AUTHORITY_MAIN_CI_RUN_ID = 30185597811;
export const AUTHORITY_MIGRATION_NAME =
  "20260726022500_prepare_conversation_message_authority";

const REVIEWED_MIGRATION_ROLE = "neondb_owner";
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseAuthorityProductionPostflightConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "Conversation/Message authority production postflight",
  );
  if (
    env.CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_CONFIRM
      !== AUTHORITY_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "Conversation/Message authority production postflight confirmation is invalid",
    );
  }

  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Conversation/Message authority production postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Conversation/Message authority production postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
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

  const migrationRunIdRaw = required(
    env,
    "CONVERSATION_MESSAGE_AUTHORITY_MIGRATION_RUN_ID",
  );
  if (!SAFE_POSITIVE_INTEGER.test(migrationRunIdRaw)) {
    throw new Error(
      "Conversation/Message authority migration run id is invalid",
    );
  }
  const migrationRunId = Number(migrationRunIdRaw);
  if (!Number.isSafeInteger(migrationRunId)) {
    throw new Error(
      "Conversation/Message authority migration run id is unsafe",
    );
  }

  const evidencePath = path.resolve(required(
    env,
    "CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH",
  ));
  const expectedBasename =
    `conversation-message-authority-production-postflight-${AUTHORITY_RELEASE_COMMIT}.json`;
  if (
    path.basename(evidencePath) !== expectedBasename
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "Conversation/Message authority postflight evidence path is not fresh and exact",
    );
  }
  const evidenceParent = path.dirname(evidencePath);
  const parentState = lstatSync(evidenceParent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) {
    throw new Error(
      "Conversation/Message authority postflight evidence parent is unsafe",
    );
  }

  return Object.freeze({
    databaseUrl,
    evidencePath,
    migrationRunId,
    runtimeGuard,
  });
}

function expectedFunctionNames() {
  return CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map((entry) => entry.name);
}

async function verifyRuntimeIdentity(client) {
  const result = await client.query(`
    SELECT pg_catalog.current_database() AS database_name,
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

async function verifyRuntimeCannotReadMigrationHistory(client) {
  const result = await client.query(`
    SELECT pg_catalog.has_table_privilege(
             current_user,
             'public."_prisma_migrations"',
             'SELECT'
           ) AS can_read_migration_history
  `);
  assert.deepEqual(result.rows, [{
    can_read_migration_history: false,
  }]);
}

async function verifyTableBoundary(client) {
  const result = await client.query(`
    SELECT relation.relname AS table_name,
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
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  `);
  assert.deepEqual(result.rows, [
    {
      table_name: "Conversation",
      relrowsecurity: false,
      relforcerowsecurity: false,
      owner_name: REVIEWED_MIGRATION_ROLE,
      policy_count: 0,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    },
    {
      table_name: "Message",
      relrowsecurity: false,
      relforcerowsecurity: false,
      owner_name: REVIEWED_MIGRATION_ROLE,
      policy_count: 0,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    },
  ]);
}

async function readFunctionCatalog(client) {
  const result = await client.query(
    `SELECT
        procedure.proname AS function_name,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS args,
        pg_catalog.oidvectortypes(procedure.proargtypes) AS argument_types,
        pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
        procedure.prosecdef AS security_definer,
        procedure.proleakproof AS leakproof,
        procedure.provolatile AS volatility,
        procedure.proparallel AS parallel_safety,
        procedure.prokind AS function_kind,
        language.lanname AS language_name,
        procedure.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          current_user,
          procedure.oid,
          'EXECUTE'
        ) AS execute_priv,
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
                    WHERE role.rolname = current_user
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
           WHERE acl.grantee = (
                   SELECT role.oid
                     FROM pg_catalog.pg_roles AS role
                    WHERE role.rolname = current_user
                 )
             AND acl.privilege_type = 'EXECUTE'
             AND acl.is_grantable
        ) AS runtime_execute_grantable,
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
        ARRAY(
          SELECT DISTINCT privilege_role.rolname
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS acl
            JOIN pg_catalog.pg_roles AS privilege_role
              ON privilege_role.oid = acl.grantee
           WHERE acl.grantee <> procedure.proowner
             AND acl.grantee <> (
                   SELECT role.oid
                     FROM pg_catalog.pg_roles AS role
                    WHERE role.rolname = current_user
                 )
             AND acl.privilege_type = 'EXECUTE'
           ORDER BY 1
        ) AS other_role_execute
       FROM pg_catalog.pg_proc AS procedure
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = procedure.pronamespace
       JOIN pg_catalog.pg_language AS language
         ON language.oid = procedure.prolang
      WHERE namespace.nspname = 'public'
        AND procedure.proname = ANY($1::text[])
      ORDER BY procedure.proname, args`,
    [expectedFunctionNames()],
  );
  assert.equal(
    result.rows.length,
    CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
  );
  assert.deepEqual(
    collectConversationMessageFunctionIssues(
      result.rows,
      REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
      REVIEWED_MIGRATION_ROLE,
    ),
    [],
  );
}

function nullArguments(signature) {
  return signature
    .split(",")
    .map((type) => `NULL::${type.trim()}`)
    .join(", ");
}

async function provePrivateCoreDenial(client) {
  const privateFunctions = CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.filter(
    (entry) => !entry.runtimeExecute,
  );
  assert.deepEqual(
    privateFunctions.map((entry) => entry.name),
    [...CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES],
  );

  await client.query("BEGIN TRANSACTION READ ONLY");
  let transactionOpen = true;
  try {
    await client.query("SET LOCAL statement_timeout = '10s'");
    for (let index = 0; index < privateFunctions.length; index += 1) {
      const entry = privateFunctions[index];
      const savepoint = `cm_authority_private_${index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      let caught;
      try {
        await client.query(
          `SELECT public.${entry.name}(${nullArguments(entry.signature)})`,
        );
      } catch (error) {
        caught = error;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      assert.equal(
        caught?.code,
        "42501",
        `${entry.name} did not fail with insufficient_privilege`,
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
  }
}

export async function runAuthorityProductionPostflight(config) {
  const release = verifyConversationMessageAuthorityRelease();
  assert.equal(
    release.migrationSha256,
    CONVERSATION_MESSAGE_AUTHORITY_RELEASE.sha256,
  );
  assert.equal(release.executableBodyMatchesDisposableProof, true);

  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-conversation-message-authority-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  try {
    await verifyRuntimeIdentity(client);
    await verifyRuntimeCannotReadMigrationHistory(client);
    await verifyTableBoundary(client);
    await readFunctionCatalog(client);
    await provePrivateCoreDenial(client);
    return Object.freeze({
      status: "passed",
      releaseCommit: AUTHORITY_RELEASE_COMMIT,
      mainCiRunId: AUTHORITY_MAIN_CI_RUN_ID,
      migrationRunId: config.migrationRunId,
      migrationName: AUTHORITY_MIGRATION_NAME,
      migrationSha256: CONVERSATION_MESSAGE_AUTHORITY_RELEASE.sha256,
      disposableProofSha256: release.disposableProofSha256,
      executableBodyMatchesDisposableProof:
        release.executableBodyMatchesDisposableProof,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      functionCount: CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
      runtimeCallableFunctionCount:
        CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length
        - CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES.length,
      privateCoreCount: CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES.length,
      conversationMessageRlsEnabled: false,
      conversationMessageRlsForced: false,
      policyCount: 0,
      oldApplicationDirectCrudCompatible: true,
      privateCoresRuntimeCallable: false,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "actual_pooled_runtime_role_identity",
        "runtime_cannot_read_prisma_migration_history",
        "local_exact_migration_release_binding",
        "rls_off_zero_policies_and_old_crud_retained",
        "exact_25_function_catalog_and_acl",
        "six_private_cores_denied_with_insufficient_privilege",
      ],
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeAuthorityPostflightEvidence(evidencePath, evidence) {
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
    const config = parseAuthorityProductionPostflightConfig(process.env);
    const evidence = await runAuthorityProductionPostflight(config);
    writeAuthorityPostflightEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `Conversation/Message authority production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
