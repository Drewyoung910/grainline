import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.NOTIFICATION_RLS_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  userId: "notification-rollback-proof-user",
  relatedUserId: "notification-rollback-proof-related-user",
  retainedId: "notification-rollback-proof-retained-row",
  deletedId: "notification-rollback-proof-deleted-row",
});

function validateTarget(rawUrl) {
  assert.ok(rawUrl, "NOTIFICATION_RLS_PROOF_DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "rollback proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, "/grainline_ci", "rollback proof requires grainline_ci");
}

function newClient(applicationName) {
  return new Client({ connectionString: databaseUrl, application_name: applicationName });
}

async function readCatalog(owner) {
  const result = await owner.query(
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
       pg_catalog.has_column_privilege(
         $1, 'public."Notification"', 'read', 'UPDATE'
       ) AS can_update_read,
       pg_catalog.has_column_privilege(
         $1, 'public."Notification"', 'title', 'UPDATE'
       ) AS can_update_title,
       pg_catalog.has_function_privilege(
         $1,
         'public.grainline_notification_bell(text,integer)',
         'EXECUTE'
       ) AS can_execute_bell,
       pg_catalog.has_function_privilege(
         $1,
         'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
         'EXECUTE'
       ) AS can_execute_core
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Notification'`,
    [runtimeRole],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function restoreActivation(owner) {
  await owner.query("BEGIN");
  try {
    await owner.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended('grainline.notification.rls.activation', 0)
       )`,
    );
    await owner.query('LOCK TABLE public."Notification" IN ACCESS EXCLUSIVE MODE');
    await owner.query(
      `DELETE FROM public."Notification"
        WHERE id = ANY($1::text[])`,
      [[fixture.retainedId, fixture.deletedId]],
    );
    await owner.query(
      'REVOKE ALL ON TABLE public."Notification" FROM PUBLIC, grainline_app_runtime',
    );
    await owner.query('GRANT SELECT ON TABLE public."Notification" TO grainline_app_runtime');
    await owner.query(
      'GRANT UPDATE (read) ON TABLE public."Notification" TO grainline_app_runtime',
    );
    await owner.query('ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY');
    await owner.query('ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY');
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("notification-rollback-proof-owner");
  const runtime = newClient("notification-rollback-proof-runtime");
  await Promise.all([owner.connect(), runtime.connect()]);
  let rollbackCommitted = false;
  let activationRestored = false;

  try {
    assert.deepEqual(await readCatalog(owner), {
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 2,
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_update_read: true,
      can_update_title: false,
      can_execute_bell: true,
      can_execute_core: false,
    });

    await owner.query(
      `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt") VALUES
         ($1, 'clerk_notification_rollback_proof', 'notification-rollback@example.invalid',
          'Rollback Proof', pg_catalog.clock_timestamp()),
         ($2, 'clerk_notification_rollback_related', 'notification-rollback-related@example.invalid',
          'Rollback Related', pg_catalog.clock_timestamp())`,
      [fixture.userId, fixture.relatedUserId],
    );

    await owner.query("BEGIN");
    try {
      await owner.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended('grainline.notification.rls.activation', 0)
         )`,
      );
      await owner.query('LOCK TABLE public."Notification" IN ACCESS EXCLUSIVE MODE');
      await owner.query('ALTER TABLE public."Notification" DISABLE ROW LEVEL SECURITY');
      await owner.query(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Notification" TO grainline_app_runtime',
      );
      await owner.query("COMMIT");
      rollbackCommitted = true;
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }

    assert.deepEqual(await readCatalog(owner), {
      relrowsecurity: false,
      relforcerowsecurity: true,
      policy_count: 2,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_update_read: true,
      can_update_title: true,
      can_execute_bell: true,
      can_execute_core: false,
    });

    await runtime.query(`SET ROLE ${runtimeRole}`);
    const role = await runtime.query("SELECT current_user, session_user");
    assert.deepEqual(role.rows, [{ current_user: runtimeRole, session_user: "ci" }]);
    await runtime.query(
      `INSERT INTO public."Notification" (
         id, "userId", type, title, body, link, "dedupKey", "relatedUserId", read
       ) VALUES
         ($1, $3, 'NEW_MESSAGE', 'Rollback retained row', 'Rollback retained body',
          '/messages/rollback-proof', 'notification-rollback-retained', $4, false),
         ($2, $3, 'NEW_MESSAGE', 'Rollback delete row', 'Rollback delete body',
          '/messages/rollback-proof-delete', 'notification-rollback-delete', $4, false)`,
      [fixture.retainedId, fixture.deletedId, fixture.userId, fixture.relatedUserId],
    );
    await runtime.query(
      `UPDATE public."Notification" SET title = 'Old app rollback update' WHERE id = $1`,
      [fixture.retainedId],
    );
    const directRead = await runtime.query(
      `SELECT id, title FROM public."Notification" WHERE "userId" = $1 ORDER BY id`,
      [fixture.userId],
    );
    assert.deepEqual(directRead.rows, [
      { id: fixture.deletedId, title: "Rollback delete row" },
      { id: fixture.retainedId, title: "Old app rollback update" },
    ]);
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
    assert.equal(bell.rows[0].id, fixture.retainedId);
    assert.equal(bell.rows[0].title, "Old app rollback update");
    assert.equal(Number(bell.rows[0].unreadCount), 1);
    const marked = await runtime.query(
      `SELECT public.grainline_notification_mark_one_read($1, $2) AS count`,
      [fixture.userId, fixture.retainedId],
    );
    assert.equal(Number(marked.rows[0].count), 1);
    await runtime.query("RESET ROLE");

    await restoreActivation(owner);
    activationRestored = true;
    assert.deepEqual(await readCatalog(owner), {
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 2,
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_update_read: true,
      can_update_title: false,
      can_execute_bell: true,
      can_execute_core: false,
    });
    const residue = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE id = ANY($1::text[])`,
      [[fixture.retainedId, fixture.deletedId]],
    );
    assert.equal(residue.rows[0].count, 0);
    await owner.query(
      `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
      [[fixture.userId, fixture.relatedUserId]],
    );
  } finally {
    if (rollbackCommitted && !activationRestored) {
      await restoreActivation(owner).catch(() => {});
    }
    await Promise.allSettled([runtime.end(), owner.end()]);
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    proofMode: "ephemeral-loopback-database-first-rollback",
    status: "passed",
    rollbackPreservedPoliciesAndFunctions: true,
    oldApplicationDirectCrudCompatible: true,
    newApplicationRecipientRpcsCompatible: true,
    exactForceActivationRestored: true,
    activationPurgeReversible: false,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? "Notification rollback proof failed",
    detail: error?.detail ?? null,
  })}\n`);
  process.exitCode = 1;
});
