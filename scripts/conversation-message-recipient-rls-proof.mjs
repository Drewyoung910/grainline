#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.CONVERSATION_MESSAGE_RECIPIENT_RLS_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const recipientSql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-recipient-access.sql",
  "utf8",
);
const policySql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-policies.sql",
  "utf8",
);
const serviceSql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-service-authority.sql",
  "utf8",
);

const fixture = Object.freeze({
  userAId: "cm-recipient-rls-a",
  userBId: "cm-recipient-rls-b",
  userCId: "cm-recipient-rls-c",
  staffId: "cm-recipient-rls-d",
  userEId: "cm-recipient-rls-e",
  conversationABId: "cm-recipient-rls-conversation-ab",
  conversationCEId: "cm-recipient-rls-conversation-ce",
  messageAB1Id: "cm-recipient-rls-message-ab-1",
  messageAB2Id: "cm-recipient-rls-message-ab-2",
  messageCEId: "cm-recipient-rls-message-ce",
  reportId: "cm-recipient-rls-report",
  blockId: "cm-recipient-rls-block",
  serviceBlockId: "cm-recipient-rls-service-block",
  startedConversationId: "11111111-1111-4111-8111-111111111111",
  sentMessageId: "22222222-2222-4222-8222-222222222222",
  replyMessageId: "33333333-3333-4333-8333-333333333333",
});

const completedChecks = [];

function record(check) {
  completedChecks.push(check);
}

function validateTarget(rawUrl) {
  assert.ok(
    rawUrl,
    "CONVERSATION_MESSAGE_RECIPIENT_RLS_PROOF_DATABASE_URL is required",
  );
  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1",
    "Conversation/Message recipient RLS proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "Conversation/Message recipient RLS proof requires grainline_ci",
  );
}

function newClient(applicationName) {
  return new Client({
    connectionString: databaseUrl,
    application_name: applicationName,
  });
}

async function expectPgError(operation, expectedCodes, label) {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      expectedCodes.includes(error?.code),
      `${label} failed with unexpected PostgreSQL code ${error?.code ?? "unknown"}`,
    );
    return;
  }
  assert.fail(`${label} unexpectedly succeeded`);
}

async function cleanFixtures(owner) {
  await owner.query(
    'DELETE FROM public."Block" WHERE id = ANY($1::text[])',
    [[fixture.blockId, fixture.serviceBlockId]],
  );
  await owner.query(
    'DELETE FROM public."UserReport" WHERE id = $1',
    [fixture.reportId],
  );
  await owner.query(
    'DELETE FROM public."Message" WHERE id = ANY($1::text[])',
    [[
      fixture.messageAB1Id,
      fixture.messageAB2Id,
      fixture.messageCEId,
      fixture.sentMessageId,
      fixture.replyMessageId,
    ]],
  );
  await owner.query(
    'DELETE FROM public."Conversation" WHERE id = ANY($1::text[])',
    [[
      fixture.conversationABId,
      fixture.conversationCEId,
      fixture.startedConversationId,
    ]],
  );
  await owner.query(
    'DELETE FROM public."User" WHERE id = ANY($1::text[])',
    [[
      fixture.userAId,
      fixture.userBId,
      fixture.userCId,
      fixture.staffId,
      fixture.userEId,
    ]],
  );
}

async function seedFixtures(owner) {
  await cleanFixtures(owner);
  await owner.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, name, role, "updatedAt"
     ) VALUES
       ($1, 'clerk_cm_recipient_a', 'cm-recipient-a@example.invalid',
        'Recipient A', 'USER', pg_catalog.clock_timestamp()),
       ($2, 'clerk_cm_recipient_b', 'cm-recipient-b@example.invalid',
        'Recipient B', 'USER', pg_catalog.clock_timestamp()),
       ($3, 'clerk_cm_recipient_c', 'cm-recipient-c@example.invalid',
        'Recipient C', 'USER', pg_catalog.clock_timestamp()),
       ($4, 'clerk_cm_recipient_staff', 'cm-recipient-staff@example.invalid',
        'Recipient Staff', 'ADMIN', pg_catalog.clock_timestamp()),
       ($5, 'clerk_cm_recipient_e', 'cm-recipient-e@example.invalid',
        'Recipient E', 'USER', pg_catalog.clock_timestamp())`,
    [
      fixture.userAId,
      fixture.userBId,
      fixture.userCId,
      fixture.staffId,
      fixture.userEId,
    ],
  );
  await owner.query(
    `INSERT INTO public."Conversation" (
       id, "userAId", "userBId", "createdAt", "updatedAt"
     ) VALUES
       ($1, $3, $4, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
       ($2, $5, $6, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`,
    [
      fixture.conversationABId,
      fixture.conversationCEId,
      fixture.userAId,
      fixture.userBId,
      fixture.userCId,
      fixture.userEId,
    ],
  );
  await owner.query(
    `INSERT INTO public."Message" (
       id, "conversationId", "senderId", "recipientId", body, "createdAt"
     ) VALUES
       ($1, $4, $5, $6, 'hello from A', '2026-01-02T00:00:00Z'),
       ($2, $4, $6, $5, 'reply from B', '2026-01-02T00:00:01Z'),
       ($3, $7, $8, $9, 'foreign thread', '2026-01-02T00:00:00Z')`,
    [
      fixture.messageAB1Id,
      fixture.messageAB2Id,
      fixture.messageCEId,
      fixture.conversationABId,
      fixture.userAId,
      fixture.userBId,
      fixture.conversationCEId,
      fixture.userCId,
      fixture.userEId,
    ],
  );
  await owner.query(
    `INSERT INTO public."UserReport" (
       id, "reporterId", "reportedId", reason, "targetType", "targetId"
     ) VALUES ($1, $2, $3, 'recipient proof', 'MESSAGE_THREAD', $4)`,
    [
      fixture.reportId,
      fixture.userAId,
      fixture.userBId,
      fixture.conversationABId,
    ],
  );
}

async function applyDraft(owner) {
  await owner.query(recipientSql);
  await owner.query(serviceSql);
  await owner.query(policySql);
  record("recipient_and_fixed_write_functions_with_select_only_policies_applied");
}

async function proveCatalog(owner) {
  const tables = await owner.query(`
    SELECT relation.relname,
           relation.relrowsecurity,
           relation.relforcerowsecurity,
           (
             SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid = relation.oid
           ) AS policy_count,
           pg_catalog.has_table_privilege(
             '${runtimeRole}', relation.oid, 'SELECT'
           ) AS can_select,
           pg_catalog.has_table_privilege(
             '${runtimeRole}', relation.oid, 'INSERT'
           ) AS can_insert,
           pg_catalog.has_table_privilege(
             '${runtimeRole}', relation.oid, 'UPDATE'
           ) AS can_update,
           pg_catalog.has_table_privilege(
             '${runtimeRole}', relation.oid, 'DELETE'
           ) AS can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('Conversation', 'Message')
     ORDER BY relation.relname
  `);
  assert.deepEqual(tables.rows, [
    {
      relname: "Conversation",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policy_count: 1,
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
    {
      relname: "Message",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policy_count: 1,
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    },
  ]);

  const functions = await owner.query(`
    SELECT procedure.proname,
           procedure.prosecdef,
           procedure.proconfig,
           pg_catalog.has_function_privilege(
             '${runtimeRole}', procedure.oid, 'EXECUTE'
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
         'grainline_conversation_staff_report_visible',
         'grainline_conversation_get',
         'grainline_conversation_pair',
         'grainline_conversation_lock_pair_core',
         'grainline_conversation_listing_core',
         'grainline_conversation_start',
         'grainline_message_send_ordinary',
         'grainline_conversation_set_archived',
         'grainline_message_mark_read',
         'grainline_conversation_claim_message_email',
         'grainline_message_list',
         'grainline_message_unread_count',
         'grainline_message_latest_custom_request',
         'grainline_message_report_target_valid',
         'grainline_message_export',
         'grainline_conversation_inbox'
       )
     ORDER BY procedure.proname
  `);
  assert.equal(functions.rows.length, 16);
  const privateFunctions = new Set([
    "grainline_conversation_lock_pair_core",
    "grainline_conversation_listing_core",
  ]);
  assert.equal(
    functions.rows.every((row) => (
      row.runtime_can_execute === !privateFunctions.has(row.proname)
    )),
    true,
  );
  assert.equal(functions.rows.every((row) => row.public_execute_revoked), true);
  assert.deepEqual(
    functions.rows.filter((row) => row.prosecdef).map((row) => row.proname),
    [
      "grainline_conversation_claim_message_email",
      "grainline_conversation_listing_core",
      "grainline_conversation_lock_pair_core",
      "grainline_conversation_set_archived",
      "grainline_conversation_staff_report_visible",
      "grainline_conversation_start",
      "grainline_message_mark_read",
      "grainline_message_send_ordinary",
    ],
  );
  assert.equal(
    functions.rows.every((row) => (
      JSON.stringify(row.proconfig) === JSON.stringify(["search_path=pg_catalog"])
    )),
    true,
  );
  record("exact_policy_grant_function_acl_and_search_path_catalog");
}

async function proveRuntimeIsolation(owner) {
  const runtime = newClient("cm-recipient-rls-runtime");
  await runtime.connect();
  try {
    await runtime.query(`SET ROLE ${runtimeRole}`);
    const identity = await runtime.query(
      "SELECT current_user AS current_user_name, session_user AS session_user_name",
    );
    assert.deepEqual(identity.rows, [{
      current_user_name: runtimeRole,
      session_user_name: "ci",
    }]);

    const directWithoutContext = await runtime.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM public."Conversation") AS conversations,
        (SELECT pg_catalog.count(*)::integer
           FROM public."Message") AS messages
    `);
    assert.deepEqual(directWithoutContext.rows, [{
      conversations: 0,
      messages: 0,
    }]);

    const conversationA = await runtime.query(
      "SELECT * FROM public.grainline_conversation_get($1, $2)",
      [fixture.userAId, fixture.conversationABId],
    );
    assert.equal(conversationA.rows.length, 1);
    const conversationC = await runtime.query(
      "SELECT * FROM public.grainline_conversation_get($1, $2)",
      [fixture.userCId, fixture.conversationABId],
    );
    assert.equal(conversationC.rows.length, 0);

    const messagesA = await runtime.query(
      `SELECT * FROM public.grainline_message_list(
         $1, $2, 'after', NULL, NULL, 50
       )`,
      [fixture.userAId, fixture.conversationABId],
    );
    assert.deepEqual(
      messagesA.rows.map((row) => row.id),
      [fixture.messageAB1Id, fixture.messageAB2Id],
    );
    const messagesC = await runtime.query(
      `SELECT * FROM public.grainline_message_list(
         $1, $2, 'after', NULL, NULL, 50
       )`,
      [fixture.userCId, fixture.conversationABId],
    );
    assert.equal(messagesC.rows.length, 0);

    const pairA = await runtime.query(
      "SELECT public.grainline_conversation_pair($1, $2) AS id",
      [fixture.userAId, fixture.userBId],
    );
    assert.equal(pairA.rows[0].id, fixture.conversationABId);
    const exportA = await runtime.query(
      "SELECT * FROM public.grainline_message_export($1)",
      [fixture.userAId],
    );
    assert.deepEqual(
      exportA.rows.map((row) => row.id).sort(),
      [fixture.messageAB1Id, fixture.messageAB2Id].sort(),
    );

    const reportMessage = await runtime.query(
      `SELECT public.grainline_message_report_target_valid(
         $1, $2, 'MESSAGE', $3
       ) AS valid`,
      [fixture.userAId, fixture.userBId, fixture.messageAB1Id],
    );
    assert.equal(reportMessage.rows[0].valid, true);
    const forgedReport = await runtime.query(
      `SELECT public.grainline_message_report_target_valid(
         $1, $2, 'MESSAGE', $3
       ) AS valid`,
      [fixture.userCId, fixture.userBId, fixture.messageAB1Id],
    );
    assert.equal(forgedReport.rows[0].valid, false);

    const contextCleared = await runtime.query(`
      SELECT
        NULLIF(
          pg_catalog.current_setting('app.user_id', true),
          ''
        ) AS user_id,
        (SELECT pg_catalog.count(*)::integer
           FROM public."Conversation") AS conversations,
        (SELECT pg_catalog.count(*)::integer
           FROM public."Message") AS messages
    `);
    assert.deepEqual(contextCleared.rows, [{
      user_id: null,
      conversations: 0,
      messages: 0,
    }]);

    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Message" (
           id, "conversationId", "senderId", "recipientId", body
         ) VALUES ('cm-recipient-rls-forged', $1, $2, $3, 'forged')`,
        [fixture.conversationABId, fixture.userAId, fixture.userBId],
      ),
      ["42501"],
      "direct runtime Message insert",
    );
    await expectPgError(
      () => runtime.query(
        'UPDATE public."Conversation" SET "archivedAAt" = NULL WHERE id = $1',
        [fixture.conversationABId],
      ),
      ["42501"],
      "direct runtime Conversation update",
    );
    await expectPgError(
      () => runtime.query(
        'DELETE FROM public."Message" WHERE id = $1',
        [fixture.messageAB1Id],
      ),
      ["42501"],
      "direct runtime Message delete",
    );
    record("participant_isolation_context_reset_and_direct_write_denial");

    const started = await runtime.query(
      `SELECT * FROM public.grainline_conversation_start(
         $1, $2, $3, NULL
       )`,
      [fixture.startedConversationId, fixture.userAId, fixture.userCId],
    );
    assert.deepEqual(started.rows, [{
      conversationId: fixture.startedConversationId,
      created: true,
      contextListingId: null,
    }]);
    const startedAgain = await runtime.query(
      `SELECT * FROM public.grainline_conversation_start(
         $1, $2, $3, NULL
       )`,
      [
        "44444444-4444-4444-8444-444444444444",
        fixture.userCId,
        fixture.userAId,
      ],
    );
    assert.deepEqual(startedAgain.rows, [{
      conversationId: fixture.startedConversationId,
      created: false,
      contextListingId: null,
    }]);

    const sent = await runtime.query(
      `SELECT * FROM public.grainline_message_send_ordinary(
         $1, $2, $3, $4, NULL, NULL
       )`,
      [
        fixture.sentMessageId,
        fixture.userAId,
        fixture.startedConversationId,
        "service-authority hello",
      ],
    );
    assert.equal(sent.rows.length, 1);
    assert.equal(sent.rows[0].messageId, fixture.sentMessageId);
    assert.equal(sent.rows[0].recipientId, fixture.userCId);
    assert.equal(sent.rows[0].firstResponseSet, false);

    const archived = await runtime.query(
      "SELECT public.grainline_conversation_set_archived($1, $2, true) AS changed",
      [fixture.userAId, fixture.startedConversationId],
    );
    assert.equal(archived.rows[0].changed, true);
    const archivedState = await owner.query(
      `SELECT "archivedAAt", "archivedBAt"
         FROM public."Conversation"
        WHERE id = $1`,
      [fixture.startedConversationId],
    );
    assert.ok(archivedState.rows[0].archivedAAt instanceof Date);
    assert.equal(archivedState.rows[0].archivedBAt, null);

    const reply = await runtime.query(
      `SELECT * FROM public.grainline_message_send_ordinary(
         $1, $2, $3, $4, NULL, NULL
       )`,
      [
        fixture.replyMessageId,
        fixture.userCId,
        fixture.startedConversationId,
        "service-authority reply",
      ],
    );
    assert.equal(reply.rows.length, 1);
    assert.equal(reply.rows[0].recipientId, fixture.userAId);
    assert.equal(reply.rows[0].firstResponseSet, true);
    const reopenedState = await owner.query(
      `SELECT "archivedAAt", "archivedBAt", "firstResponseAt"
         FROM public."Conversation"
        WHERE id = $1`,
      [fixture.startedConversationId],
    );
    assert.equal(reopenedState.rows[0].archivedAAt, null);
    assert.equal(reopenedState.rows[0].archivedBAt, null);
    assert.ok(reopenedState.rows[0].firstResponseAt instanceof Date);

    const markedC = await runtime.query(
      "SELECT public.grainline_message_mark_read($1, $2) AS count",
      [fixture.userCId, fixture.startedConversationId],
    );
    assert.equal(markedC.rows[0].count, 1);
    const markedA = await runtime.query(
      "SELECT public.grainline_message_mark_read($1, $2) AS count",
      [fixture.userAId, fixture.startedConversationId],
    );
    assert.equal(markedA.rows[0].count, 1);
    const readRows = await owner.query(
      `SELECT id, "readAt"
         FROM public."Message"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [[fixture.sentMessageId, fixture.replyMessageId]],
    );
    assert.equal(readRows.rows.every((row) => row.readAt instanceof Date), true);

    const claimedEmail = await runtime.query(
      `SELECT public.grainline_conversation_claim_message_email(
         $1, $2
       ) AS claimed`,
      [fixture.userCId, fixture.replyMessageId],
    );
    assert.equal(claimedEmail.rows[0].claimed, true);
    const repeatedEmail = await runtime.query(
      `SELECT public.grainline_conversation_claim_message_email(
         $1, $2
       ) AS claimed`,
      [fixture.userCId, fixture.replyMessageId],
    );
    assert.equal(repeatedEmail.rows[0].claimed, false);

    await expectPgError(
      () => runtime.query(
        `SELECT * FROM public.grainline_message_send_ordinary(
           '55555555-5555-4555-8555-555555555555',
           $1, $2, 'forged kind', 'custom_order_link', NULL
         )`,
        [fixture.userAId, fixture.startedConversationId],
      ),
      ["22023"],
      "caller-selected structured Message kind",
    );
    await expectPgError(
      () => runtime.query(
        `SELECT * FROM public.grainline_message_send_ordinary(
           '66666666-6666-4666-8666-666666666666',
           $1, $2, '{"kind":"file"}', 'file', NULL
         )`,
        [fixture.userAId, fixture.startedConversationId],
      ),
      ["22023"],
      "incomplete file Message payload",
    );
    await expectPgError(
      () => runtime.query(
        "SELECT * FROM public.grainline_conversation_lock_pair_core($1, $2)",
        [fixture.userAId, fixture.userBId],
      ),
      ["42501"],
      "direct runtime private pair core execution",
    );
    await expectPgError(
      () => runtime.query(
        `SELECT * FROM public.grainline_message_send_ordinary(
           '77777777-7777-4777-8777-777777777777',
           $1, $2, 'not a participant', NULL, NULL
         )`,
        [fixture.userBId, fixture.startedConversationId],
      ),
      ["42501"],
      "nonparticipant ordinary send",
    );

    await owner.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId")
       VALUES ($1, $2, $3)`,
      [fixture.serviceBlockId, fixture.userAId, fixture.userCId],
    );
    await expectPgError(
      () => runtime.query(
        `SELECT * FROM public.grainline_message_send_ordinary(
           '88888888-8888-4888-8888-888888888888',
           $1, $2, 'blocked send', NULL, NULL
         )`,
        [fixture.userAId, fixture.startedConversationId],
      ),
      ["42501"],
      "blocked ordinary send",
    );
    await owner.query(
      'DELETE FROM public."Block" WHERE id = $1',
      [fixture.serviceBlockId],
    );
    record("fixed_start_send_archive_mark_read_email_and_private_core_authority");

    const staffVisible = await runtime.query(
      "SELECT * FROM public.grainline_conversation_get($1, $2)",
      [fixture.staffId, fixture.conversationABId],
    );
    assert.equal(staffVisible.rows.length, 1);
    const staffMessages = await runtime.query(
      `SELECT * FROM public.grainline_message_list(
         $1, $2, 'after', NULL, NULL, 50
       )`,
      [fixture.staffId, fixture.conversationABId],
    );
    assert.equal(staffMessages.rows.length, 2);

    await owner.query(
      'UPDATE public."UserReport" SET resolved = true WHERE id = $1',
      [fixture.reportId],
    );
    const resolvedStaff = await runtime.query(
      "SELECT * FROM public.grainline_conversation_get($1, $2)",
      [fixture.staffId, fixture.conversationABId],
    );
    assert.equal(resolvedStaff.rows.length, 0);

    await owner.query(
      'UPDATE public."UserReport" SET resolved = false WHERE id = $1',
      [fixture.reportId],
    );
    await owner.query(
      'UPDATE public."User" SET banned = true WHERE id = $1',
      [fixture.staffId],
    );
    const bannedStaff = await runtime.query(
      "SELECT * FROM public.grainline_conversation_get($1, $2)",
      [fixture.staffId, fixture.conversationABId],
    );
    assert.equal(bannedStaff.rows.length, 0);
    await owner.query(
      'UPDATE public."User" SET banned = false WHERE id = $1',
      [fixture.staffId],
    );
    record("exact_reported_staff_access_resolves_and_inactive_staff_denied");

    const unreadBeforeBlock = await runtime.query(
      "SELECT public.grainline_message_unread_count($1) AS count",
      [fixture.userBId],
    );
    assert.equal(Number(unreadBeforeBlock.rows[0].count), 1);
    const inboxBeforeBlock = await runtime.query(
      `SELECT * FROM public.grainline_conversation_inbox(
         $1, false, '', NULL, NULL, 51
       )`,
      [fixture.userBId],
    );
    assert.equal(inboxBeforeBlock.rows.length, 1);
    assert.equal(Number(inboxBeforeBlock.rows[0].unreadCount), 1);

    await owner.query(
      `INSERT INTO public."Block" (id, "blockerId", "blockedId")
       VALUES ($1, $2, $3)`,
      [fixture.blockId, fixture.userAId, fixture.userBId],
    );
    const unreadAfterBlock = await runtime.query(
      "SELECT public.grainline_message_unread_count($1) AS count",
      [fixture.userBId],
    );
    assert.equal(Number(unreadAfterBlock.rows[0].count), 0);
    const inboxAfterBlock = await runtime.query(
      `SELECT * FROM public.grainline_conversation_inbox(
         $1, false, '', NULL, NULL, 51
       )`,
      [fixture.userBId],
    );
    assert.equal(inboxAfterBlock.rows.length, 0);
    record("unread_inbox_block_filter_and_summary");
  } finally {
    await runtime.query("RESET ROLE").catch(() => {});
    await runtime.end();
  }
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("cm-recipient-rls-owner");
  await owner.connect();
  try {
    const identity = await owner.query(
      "SELECT current_user AS current_user_name, current_database() AS database_name",
    );
    assert.deepEqual(identity.rows, [{
      current_user_name: "ci",
      database_name: "grainline_ci",
    }]);
    await seedFixtures(owner);
    await applyDraft(owner);
    await proveCatalog(owner);
    await proveRuntimeIsolation(owner);
  } finally {
    await cleanFixtures(owner).catch(() => {});
    await owner.end();
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    database: "loopback/grainline_ci",
    ownerRole: "ci",
    effectiveRuntimeRole: runtimeRole,
    proofMode: "ephemeral_owner_session_set_role",
    completedChecks,
    productionChanged: false,
    persistentStagingChanged: false,
  })}\n`);
}

await main();
