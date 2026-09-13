#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl =
  process.env.CONVERSATION_MESSAGE_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  userAId: "cm-activation-rollback-a",
  userBId: "cm-activation-rollback-b",
  conversationId: "cm-activation-rollback-conversation",
  messageId: "cm-activation-rollback-message",
});

function validateTarget(rawUrl) {
  assert.ok(
    rawUrl,
    "CONVERSATION_MESSAGE_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL is required",
  );
  const parsed = new URL(rawUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Conversation/Message rollback proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "Conversation/Message rollback proof requires grainline_ci",
  );
}

function newClient(applicationName) {
  return new Client({
    connectionString: databaseUrl,
    application_name: applicationName,
  });
}

async function readCatalog(owner) {
  const result = await owner.query(
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
       AND class.relkind = 'r'
     ORDER BY class.relname`,
    [runtimeRole],
  );
  assert.equal(result.rows.length, 2);
  return result.rows;
}

async function cleanFixtures(owner) {
  await owner.query(
    'DELETE FROM public."Message" WHERE id = $1',
    [fixture.messageId],
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

async function restoreActivation(owner) {
  await owner.query("BEGIN");
  try {
    await owner.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended(
           'grainline.conversation-message.rls.activation',
           0
         )
       )`,
    );
    await owner.query(
      'LOCK TABLE public."Conversation", public."Message" IN ACCESS EXCLUSIVE MODE',
    );
    await cleanFixtures(owner);
    await owner.query(
      `REVOKE ALL ON TABLE
         public."Conversation",
         public."Message"
       FROM PUBLIC, grainline_app_runtime`,
    );
    await owner.query(
      `GRANT SELECT ON TABLE
         public."Conversation",
         public."Message"
       TO grainline_app_runtime`,
    );
    await owner.query(
      'ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."Conversation" NO FORCE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY',
    );
    await owner.query(
      'ALTER TABLE public."Message" NO FORCE ROW LEVEL SECURITY',
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("cm-activation-rollback-owner");
  const runtime = newClient("cm-activation-rollback-runtime");
  await Promise.all([owner.connect(), runtime.connect()]);
  let rollbackCommitted = false;
  let activationRestored = false;

  try {
    const activatedCatalog = [
      {
        table_name: "Conversation",
        relrowsecurity: true,
        relforcerowsecurity: false,
        policy_count: 1,
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
      {
        table_name: "Message",
        relrowsecurity: true,
        relforcerowsecurity: false,
        policy_count: 1,
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ];
    assert.deepEqual(await readCatalog(owner), activatedCatalog);
    await cleanFixtures(owner);
    await owner.query(
      `INSERT INTO public."User" (
         id, "clerkId", email, name, "updatedAt"
       ) VALUES
         ($1, 'clerk_cm_activation_rollback_a',
          'cm-activation-rollback-a@example.invalid',
          'Activation Rollback A', pg_catalog.clock_timestamp()),
         ($2, 'clerk_cm_activation_rollback_b',
          'cm-activation-rollback-b@example.invalid',
          'Activation Rollback B', pg_catalog.clock_timestamp())`,
      [fixture.userAId, fixture.userBId],
    );

    await owner.query("BEGIN");
    try {
      await owner.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             'grainline.conversation-message.rls.activation',
             0
           )
         )`,
      );
      await owner.query(
        'LOCK TABLE public."Conversation", public."Message" IN ACCESS EXCLUSIVE MODE',
      );
      await owner.query(
        'ALTER TABLE public."Conversation" DISABLE ROW LEVEL SECURITY',
      );
      await owner.query(
        'ALTER TABLE public."Message" DISABLE ROW LEVEL SECURITY',
      );
      await owner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
           public."Conversation",
           public."Message"
         TO grainline_app_runtime`,
      );
      await owner.query("COMMIT");
      rollbackCommitted = true;
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }

    assert.deepEqual(await readCatalog(owner), [
      {
        ...activatedCatalog[0],
        relrowsecurity: false,
        can_insert: true,
        can_update: true,
        can_delete: true,
      },
      {
        ...activatedCatalog[1],
        relrowsecurity: false,
        can_insert: true,
        can_update: true,
        can_delete: true,
      },
    ]);

    await runtime.query(`SET ROLE ${runtimeRole}`);
    const identity = await runtime.query("SELECT current_user, session_user");
    assert.deepEqual(identity.rows, [{
      current_user: runtimeRole,
      session_user: "ci",
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
         $1, $2, $3, $4, 'activation rollback proof',
         pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
       )`,
      [
        fixture.messageId,
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
      ],
    );
    const directRead = await runtime.query(
      `SELECT body
         FROM public."Message"
        WHERE id = $1`,
      [fixture.messageId],
    );
    assert.deepEqual(directRead.rows, [{
      body: "activation rollback proof",
    }]);
    await runtime.query(
      `UPDATE public."Message"
          SET body = 'activation rollback update'
        WHERE id = $1`,
      [fixture.messageId],
    );
    const recipientRead = await runtime.query(
      "SELECT id FROM public.grainline_conversation_get($1, $2)",
      [fixture.userAId, fixture.conversationId],
    );
    assert.deepEqual(recipientRead.rows, [{ id: fixture.conversationId }]);
    const messageDelete = await runtime.query(
      'DELETE FROM public."Message" WHERE id = $1 RETURNING id',
      [fixture.messageId],
    );
    assert.deepEqual(messageDelete.rows, [{ id: fixture.messageId }]);
    const conversationDelete = await runtime.query(
      'DELETE FROM public."Conversation" WHERE id = $1 RETURNING id',
      [fixture.conversationId],
    );
    assert.deepEqual(conversationDelete.rows, [{
      id: fixture.conversationId,
    }]);
    await runtime.query("RESET ROLE");

    await restoreActivation(owner);
    activationRestored = true;
    assert.deepEqual(await readCatalog(owner), activatedCatalog);
    await cleanFixtures(owner);
  } finally {
    await runtime.query("RESET ROLE").catch(() => {});
    if (rollbackCommitted && !activationRestored) {
      await restoreActivation(owner).catch(() => {});
    }
    await cleanFixtures(owner).catch(() => {});
    await Promise.allSettled([runtime.end(), owner.end()]);
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: "passed",
    proofMode: "ephemeral-loopback-initial-activation-rollback",
    rollbackPreservedPoliciesAndFunctions: true,
    oldApplicationDirectCrudCompatible: true,
    fixedRecipientFunctionCompatible: true,
    exactInitialActivationRestored: true,
    fixtureResidue: 0,
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
      ?? "Conversation/Message activation rollback proof failed",
    detail: error?.detail ?? null,
  })}\n`);
  process.exitCode = 1;
});
