import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.NOTIFICATION_RLS_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  userId: "notification-preparation-proof-user",
  relatedUserId: "notification-preparation-proof-related-user",
  legacyId: "notification-preparation-proof-legacy-row",
  deletedId: "notification-preparation-proof-deleted-row",
});

function validateTarget(rawUrl) {
  assert.ok(rawUrl, "NOTIFICATION_RLS_PROOF_DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "preparation proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, "/grainline_ci", "preparation proof requires grainline_ci");
}

function newClient(applicationName) {
  return new Client({ connectionString: databaseUrl, application_name: applicationName });
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("notification-preparation-proof-owner");
  const runtime = newClient("notification-preparation-proof-runtime");
  await Promise.all([owner.connect(), runtime.connect()]);
  try {
    const catalog = await owner.query(
      `SELECT
         class.relrowsecurity,
         class.relforcerowsecurity,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = class.oid) AS policy_count,
         pg_catalog.has_table_privilege($1, 'public."Notification"', 'SELECT') AS can_select,
         pg_catalog.has_table_privilege($1, 'public."Notification"', 'INSERT') AS can_insert,
         pg_catalog.has_table_privilege($1, 'public."Notification"', 'UPDATE') AS can_update,
         pg_catalog.has_table_privilege($1, 'public."Notification"', 'DELETE') AS can_delete,
         pg_catalog.has_function_privilege(
           $1,
           'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
           'EXECUTE'
         ) AS can_execute_core,
         pg_catalog.has_function_privilege(
           $1,
           'public.grainline_notification_bell(text,integer)',
           'EXECUTE'
         ) AS can_execute_bell,
         pg_catalog.has_function_privilege(
           $1,
           'public.grainline_notification_create_social_event(text,text,public."NotificationType",text,text,text)',
           'EXECUTE'
         ) AS can_execute_social,
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = class.oid
              AND attribute.attname = 'relatedUserId'
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
         ) AS has_related_user
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = 'Notification'`,
      [runtimeRole],
    );
    assert.deepEqual(catalog.rows, [{
      relrowsecurity: false,
      relforcerowsecurity: false,
      policy_count: 0,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_execute_core: false,
      can_execute_bell: true,
      can_execute_social: true,
      has_related_user: true,
    }]);

    const functionCount = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname LIKE 'grainline_notification_%'
          AND procedure.proname <> 'grainline_notification_preferences_valid'`,
    );
    assert.equal(functionCount.rows[0].count, 25);

    await owner.query(
      `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt") VALUES
         ($1, 'clerk_notification_preparation_proof', 'notification-preparation@example.invalid',
          'Preparation Proof', pg_catalog.clock_timestamp()),
         ($2, 'clerk_notification_preparation_related', 'notification-preparation-related@example.invalid',
          'Preparation Related', pg_catalog.clock_timestamp())`,
      [fixture.userId, fixture.relatedUserId],
    );

    await runtime.query(`SET ROLE ${runtimeRole}`);
    const role = await runtime.query("SELECT current_user, session_user");
    assert.deepEqual(role.rows, [{ current_user: runtimeRole, session_user: "ci" }]);

    await runtime.query(
      `INSERT INTO public."Notification" (
         id, "userId", type, title, body, link, "dedupKey", "relatedUserId", read
       ) VALUES
         ($1, $3, 'NEW_MESSAGE', 'Legacy-compatible row', 'Legacy-compatible body',
          '/messages/preparation-proof', 'notification-preparation-legacy', $4, false),
         ($2, $3, 'NEW_MESSAGE', 'Direct-delete row', 'Direct-delete body',
          '/messages/preparation-proof-delete', 'notification-preparation-delete', $4, false)`,
      [fixture.legacyId, fixture.deletedId, fixture.userId, fixture.relatedUserId],
    );
    const directRead = await runtime.query(
      `SELECT id FROM public."Notification" WHERE "userId" = $1 ORDER BY id`,
      [fixture.userId],
    );
    assert.deepEqual(directRead.rows.map((row) => row.id), [fixture.deletedId, fixture.legacyId]);
    await runtime.query(
      `UPDATE public."Notification" SET title = 'Old app direct update' WHERE id = $1`,
      [fixture.legacyId],
    );
    const directDelete = await runtime.query(
      `DELETE FROM public."Notification" WHERE id = $1 RETURNING id`,
      [fixture.deletedId],
    );
    assert.deepEqual(directDelete.rows, [{ id: fixture.deletedId }]);

    const bell = await runtime.query(
      `SELECT id, title, "unreadCount"
         FROM public.grainline_notification_bell($1, 20)`,
      [fixture.userId],
    );
    assert.equal(bell.rows.length, 1);
    assert.equal(bell.rows[0].id, fixture.legacyId);
    assert.equal(bell.rows[0].title, "Old app direct update");
    assert.equal(Number(bell.rows[0].unreadCount), 1);

    const marked = await runtime.query(
      `SELECT public.grainline_notification_mark_one_read($1, $2) AS count`,
      [fixture.userId, fixture.legacyId],
    );
    assert.equal(Number(marked.rows[0].count), 1);
    const callableService = await runtime.query(
      `SELECT public.grainline_notification_create_social_event(
         $1, $2, 'NEW_FOLLOWER', 'follow', 'missing-profile', $3
       ) AS notification_id`,
      ["00000000-0000-4000-8000-000000000001", fixture.userId, fixture.relatedUserId],
    );
    assert.deepEqual(callableService.rows, [{ notification_id: null }]);

    const retained = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE id = $1`,
      [fixture.legacyId],
    );
    assert.equal(retained.rows[0].count, 1);
  } finally {
    await Promise.allSettled([runtime.end(), owner.end()]);
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    proofMode: "ephemeral-loopback-preparation-compatibility",
    status: "passed",
    oldApplicationDirectCrudCompatible: true,
    newApplicationRecipientAndServiceRpcsCallable: true,
    legacyRowLeftForLockedActivationPurge: true,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? "Notification preparation proof failed",
    detail: error?.detail ?? null,
  })}\n`);
  process.exitCode = 1;
});
