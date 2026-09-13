#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl =
  process.env.CONVERSATION_MESSAGE_FORCE_ROLLBACK_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";

function validateTarget(rawUrl) {
  assert.ok(
    rawUrl,
    "CONVERSATION_MESSAGE_FORCE_ROLLBACK_PROOF_DATABASE_URL is required",
  );
  const parsed = new URL(rawUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Conversation/Message FORCE rollback proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "Conversation/Message FORCE rollback proof requires grainline_ci",
  );
}

function newClient(applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
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
       (
         SELECT pg_catalog.string_agg(
           policy.polname::text,
           ',' ORDER BY policy.polname::text
         )
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       ) AS policy_names,
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

function expectedCatalog(force) {
  return [
    {
      table_name: "Conversation",
      relrowsecurity: true,
      relforcerowsecurity: force,
      policy_count: 1,
      policy_names:
        "grainline_conversation_participant_or_reported_select",
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
    {
      table_name: "Message",
      relrowsecurity: true,
      relforcerowsecurity: force,
      policy_count: 1,
      policy_names: "grainline_message_participant_or_reported_select",
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
  ];
}

async function setForceState(owner, force) {
  await owner.query("BEGIN");
  try {
    await owner.query("SET LOCAL lock_timeout = '10s'");
    await owner.query("SET LOCAL statement_timeout = '60s'");
    await owner.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended(
           'grainline.conversation-message.rls.force',
           0
         )
       )`,
    );
    await owner.query(
      'LOCK TABLE public."Conversation", public."Message" IN ACCESS EXCLUSIVE MODE',
    );
    const command = force ? "FORCE" : "NO FORCE";
    await owner.query(
      `ALTER TABLE public."Conversation" ${command} ROW LEVEL SECURITY`,
    );
    await owner.query(
      `ALTER TABLE public."Message" ${command} ROW LEVEL SECURITY`,
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("cm-force-rollback-owner");
  const runtime = newClient("cm-force-rollback-runtime");
  await Promise.all([owner.connect(), runtime.connect()]);
  let forceRestored = false;

  try {
    const identity = await owner.query(
      `SELECT
         current_user AS current_user_name,
         current_database() AS database_name`,
    );
    assert.deepEqual(identity.rows, [{
      current_user_name: "ci",
      database_name: "grainline_ci",
    }]);
    assert.deepEqual(await readCatalog(owner), expectedCatalog(true));

    await setForceState(owner, false);
    assert.deepEqual(await readCatalog(owner), expectedCatalog(false));

    await runtime.query(`SET ROLE ${runtimeRole}`);
    const runtimeIdentity = await runtime.query(
      "SELECT current_user, session_user",
    );
    assert.deepEqual(runtimeIdentity.rows, [{
      current_user: runtimeRole,
      session_user: "ci",
    }]);
    const noContextRows = await runtime.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
            FROM public."Conversation") AS conversations,
         (SELECT pg_catalog.count(*)::integer
            FROM public."Message") AS messages`,
    );
    assert.deepEqual(noContextRows.rows, [{
      conversations: 0,
      messages: 0,
    }]);
    await runtime.query("RESET ROLE");

    await setForceState(owner, true);
    forceRestored = true;
    assert.deepEqual(await readCatalog(owner), expectedCatalog(true));
  } finally {
    await runtime.query("RESET ROLE").catch(() => {});
    if (!forceRestored) {
      await setForceState(owner, true).catch(() => {});
    }
    await Promise.allSettled([runtime.end(), owner.end()]);
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: "passed",
    proofMode: "ephemeral-loopback-force-rollback",
    databaseFirstNoForceRollbackVerified: true,
    policiesPreserved: true,
    selectOnlyGrantsPreserved: true,
    runtimeNoContextIsolationPreserved: true,
    exactForceStateRestored: true,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

await main();
