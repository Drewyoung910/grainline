import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.CONVERSATION_MESSAGE_INVARIANT_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  userAId: "cm-invariant-proof-user-a",
  userBId: "cm-invariant-proof-user-b",
  foreignUserId: "cm-invariant-proof-user-c",
  conversationId: "cm-invariant-proof-conversation",
  runtimeMessageId: "cm-invariant-proof-runtime-message",
  raceFirstMessageId: "cm-invariant-proof-race-first",
  raceSecondMessageId: "cm-invariant-proof-race-second",
});

const completedChecks = [];

function record(check) {
  completedChecks.push(check);
}

function validateTarget(rawUrl) {
  assert.ok(rawUrl, "CONVERSATION_MESSAGE_INVARIANT_PROOF_DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1",
    "Conversation/Message invariant proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, "/grainline_ci", "Conversation/Message invariant proof requires grainline_ci");
}

function newClient(applicationName) {
  return new Client({ connectionString: databaseUrl, application_name: applicationName });
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
    'DELETE FROM public."Message" WHERE id = ANY($1::text[])',
    [[fixture.runtimeMessageId, fixture.raceFirstMessageId, fixture.raceSecondMessageId]],
  );
  await owner.query('DELETE FROM public."Conversation" WHERE id = $1', [fixture.conversationId]);
  await owner.query(
    'DELETE FROM public."User" WHERE id = ANY($1::text[])',
    [[fixture.userAId, fixture.userBId, fixture.foreignUserId]],
  );
}

async function seedFixtures(owner) {
  await cleanFixtures(owner);
  await owner.query(
    `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt")
     VALUES
       ($1, 'clerk_cm_invariant_a', 'cm-invariant-a@example.invalid', 'Invariant A', pg_catalog.clock_timestamp()),
       ($2, 'clerk_cm_invariant_b', 'cm-invariant-b@example.invalid', 'Invariant B', pg_catalog.clock_timestamp()),
       ($3, 'clerk_cm_invariant_c', 'cm-invariant-c@example.invalid', 'Invariant C', pg_catalog.clock_timestamp())`,
    [fixture.userAId, fixture.userBId, fixture.foreignUserId],
  );
  await owner.query(
    `INSERT INTO public."Conversation" (
       id, "userAId", "userBId", "createdAt", "updatedAt", "archivedAAt", "archivedBAt"
     ) VALUES ($1, $2, $3, $4, $4, $4, $4)`,
    [fixture.conversationId, fixture.userAId, fixture.userBId, "2026-01-01T00:00:00.000Z"],
  );
}

async function readCatalog(owner) {
  const constraints = await owner.query(`
    SELECT conname, convalidated
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public."Conversation"'::pg_catalog.regclass
       AND conname = 'Conversation_canonical_participant_pair_check'
  `);
  assert.deepEqual(constraints.rows, [{
    conname: "Conversation_canonical_participant_pair_check",
    convalidated: true,
  }]);

  const functions = await owner.query(`
    SELECT
      procedure.proname,
      procedure.prosecdef,
      procedure.proconfig,
      pg_catalog.has_function_privilege(
        '${runtimeRole}',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_can_execute
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
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog, pg_temp"]);
    assert.equal(row.runtime_can_execute, false);
  }
  assert.equal(
    functions.rows.find((row) => row.proname === "grainline_message_participants_match_conversation")?.prosecdef,
    true,
  );
  assert.equal(
    functions.rows.find((row) => row.proname === "grainline_message_maintain_thread_state")?.prosecdef,
    true,
  );

  const triggers = await owner.query(`
    SELECT trigger.tgname, trigger.tgenabled
      FROM pg_catalog.pg_trigger AS trigger
     WHERE NOT trigger.tgisinternal
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

  const index = await owner.query(`
    SELECT index_state.indisvalid, index_state.indisready
      FROM pg_catalog.pg_class AS index_relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_relation.oid
     WHERE namespace.nspname = 'public'
       AND index_relation.relname = 'Message_body_trgm_idx'
  `);
  assert.deepEqual(index.rows, [{ indisvalid: true, indisready: true }]);
  record("catalog_constraints_triggers_private_functions_and_search_index");
}

async function proveRuntimeWrites(owner) {
  const runtime = newClient("cm-invariant-runtime");
  await runtime.connect();
  try {
    await runtime.query(`SET ROLE ${runtimeRole}`);
    const identity = await runtime.query("SELECT current_user, session_user");
    assert.equal(identity.rows[0].current_user, runtimeRole);
    assert.equal(identity.rows[0].session_user, "ci");

    const messageCreatedAt = "2026-01-02T00:00:00.000Z";
    await runtime.query(
      `INSERT INTO public."Message" (
         id, "conversationId", "senderId", "recipientId", body, "createdAt"
       ) VALUES ($1, $2, $3, $4, 'valid runtime message', $5)`,
      [
        fixture.runtimeMessageId,
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
        messageCreatedAt,
      ],
    );
    const thread = await owner.query(
      `SELECT "updatedAt", "archivedAAt", "archivedBAt"
         FROM public."Conversation" WHERE id = $1`,
      [fixture.conversationId],
    );
    assert.equal(thread.rows[0].updatedAt.toISOString(), messageCreatedAt);
    assert.equal(thread.rows[0].archivedAAt, null);
    assert.equal(thread.rows[0].archivedBAt, null);

    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Message" (
           id, "conversationId", "senderId", "recipientId", body
         ) VALUES ('cm-invariant-proof-forged', $1, $2, $3, 'forged')`,
        [fixture.conversationId, fixture.foreignUserId, fixture.userBId],
      ),
      ["23514"],
      "forged Message sender",
    );
    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Message" (
           id, "conversationId", "senderId", "recipientId", body
         ) VALUES ('cm-invariant-proof-self-message', $1, $2, $2, 'self')`,
        [fixture.conversationId, fixture.userAId],
      ),
      ["23514"],
      "self Message",
    );
    await expectPgError(
      () => runtime.query(
        'UPDATE public."Message" SET "recipientId" = $1 WHERE id = $2',
        [fixture.foreignUserId, fixture.runtimeMessageId],
      ),
      ["23514"],
      "Message route rewrite",
    );
    await expectPgError(
      () => runtime.query(
        'UPDATE public."Conversation" SET "userBId" = $1 WHERE id = $2',
        [fixture.foreignUserId, fixture.conversationId],
      ),
      ["23514"],
      "Conversation participant rewrite",
    );
    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Conversation" (id, "userAId", "userBId", "updatedAt")
         VALUES ('cm-invariant-proof-swapped', $1, $2, pg_catalog.clock_timestamp())`,
        [fixture.userBId, fixture.userAId],
      ),
      ["23514"],
      "noncanonical Conversation",
    );
    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Conversation" (id, "userAId", "userBId", "updatedAt")
         VALUES ('cm-invariant-proof-self-conversation', $1, $1, pg_catalog.clock_timestamp())`,
        [fixture.userAId],
      ),
      ["23514"],
      "self Conversation",
    );
    record("runtime_valid_insert_and_forged_routes_rejected");
  } finally {
    await runtime.end();
  }
}

async function waitForLock(observer, applicationName) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await observer.query(
      `SELECT wait_event_type
         FROM pg_catalog.pg_stat_activity
        WHERE application_name = $1
          AND state = 'active'`,
      [applicationName],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`${applicationName} did not wait on the Conversation lock`);
}

async function proveConcurrentMonotonicState(owner) {
  await owner.query(
    `UPDATE public."Conversation"
        SET "updatedAt" = $2, "archivedAAt" = $2, "archivedBAt" = $2
      WHERE id = $1`,
    [fixture.conversationId, "2026-01-03T00:00:00.000Z"],
  );

  const first = newClient("cm-invariant-first");
  const second = newClient("cm-invariant-second");
  const observer = newClient("cm-invariant-observer");
  await Promise.all([first.connect(), second.connect(), observer.connect()]);
  try {
    await first.query("BEGIN");
    await first.query(
      `INSERT INTO public."Message" (
         id, "conversationId", "senderId", "recipientId", body, "createdAt"
       ) VALUES ($1, $2, $3, $4, 'newer first', $5)`,
      [
        fixture.raceFirstMessageId,
        fixture.conversationId,
        fixture.userAId,
        fixture.userBId,
        "2026-01-05T00:00:00.000Z",
      ],
    );

    await second.query("BEGIN");
    const waitingInsert = second.query(
      `INSERT INTO public."Message" (
         id, "conversationId", "senderId", "recipientId", body, "createdAt"
       ) VALUES ($1, $2, $3, $4, 'older second', $5)`,
      [
        fixture.raceSecondMessageId,
        fixture.conversationId,
        fixture.userBId,
        fixture.userAId,
        "2026-01-04T00:00:00.000Z",
      ],
    );
    await waitForLock(observer, "cm-invariant-second");
    await first.query("COMMIT");
    await waitingInsert;
    await second.query("COMMIT");

    const thread = await owner.query(
      `SELECT "updatedAt", "archivedAAt", "archivedBAt"
         FROM public."Conversation" WHERE id = $1`,
      [fixture.conversationId],
    );
    assert.equal(thread.rows[0].updatedAt.toISOString(), "2026-01-05T00:00:00.000Z");
    assert.equal(thread.rows[0].archivedAAt, null);
    assert.equal(thread.rows[0].archivedBAt, null);
    record("concurrent_insert_lock_wait_and_monotonic_thread_state");
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end(), observer.end()]);
  }
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("cm-invariant-owner");
  await owner.connect();
  try {
    const identity = await owner.query("SELECT current_user, current_database()");
    assert.equal(identity.rows[0].current_user, "ci");
    assert.equal(identity.rows[0].current_database, "grainline_ci");
    await seedFixtures(owner);
    await readCatalog(owner);
    await proveRuntimeWrites(owner);
    await proveConcurrentMonotonicState(owner);
  } finally {
    await cleanFixtures(owner).catch(() => {});
    await owner.end();
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    database: "loopback/grainline_ci",
    currentUser: "ci",
    runtimeRole,
    completedChecks,
    productionChanged: false,
    persistentStagingChanged: false,
  })}\n`);
}

await main();
