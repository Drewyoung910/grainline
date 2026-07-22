import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.NOTIFICATION_RLS_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  sellerUserId: "notification-proof-seller-user",
  actorUserId: "notification-proof-actor-user",
  foreignUserId: "notification-proof-foreign-user",
  sellerProfileId: "notification-proof-seller-profile",
  followId: "notification-proof-follow",
  ownUnreadId: "notification-proof-own-unread",
  ownReadId: "notification-proof-own-read",
  foreignUnreadId: "notification-proof-foreign-unread",
});

const recipientFunctions = new Set([
  "grainline_notification_unread_count",
  "grainline_notification_bell",
  "grainline_notification_page",
  "grainline_notification_mark_one_read",
  "grainline_notification_mark_many_read",
  "grainline_notification_mark_conversation_read",
  "grainline_notification_export",
  "grainline_notification_recent_low_stock",
]);

const serviceFunctions = new Set([
  "grainline_notification_create_core",
  "grainline_notification_create_source_fanout",
  "grainline_notification_create_social_event",
  "grainline_notification_create_message_event",
  "grainline_notification_create_case_event",
  "grainline_notification_create_commission_event",
  "grainline_notification_create_inventory_event",
  "grainline_notification_create_verification_event",
  "grainline_notification_create_moderation_event",
  "grainline_notification_create_account_warning",
  "grainline_notification_create_order_event",
  "grainline_notification_claim_back_in_stock",
  "grainline_notification_delete_for_account",
  "grainline_notification_delete_blog_comment",
  "grainline_notification_delete_seller_broadcast",
  "grainline_notification_prune_read_batch",
  "grainline_notification_prune_unread_batch",
]);

const runtimeServiceFunctions = new Set(
  [...serviceFunctions].filter((name) => name !== "grainline_notification_create_core"),
);

const completedChecks = [];

function record(check) {
  completedChecks.push(check);
}

function validateTarget(rawUrl) {
  assert.ok(rawUrl, "NOTIFICATION_RLS_PROOF_DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1",
    "ephemeral proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, "/grainline_ci", "ephemeral proof requires the grainline_ci database");
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

async function setRuntimeRole(client) {
  await client.query(`SET ROLE ${runtimeRole}`);
  const role = await client.query("SELECT current_user, session_user");
  assert.equal(role.rows[0].current_user, runtimeRole);
  assert.equal(role.rows[0].session_user, "ci");
}

async function cleanFixtures(owner) {
  const userIds = [fixture.sellerUserId, fixture.actorUserId, fixture.foreignUserId];
  await owner.query('DELETE FROM public."Block" WHERE "blockerId" = ANY($1::text[]) OR "blockedId" = ANY($1::text[])', [userIds]);
  await owner.query('DELETE FROM public."Notification" WHERE "userId" = ANY($1::text[]) OR "relatedUserId" = ANY($1::text[])', [userIds]);
  await owner.query('DELETE FROM public."Follow" WHERE id = $1', [fixture.followId]);
  await owner.query('DELETE FROM public."SellerProfile" WHERE id = $1', [fixture.sellerProfileId]);
  await owner.query('DELETE FROM public."User" WHERE id = ANY($1::text[])', [userIds]);
}

async function seedFixtures(owner) {
  await cleanFixtures(owner);
  await owner.query(
    `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt")
     VALUES
       ($1, 'clerk_notification_proof_seller', 'notification-proof-seller@example.invalid', 'Proof Seller', pg_catalog.clock_timestamp()),
       ($2, 'clerk_notification_proof_actor', 'notification-proof-actor@example.invalid', 'Proof Actor', pg_catalog.clock_timestamp()),
       ($3, 'clerk_notification_proof_foreign', 'notification-proof-foreign@example.invalid', 'Proof Foreign', pg_catalog.clock_timestamp())`,
    [fixture.sellerUserId, fixture.actorUserId, fixture.foreignUserId],
  );
  await owner.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "updatedAt"
     ) VALUES ($1, $2, 'Proof Seller', 'proof seller', pg_catalog.clock_timestamp())`,
    [fixture.sellerProfileId, fixture.sellerUserId],
  );
  await owner.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId") VALUES ($1, $2, $3)`,
    [fixture.followId, fixture.actorUserId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."Notification" (
       id, "userId", type, title, body, link, "sourceType", "sourceId", "dedupKey", read
     ) VALUES
       ($1, $4, 'NEW_MESSAGE', 'Own unread', 'Own unread body', '/messages/proof', 'message', 'proof-message-own', 'proof-own-unread', false),
       ($2, $4, 'LOW_STOCK', 'Own read', 'Own read body', '/listing/proof', 'manual_low_stock', 'proof-stock-own', 'proof-own-read', true),
       ($3, $5, 'NEW_MESSAGE', 'Foreign unread', 'Foreign unread body', '/messages/foreign', 'message', 'proof-message-foreign', 'proof-foreign-unread', false)`,
    [fixture.ownUnreadId, fixture.ownReadId, fixture.foreignUnreadId, fixture.sellerUserId, fixture.foreignUserId],
  );
}

async function proveCatalog(owner) {
  const target = await owner.query(
    `SELECT current_database() AS database_name, current_user,
            runtime.rolsuper, runtime.rolcreatedb, runtime.rolcreaterole,
            runtime.rolreplication, runtime.rolbypassrls, runtime.rolinherit
       FROM pg_catalog.pg_roles AS runtime
      WHERE runtime.rolname = $1`,
    [runtimeRole],
  );
  assert.equal(target.rows.length, 1);
  assert.deepEqual(target.rows[0], {
    database_name: "grainline_ci",
    current_user: "ci",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolinherit: false,
  });

  const table = await owner.query(
    `SELECT cls.relrowsecurity, cls.relforcerowsecurity,
            pg_catalog.pg_get_userbyid(cls.relowner) AS owner_name
       FROM pg_catalog.pg_class AS cls
       JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = 'public' AND cls.relname = 'Notification'`,
  );
  assert.deepEqual(table.rows[0], {
    relrowsecurity: true,
    relforcerowsecurity: false,
    owner_name: "ci",
  });

  const policies = await owner.query(
    `SELECT policyname, cmd, roles, qual, with_check
       FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'Notification'
      ORDER BY policyname`,
  );
  assert.deepEqual(
    policies.rows.map(({ policyname, cmd, roles }) => ({ policyname, cmd, roles })),
    [
      { policyname: "grainline_notification_recipient_select", cmd: "SELECT", roles: [runtimeRole] },
      { policyname: "grainline_notification_recipient_update", cmd: "UPDATE", roles: [runtimeRole] },
    ],
  );
  for (const policy of policies.rows) {
    assert.match(policy.qual, /current_setting\('app\.user_id'::text, true\)/);
    if (policy.cmd === "UPDATE") {
      assert.match(policy.with_check, /current_setting\('app\.user_id'::text, true\)/);
    }
  }

  const grants = await owner.query(
    `SELECT
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'SELECT') AS can_select,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'UPDATE') AS can_update_table,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'TRUNCATE') AS can_truncate,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'read', 'UPDATE') AS can_update_read,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'title', 'UPDATE') AS can_update_title,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'userId', 'UPDATE') AS can_update_user_id`,
    [runtimeRole],
  );
  assert.deepEqual(grants.rows[0], {
    can_select: true,
    can_insert: false,
    can_update_table: false,
    can_delete: false,
    can_truncate: false,
    can_update_read: true,
    can_update_title: false,
    can_update_user_id: false,
  });

  const functions = await owner.query(
    `SELECT proc.proname, proc.prosecdef, proc.proconfig,
            pg_catalog.has_function_privilege($1, proc.oid, 'EXECUTE') AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
                ) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
       FROM pg_catalog.pg_proc AS proc
       JOIN pg_catalog.pg_namespace AS ns ON ns.oid = proc.pronamespace
      WHERE ns.nspname = 'public'
        AND proc.proname LIKE 'grainline_notification_%'
      ORDER BY proc.proname`,
    [runtimeRole],
  );
  const expectedFunctions = new Set([...recipientFunctions, ...serviceFunctions]);
  assert.deepEqual(new Set(functions.rows.map((row) => row.proname)), expectedFunctions);
  for (const fn of functions.rows) {
    assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], `${fn.proname} must pin search_path`);
    assert.equal(fn.public_execute, false, `${fn.proname} must revoke PUBLIC EXECUTE`);
    assert.equal(fn.prosecdef, serviceFunctions.has(fn.proname), `${fn.proname} security mode drifted`);
    assert.equal(
      fn.runtime_execute,
      recipientFunctions.has(fn.proname) || runtimeServiceFunctions.has(fn.proname),
      `${fn.proname} runtime EXECUTE drifted`,
    );
  }
  record("catalog_roles_rls_policies_grants_and_function_acl");
}

async function proveRecipientIsolation(owner) {
  const runtime = newClient("notification-proof-recipient");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);
    const noContext = await runtime.query('SELECT pg_catalog.count(*)::integer AS count FROM public."Notification"');
    assert.equal(noContext.rows[0].count, 0);

    await runtime.query("BEGIN");
    await runtime.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [fixture.sellerUserId]);
    const ownRows = await runtime.query('SELECT id, "userId" FROM public."Notification" ORDER BY id');
    assert.equal(ownRows.rows.length, 2);
    assert.ok(ownRows.rows.every((row) => row.userId === fixture.sellerUserId));
    const updated = await runtime.query(
      'UPDATE public."Notification" SET read = false WHERE id = $1 RETURNING id',
      [fixture.ownReadId],
    );
    assert.equal(updated.rowCount, 1);
    await expectPgError(
      () => runtime.query('UPDATE public."Notification" SET title = $1 WHERE id = $2', ["forbidden", fixture.ownUnreadId]),
      ["42501"],
      "direct title update",
    );
    await runtime.query("ROLLBACK");

    const afterRollback = await runtime.query("SELECT pg_catalog.current_setting('app.user_id', true) AS user_id");
    assert.ok(afterRollback.rows[0].user_id == null || afterRollback.rows[0].user_id === "");

    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Notification" (id, "userId", type, title, body, "dedupKey")
         VALUES ('forbidden-insert', $1, 'NEW_MESSAGE', 'x', 'x', 'forbidden-insert')`,
        [fixture.sellerUserId],
      ),
      ["42501"],
      "direct notification insert",
    );
    await expectPgError(
      () => runtime.query('DELETE FROM public."Notification" WHERE id = $1', [fixture.ownUnreadId]),
      ["42501"],
      "direct notification delete",
    );

    const bell = await runtime.query(
      "SELECT id, \"unreadCount\" FROM public.grainline_notification_bell($1, 20)",
      [fixture.sellerUserId],
    );
    assert.equal(bell.rows.length, 2);
    assert.ok(bell.rows.every((row) => row.id !== fixture.foreignUnreadId));
    assert.equal(Number(bell.rows[0].unreadCount), 1);

    const deniedForeignMark = await runtime.query(
      "SELECT public.grainline_notification_mark_one_read($1, $2) AS count",
      [fixture.sellerUserId, fixture.foreignUnreadId],
    );
    assert.equal(Number(deniedForeignMark.rows[0].count), 0);

    const foreignViaAssertedRecipient = await runtime.query(
      "SELECT public.grainline_notification_unread_count($1) AS count",
      [fixture.foreignUserId],
    );
    assert.equal(Number(foreignViaAssertedRecipient.rows[0].count), 1);
    const afterRpc = await runtime.query("SELECT pg_catalog.current_setting('app.user_id', true) AS user_id");
    assert.ok(afterRpc.rows[0].user_id == null || afterRpc.rows[0].user_id === "");

    record("runtime_direct_no_context_denial");
    record("recipient_own_rows_and_column_only_mark_read");
    record("recipient_rpc_statement_local_context_reset");
    record("recipient_rpc_server_asserted_user_id_residual_recorded");
  } finally {
    await runtime.end();
  }
}

async function invokeFollowNotification(client, notificationId) {
  return client.query(
    `SELECT public.grainline_notification_create_social_event(
       $1, $2, 'NEW_FOLLOWER', 'follow', $3, $4
     ) AS notification_id`,
    [notificationId, fixture.sellerUserId, fixture.sellerProfileId, fixture.actorUserId],
  );
}

async function proveServiceAuthority(owner) {
  const runtime = newClient("notification-proof-service");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);
    await expectPgError(
      () => runtime.query(
        `SELECT public.grainline_notification_create_core(
           $1, $2, 'NEW_FOLLOWER', 'follow', $3, $4
         )`,
        [crypto.randomUUID(), fixture.sellerUserId, fixture.sellerProfileId, fixture.actorUserId],
      ),
      ["42501"],
      "private notification core",
    );
    await expectPgError(
      () => runtime.query(
        `SELECT public.grainline_notification_create_social_event(
           $1, $2, 'NEW_MESSAGE', 'message', 'forbidden-message', $3
         )`,
        [crypto.randomUUID(), fixture.sellerUserId, fixture.actorUserId],
      ),
      ["22023"],
      "wrong source family",
    );

    const first = await invokeFollowNotification(runtime, crypto.randomUUID());
    assert.ok(first.rows[0].notification_id);
    const replay = await invokeFollowNotification(runtime, crypto.randomUUID());
    assert.equal(replay.rows[0].notification_id, first.rows[0].notification_id);
    const stored = await owner.query(
      `SELECT id, title, body, link, "dedupKey", "relatedUserId"
         FROM public."Notification"
        WHERE "sourceType" = 'follow' AND "sourceId" = $1`,
      [fixture.sellerProfileId],
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].id, first.rows[0].notification_id);
    assert.equal(stored.rows[0].link, "/dashboard/analytics");
    assert.equal(stored.rows[0].relatedUserId, fixture.actorUserId);
    assert.equal(stored.rows[0].dedupKey.length, 32);
    record("service_core_private_and_family_source_validation");
    record("service_payload_and_replay_identity_derived_from_source");
  } finally {
    await runtime.end();
  }
}

async function waitForLock(owner, applicationName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await owner.query(
      `SELECT wait_event_type
         FROM pg_catalog.pg_stat_activity
        WHERE datname = pg_catalog.current_database()
          AND application_name = $1
          AND state = 'active'`,
      [applicationName],
    );
    if (waiting.rows.some((row) => row.wait_event_type === "Lock")) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function clearFollowRaceState(owner) {
  await owner.query(
    `DELETE FROM public."Block"
      WHERE ("blockerId" = $1 AND "blockedId" = $2)
         OR ("blockerId" = $2 AND "blockedId" = $1)`,
    [fixture.sellerUserId, fixture.actorUserId],
  );
  await owner.query(
    `DELETE FROM public."Notification"
      WHERE "sourceType" = 'follow' AND "sourceId" = $1`,
    [fixture.sellerProfileId],
  );
}

async function lockUserPairForBlock(client) {
  return client.query(
    `SELECT id FROM public."User"
      WHERE id = ANY($1::text[])
      ORDER BY id
      FOR UPDATE`,
    [[fixture.sellerUserId, fixture.actorUserId]],
  );
}

async function insertBlock(client) {
  return client.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId")
     VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), fixture.sellerUserId, fixture.actorUserId],
  );
}

async function proveBlockRaces(owner) {
  await clearFollowRaceState(owner);
  const createFirst = newClient("notification-proof-create-first");
  const blockSecond = newClient("notification-proof-block-second");
  await Promise.all([createFirst.connect(), blockSecond.connect()]);
  try {
    await Promise.all([setRuntimeRole(createFirst), setRuntimeRole(blockSecond)]);
    await createFirst.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const created = await invokeFollowNotification(createFirst, crypto.randomUUID());
    assert.ok(created.rows[0].notification_id);

    await blockSecond.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const blockLock = lockUserPairForBlock(blockSecond);
    await waitForLock(owner, "notification-proof-block-second");
    await createFirst.query("COMMIT");
    await blockLock;
    await insertBlock(blockSecond);
    await blockSecond.query("COMMIT");

    const firstOrdering = await owner.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer FROM public."Notification" WHERE "sourceType" = 'follow' AND "sourceId" = $1) AS notifications,
         (SELECT pg_catalog.count(*)::integer FROM public."Block" WHERE "blockerId" = $2 AND "blockedId" = $3) AS blocks`,
      [fixture.sellerProfileId, fixture.sellerUserId, fixture.actorUserId],
    );
    assert.deepEqual(firstOrdering.rows[0], { notifications: 1, blocks: 1 });
  } finally {
    await Promise.allSettled([createFirst.query("ROLLBACK"), blockSecond.query("ROLLBACK")]);
    await Promise.all([createFirst.end(), blockSecond.end()]);
  }

  await clearFollowRaceState(owner);
  const blockFirst = newClient("notification-proof-block-first");
  const createSecond = newClient("notification-proof-create-second");
  await Promise.all([blockFirst.connect(), createSecond.connect()]);
  try {
    await Promise.all([setRuntimeRole(blockFirst), setRuntimeRole(createSecond)]);
    await blockFirst.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await lockUserPairForBlock(blockFirst);
    await insertBlock(blockFirst);

    await createSecond.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const createAttempt = invokeFollowNotification(createSecond, crypto.randomUUID());
    await waitForLock(owner, "notification-proof-create-second");
    await blockFirst.query("COMMIT");
    const blocked = await createAttempt;
    assert.equal(blocked.rows[0].notification_id, null);
    await createSecond.query("COMMIT");

    const secondOrdering = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS notifications
         FROM public."Notification"
        WHERE "sourceType" = 'follow' AND "sourceId" = $1`,
      [fixture.sellerProfileId],
    );
    assert.equal(secondOrdering.rows[0].notifications, 0);
  } finally {
    await Promise.allSettled([blockFirst.query("ROLLBACK"), createSecond.query("ROLLBACK")]);
    await Promise.all([blockFirst.end(), createSecond.end()]);
  }
  record("block_race_create_then_block_linearizes_before_block");
  record("block_race_block_then_create_waits_and_suppresses_notification");
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("notification-proof-owner");
  await owner.connect();
  try {
    await proveCatalog(owner);
    await seedFixtures(owner);
    await proveRecipientIsolation(owner);
    await proveServiceAuthority(owner);
    await proveBlockRaces(owner);
    await cleanFixtures(owner);
  } finally {
    await owner.end();
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    proofMode: "ephemeral-loopback-ci-set-role",
    productionChanged: false,
    persistentStagingChanged: false,
    status: "passed",
    checkCount: completedChecks.length,
    checks: completedChecks,
    residualBoundary: "recipient RPC p_user_id must come from server-resolved identity; this proof does not claim resistance to a compromised runtime role",
  }, null, 2)}\n`);
}

main().catch((error) => {
  const safe = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? "notification RLS ephemeral proof failed",
  };
  process.stderr.write(`${JSON.stringify(safe)}\n`);
  process.exitCode = 1;
});
