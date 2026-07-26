#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
} from "./conversation-message-authority-catalog.mjs";
import {
  collectConversationMessageFunctionIssues,
} from "./audit-runtime-db-grants.mjs";

const { Client } = pg;
const databaseUrl =
  process.env.CONVERSATION_MESSAGE_AUTHORITY_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const migrationRole = "ci";
const migrationPath =
  "prisma/migrations/20260726022500_prepare_conversation_message_authority/migration.sql";
const expectedDisposableMigrationSha256 =
  "9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07";
const fixture = Object.freeze({
  userAId: "cm-authority-preparation-a",
  userBId: "cm-authority-preparation-b",
  conversationId: "cm-authority-preparation-conversation",
  directMessageId: "cm-authority-preparation-direct-message",
  rpcMessageId: "45454545-4545-4454-8545-454545454545",
});

function validateTarget(rawUrl) {
  assert.ok(
    rawUrl,
    "CONVERSATION_MESSAGE_AUTHORITY_PROOF_DATABASE_URL is required",
  );
  const parsed = new URL(rawUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Conversation/Message authority preparation proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "Conversation/Message authority preparation proof requires grainline_ci",
  );
}

function newClient(applicationName) {
  return new Client({
    connectionString: databaseUrl,
    application_name: applicationName,
  });
}

function migrationSha256() {
  const bytes = fs.readFileSync(migrationPath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function readFunctionCatalog(owner) {
  const names = CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS
    .map((entry) => entry.name);
  const result = await owner.query(
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
          $1,
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
                    WHERE role.rolname = $1
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
                    WHERE role.rolname = $1
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
                    WHERE role.rolname = $1
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
        AND procedure.proname = ANY($2::text[])
      ORDER BY procedure.proname, args`,
    [runtimeRole, names],
  );
  return result.rows;
}

async function cleanFixtures(owner) {
  await owner.query(
    'DELETE FROM public."Message" WHERE id = ANY($1::text[])',
    [[fixture.directMessageId, fixture.rpcMessageId]],
  );
  await owner.query(
    'DELETE FROM public."Conversation" WHERE id = $1',
    [fixture.conversationId],
  );
  await owner.query(
    'DELETE FROM public."User" WHERE id = ANY($1::text[])',
    [[fixture.userAId, fixture.userBId]],
  );
}

async function main() {
  validateTarget(databaseUrl);
  assert.equal(
    migrationSha256(),
    expectedDisposableMigrationSha256,
    "exact disposable Conversation/Message authority migration bytes drifted",
  );

  const owner = newClient("cm-authority-preparation-proof-owner");
  const runtime = newClient("cm-authority-preparation-proof-runtime");
  await Promise.all([owner.connect(), runtime.connect()]);
  try {
    const tableCatalog = await owner.query(
      `SELECT
         class.relname AS table_name,
         class.relrowsecurity,
         class.relforcerowsecurity,
         (
           SELECT pg_catalog.count(*)::integer
             FROM pg_catalog.pg_policy AS policy
            WHERE policy.polrelid = class.oid
         ) AS policy_count,
         pg_catalog.has_table_privilege(
           $1, class.oid, 'SELECT'
         ) AS can_select,
         pg_catalog.has_table_privilege(
           $1, class.oid, 'INSERT'
         ) AS can_insert,
         pg_catalog.has_table_privilege(
           $1, class.oid, 'UPDATE'
         ) AS can_update,
         pg_catalog.has_table_privilege(
           $1, class.oid, 'DELETE'
         ) AS can_delete
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname IN ('Conversation', 'Message')
       ORDER BY class.relname`,
      [runtimeRole],
    );
    assert.deepEqual(tableCatalog.rows, [
      {
        table_name: "Conversation",
        relrowsecurity: false,
        relforcerowsecurity: false,
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
        policy_count: 0,
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
      },
    ]);

    const functionCatalog = await readFunctionCatalog(owner);
    assert.equal(
      functionCatalog.length,
      CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
    );
    assert.deepEqual(
      collectConversationMessageFunctionIssues(
        functionCatalog,
        runtimeRole,
        migrationRole,
      ),
      [],
    );

    await cleanFixtures(owner);
    await owner.query(
      `INSERT INTO public."User" (
         id, "clerkId", email, name, "updatedAt"
       ) VALUES
         ($1, 'clerk_cm_authority_preparation_a',
          'cm-authority-preparation-a@example.invalid',
          'Authority Preparation A', pg_catalog.clock_timestamp()),
         ($2, 'clerk_cm_authority_preparation_b',
          'cm-authority-preparation-b@example.invalid',
          'Authority Preparation B', pg_catalog.clock_timestamp())`,
      [fixture.userAId, fixture.userBId],
    );

    await runtime.query(`SET ROLE ${runtimeRole}`);
    const role = await runtime.query(
      "SELECT current_user, session_user",
    );
    assert.deepEqual(role.rows, [{
      current_user: runtimeRole,
      session_user: migrationRole,
    }]);

    await runtime.query(
      `INSERT INTO public."Conversation" (
         id, "userAId", "userBId", "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3,
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
       )`,
      [fixture.conversationId, fixture.userAId, fixture.userBId],
    );
    await runtime.query(
      `INSERT INTO public."Message" (
         id, "conversationId", "senderId", "recipientId", body, "createdAt"
       ) VALUES (
         $1, $2, $3, $4, 'old application direct insert',
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
       )`,
      [
        fixture.directMessageId,
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
      ],
    );
    const directRead = await runtime.query(
      `SELECT body
         FROM public."Message"
        WHERE id = $1`,
      [fixture.directMessageId],
    );
    assert.deepEqual(directRead.rows, [{
      body: "old application direct insert",
    }]);
    await runtime.query(
      `UPDATE public."Message"
          SET body = 'old application direct update'
        WHERE id = $1`,
      [fixture.directMessageId],
    );
    await runtime.query(
      `UPDATE public."Conversation"
          SET "archivedAAt" =
            pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
        WHERE id = $1`,
      [fixture.conversationId],
    );

    const recipientRead = await runtime.query(
      `SELECT id
         FROM public.grainline_conversation_get($1, $2)`,
      [fixture.userAId, fixture.conversationId],
    );
    assert.deepEqual(recipientRead.rows, [{ id: fixture.conversationId }]);
    const foreignRead = await runtime.query(
      `SELECT id
         FROM public.grainline_conversation_get($1, $2)`,
      ["cm-authority-preparation-foreign", fixture.conversationId],
    );
    assert.deepEqual(foreignRead.rows, []);

    const sent = await runtime.query(
      `SELECT *
         FROM public.grainline_message_send_ordinary(
           $1, $2, $3, 'new function send', NULL, NULL
         )`,
      [
        fixture.rpcMessageId,
        fixture.userBId,
        fixture.conversationId,
      ],
    );
    assert.equal(sent.rows.length, 1);
    assert.equal(sent.rows[0].messageId, fixture.rpcMessageId);
    assert.equal(sent.rows[0].recipientId, fixture.userAId);

    await assert.rejects(
      runtime.query(
        "SELECT * FROM public.grainline_conversation_lock_pair_core($1, $2)",
        [fixture.userAId, fixture.userBId],
      ),
      (error) => error?.code === "42501",
    );

    await runtime.query(
      'DELETE FROM public."Message" WHERE id = $1',
      [fixture.directMessageId],
    );
    const directDelete = await runtime.query(
      'DELETE FROM public."Message" WHERE id = $1 RETURNING id',
      [fixture.rpcMessageId],
    );
    assert.deepEqual(directDelete.rows, [{ id: fixture.rpcMessageId }]);
    const conversationDelete = await runtime.query(
      'DELETE FROM public."Conversation" WHERE id = $1 RETURNING id',
      [fixture.conversationId],
    );
    assert.deepEqual(conversationDelete.rows, [{
      id: fixture.conversationId,
    }]);
  } finally {
    await runtime.query("RESET ROLE").catch(() => {});
    await cleanFixtures(owner).catch(() => {});
    await Promise.allSettled([runtime.end(), owner.end()]);
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: "passed",
    proofMode: "ephemeral-loopback-functions-only-compatibility",
    migrationSha256: expectedDisposableMigrationSha256,
    functionCount: CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
    rlsEnabled: false,
    policyCount: 0,
    oldApplicationDirectCrudCompatible: true,
    newApplicationRecipientAndServiceRpcsCallable: true,
    privateCoresRuntimeCallable: false,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message:
      error?.message
      ?? "Conversation/Message authority preparation proof failed",
    detail: error?.detail ?? null,
  })}\n`);
  process.exitCode = 1;
});
