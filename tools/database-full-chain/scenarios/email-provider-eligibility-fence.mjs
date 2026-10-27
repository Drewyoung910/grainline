import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

const PREFIX = "full_chain_email_eligibility_fence";

function id(suffix) {
  return `${PREFIX}_${suffix}`;
}

function email(suffix) {
  return `${PREFIX}.${suffix}@example.test`;
}

async function connect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(
    "SET statement_timeout = '8s'; SET lock_timeout = '6s'; SET deadlock_timeout = '100ms'",
  );
  return client;
}

async function seedUser(database, suffix, { role = "USER", userEmail = email(suffix) } = {}) {
  const userId = id(`user_${suffix}`);
  const clerkId = id(`clerk_${suffix}`);
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::public."Role", false, now(), now())`,
    [userId, clerkId, userEmail, `Email eligibility ${suffix}`, role],
  );
  return Object.freeze({ userId, clerkId, email: userEmail });
}

async function enqueueAndClaim(database, suffix, fixture, { optional = false } = {}) {
  const jobId = id(`job_${suffix}`);
  const created = await database.query(
    `SELECT *
       FROM public.grainline_email_outbox_enqueue_legacy(
         $1, $2, $3, $4, $5, 1, NULL, NULL,
         'Eligibility fence subject', '<p>Eligibility fence body</p>', $6
       )`,
    [
      jobId,
      fixture.email,
      fixture.userId ?? null,
      optional ? "EMAIL_NEW_MESSAGE" : null,
      optional ? "welcome" : "refund_issued",
      id(`dedup_${suffix}`),
    ],
  );
  assert.deepEqual(created.rows, [{ jobId, created: true, outcome: "ready" }]);
  const claimed = await database.query(
    `SELECT * FROM public.grainline_email_outbox_claim_one($1)`,
    [jobId],
  );
  assert.equal(claimed.rows.length, 1);
  return Object.freeze({
    jobId,
    generation: Number(claimed.rows[0].claimGeneration),
    token: claimed.rows[0].claimToken,
  });
}

async function beginProvider(database, claim) {
  return (await database.query(
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [claim.jobId, claim.generation, claim.token],
  )).rows[0].result;
}

async function waitForAdvisoryLockWait(database, pid, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM pg_catalog.pg_locks
        WHERE pid = $1
          AND locktype = 'advisory'
          AND NOT granted`,
      [pid],
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} never waited for the shared advisory fence`);
}

async function waitForLockWait(database, pid, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await database.query(
      `SELECT activity.wait_event_type AS "waitEventType",
              activity.wait_event AS "waitEvent",
              pg_catalog.count(lock.*) FILTER (
                WHERE lock.locktype = 'advisory' AND lock.granted
              )::integer AS "grantedAdvisoryLocks"
         FROM pg_catalog.pg_stat_activity AS activity
         LEFT JOIN pg_catalog.pg_locks AS lock
           ON lock.pid = activity.pid
        WHERE activity.pid = $1
        GROUP BY activity.wait_event_type, activity.wait_event`,
      [pid],
    );
    const row = result.rows[0];
    if (row?.waitEventType === "Lock") {
      return Object.freeze({
        waitEvent: row.waitEvent,
        grantedAdvisoryLocks: Number(row.grantedAdvisoryLocks ?? 0),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} never reached a database lock wait`);
}

async function seedDeletionSource(database, suffix, fixture) {
  const sideEffectId = id(`deletion_${suffix}`);
  const claimToken = randomUUID();
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status,
       "claimGeneration", "claimToken", "processingStartedAt",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'LOCAL_ANONYMIZE', $3, '{}'::jsonb, 'PROCESSING',
       1, $4::uuid, now(), now(), now()
     )`,
    [
      sideEffectId,
      fixture.userId,
      `account-delete:local:${fixture.userId}`,
      claimToken,
    ],
  );
  return Object.freeze({ sideEffectId, claimGeneration: 1, claimToken });
}

async function startDeletionSnapshot(client, fixture, source) {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  await client.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, true)",
    [fixture.userId],
  );
  const result = await client.query(
    `SELECT "userId", email
       FROM public.grainline_user_account_deletion_snapshot(
         $1, $2::bigint, $3::uuid
       )`,
    [source.sideEffectId, source.claimGeneration, source.claimToken],
  );
  assert.deepEqual(result.rows, [{ userId: fixture.userId, email: fixture.email }]);
  return result.rows[0];
}

async function runDeletionFirstLockOrder({
  database,
  connectionString,
  suffix,
  fixture,
  mutate,
  assertMutation,
}) {
  const source = await seedDeletionSource(database, suffix, fixture);
  const deletionClient = await connect(connectionString);
  const mutationClient = await connect(connectionString);
  let mutationSettled = false;
  let deletionCommitted = false;
  let mutationCommitted = false;
  try {
    const snapshot = await startDeletionSnapshot(
      deletionClient,
      fixture,
      source,
    );

    await mutationClient.query("BEGIN");
    await mutationClient.query("SET LOCAL ROLE grainline_app_runtime");
    await mutationClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [fixture.userId],
    );
    const mutationPid = Number((await mutationClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const mutation = mutate(mutationClient);
    mutation.finally(() => { mutationSettled = true; }).catch(() => {});
    assert.ok(Number.isInteger(mutationPid), `${suffix} mutation PID is required`);
    const wait = await waitForLockWait(database, mutationPid, `${suffix} mutation`);
    assert.equal(mutationSettled, false);

    let deletionError = null;
    try {
      await deletionClient.query(
        `SELECT public.grainline_email_outbox_account_deletion_fence(
           $1, ARRAY[$2]::text[]
         )`,
        [fixture.userId, snapshot.email],
      );
      await deletionClient.query("COMMIT");
      deletionCommitted = true;
    } catch (error) {
      deletionError = error;
      await deletionClient.query("ROLLBACK").catch(() => {});
    }

    let mutationError = null;
    try {
      await mutation;
      await mutationClient.query("COMMIT");
      mutationCommitted = true;
    } catch (error) {
      mutationError = error;
      await mutationClient.query("ROLLBACK").catch(() => {});
    }

    const deadlockError = [deletionError, mutationError]
      .find((error) => error?.code === "40P01");
    assert.equal(
      deadlockError,
      undefined,
      `${suffix} deadlocked when account deletion held the User row first; `
        + `the waiting mutation held ${wait.grantedAdvisoryLocks} advisory locks`,
    );
    if (deletionError) throw deletionError;
    if (mutationError) throw mutationError;
    assert.equal(deletionCommitted, true);
    assert.equal(mutationCommitted, true);
    await assertMutation?.(database);
  } finally {
    if (!mutationCommitted) await mutationClient.query("ROLLBACK").catch(() => {});
    if (!deletionCommitted) await deletionClient.query("ROLLBACK").catch(() => {});
    await mutationClient.end().catch(() => {});
    await deletionClient.end().catch(() => {});
  }
}

async function runMutationFirstLockOrder({
  database,
  connectionString,
  suffix,
  fixture,
  mutate,
  assertMutation,
}) {
  const source = await seedDeletionSource(database, suffix, fixture);
  const deletionClient = await connect(connectionString);
  const mutationClient = await connect(connectionString);
  let deletionSettled = false;
  try {
    await mutationClient.query("BEGIN");
    await mutationClient.query("SET LOCAL ROLE grainline_app_runtime");
    await mutationClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [fixture.userId],
    );
    await mutate(mutationClient);

    await deletionClient.query("BEGIN");
    await deletionClient.query("SET LOCAL ROLE grainline_app_runtime");
    await deletionClient.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [fixture.userId],
    );
    const deletionPid = Number((await deletionClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const deletionSnapshot = deletionClient.query(
      `SELECT "userId", email
         FROM public.grainline_user_account_deletion_snapshot(
           $1, $2::bigint, $3::uuid
         )`,
      [source.sideEffectId, source.claimGeneration, source.claimToken],
    );
    deletionSnapshot.finally(() => { deletionSettled = true; }).catch(() => {});
    assert.ok(Number.isInteger(deletionPid), `${suffix} deletion PID is required`);
    await waitForLockWait(database, deletionPid, `${suffix} deletion snapshot`);
    assert.equal(deletionSettled, false);

    await mutationClient.query("COMMIT");
    const snapshot = (await deletionSnapshot).rows[0];
    await deletionClient.query(
      `SELECT public.grainline_email_outbox_account_deletion_fence(
         $1, ARRAY[$2]::text[]
       )`,
      [fixture.userId, snapshot.email],
    );
    await deletionClient.query("COMMIT");
    await assertMutation?.(database);
  } catch (error) {
    await mutationClient.query("ROLLBACK").catch(() => {});
    await deletionClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await mutationClient.end().catch(() => {});
    await deletionClient.end().catch(() => {});
  }
}

async function proveEligibilityFirst({
  database,
  connectionString,
  suffix,
  fixture,
  optional = false,
  mutate,
}) {
  const claim = await enqueueAndClaim(database, `${suffix}_eligibility_first`, fixture, {
    optional,
  });
  const eligibilityClient = await connect(connectionString);
  const providerClient = await connect(connectionString);
  let providerSettled = false;
  try {
    await eligibilityClient.query("BEGIN");
    await mutate(eligibilityClient);

    const providerPid = Number((await providerClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const providerStart = beginProvider(providerClient, claim);
    providerStart.finally(() => { providerSettled = true; }).catch(() => {});
    await waitForAdvisoryLockWait(database, providerPid, `${suffix} provider start`);
    assert.equal(providerSettled, false);

    await eligibilityClient.query("COMMIT");
    assert.equal(
      await providerStart,
      "ineligible",
      `${suffix} must become visible before a later provider attempt starts`,
    );
  } catch (error) {
    await eligibilityClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await providerClient.end().catch(() => {});
    await eligibilityClient.end().catch(() => {});
  }
}

async function proveProviderFirst({
  database,
  connectionString,
  suffix,
  fixture,
  optional = false,
  mutate,
  assertMutation,
}) {
  const claim = await enqueueAndClaim(database, `${suffix}_provider_first`, fixture, {
    optional,
  });
  const providerClient = await connect(connectionString);
  const eligibilityClient = await connect(connectionString);
  let mutationSettled = false;
  try {
    await providerClient.query("BEGIN");
    assert.equal(await beginProvider(providerClient, claim), "ready");

    const eligibilityPid = Number((await eligibilityClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const mutation = mutate(eligibilityClient);
    mutation.finally(() => { mutationSettled = true; }).catch(() => {});
    await waitForAdvisoryLockWait(database, eligibilityPid, `${suffix} mutation`);
    assert.equal(mutationSettled, false);

    await providerClient.query("COMMIT");
    const mutationResult = await mutation;
    await assertMutation?.(database, mutationResult);
  } catch (error) {
    await providerClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await eligibilityClient.end().catch(() => {});
    await providerClient.end().catch(() => {});
  }
}

async function banMutation(database, suffix) {
  const admin = await seedUser(database, `${suffix}_admin`, { role: "ADMIN" });
  const target = await seedUser(database, suffix);
  const capabilityId = (await database.query(
    `INSERT INTO public."OrderStaffCapability" (
       "actorUserId", "targetUserId", operation, "payloadHash", "expiresAt"
     ) VALUES ($1, $2, 'USER_BAN', NULL, now() + interval '5 minutes')
     RETURNING id`,
    [admin.userId, target.userId],
  )).rows[0].id;
  return Object.freeze({
    fixture: target,
    mutate: (client) => client.query(
      `SELECT * FROM public.grainline_user_staff_ban_apply(
         $1, $2, now()::timestamp, 'Eligibility fence proof'
       )`,
      [capabilityId, target.userId],
    ),
    assertMutation: async (client) => {
      assert.equal((await client.query(
        `SELECT banned FROM public."User" WHERE id = $1`,
        [target.userId],
      )).rows[0].banned, true);
    },
  });
}

async function identityMutation(database, suffix) {
  const target = await seedUser(database, suffix);
  const nextEmail = email(`${suffix}_next`);
  return Object.freeze({
    fixture: target,
    mutate: (client) => client.query(
      `SELECT * FROM public.grainline_user_clerk_identity_ensure(
         $1, $2, $3, true, NULL, false, NULL, false
       )`,
      [id(`unused_${suffix}`), target.clerkId, nextEmail],
    ),
    assertMutation: async (client) => {
      assert.equal((await client.query(
        `SELECT email FROM public."User" WHERE id = $1`,
        [target.userId],
      )).rows[0].email, nextEmail);
    },
  });
}

async function preferenceMutation(database, suffix) {
  const target = await seedUser(database, suffix);
  await database.query(
    `UPDATE public."User"
        SET "notificationPreferences" = '{"EMAIL_NEW_MESSAGE":true}'::jsonb
      WHERE id = $1`,
    [target.userId],
  );
  return Object.freeze({
    fixture: target,
    mutate: (client) => client.query(
      `SELECT public.grainline_user_owner_notification_preference_update(
         $1, 'EMAIL_NEW_MESSAGE', false
       ) AS updated`,
      [target.userId],
    ),
    assertMutation: async (client) => {
      assert.equal((await client.query(
        `SELECT "notificationPreferences" ->> 'EMAIL_NEW_MESSAGE' AS value
           FROM public."User" WHERE id = $1`,
        [target.userId],
      )).rows[0].value, "false");
    },
  });
}

async function unsubscribeMutation(database, suffix) {
  const target = await seedUser(database, suffix);
  await database.query(
    `UPDATE public."User"
        SET "notificationPreferences" = '{"EMAIL_NEW_MESSAGE":true}'::jsonb
      WHERE id = $1`,
    [target.userId],
  );
  return Object.freeze({
    fixture: target,
    mutate: (client) => client.query(
      `SELECT public.grainline_user_unsubscribe_preferences_disable(
         ARRAY[$1]::text[]
       ) AS updated`,
      [target.email],
    ),
    assertMutation: async (client) => {
      assert.equal((await client.query(
        `SELECT "notificationPreferences" ->> 'EMAIL_NEW_MESSAGE' AS value
           FROM public."User" WHERE id = $1`,
        [target.userId],
      )).rows[0].value, "false");
    },
  });
}

async function hardSuppressionMutation(database, suffix) {
  const target = Object.freeze({ userId: null, email: email(suffix) });
  const suppressionId = id(`suppression_${suffix}`);
  await database.query(
    `INSERT INTO public."NewsletterSubscriber"
       (id, email, active, "confirmedAt", "subscribedAt")
     VALUES ($1, $2, true, now(), now())`,
    [id(`subscriber_${suffix}`), target.email],
  );
  return Object.freeze({
    fixture: target,
    mutate: (client) => client.query(
      `SELECT * FROM public.grainline_email_hard_suppression_apply(
         $1, $2, 'BOUNCE'::public."EmailSuppressionReason",
         'resend', $3, '{"source":"eligibility_fence_proof"}'::jsonb
       )`,
      [suppressionId, target.email, id(`event_${suffix}`)],
    ),
    assertMutation: async (client) => {
      assert.deepEqual((await client.query(
        `SELECT suppression.reason::text AS reason, suppression.source,
                subscriber.active
           FROM public."EmailSuppression" AS suppression
           JOIN public."NewsletterSubscriber" AS subscriber
             ON subscriber.email = suppression.email
          WHERE suppression.email = $1`,
        [target.email],
      )).rows, [{ reason: "BOUNCE", source: "resend", active: false }]);
    },
  });
}

const MUTATIONS = Object.freeze([
  ["ban", banMutation, false],
  ["identity", identityMutation, false],
  ["preference", preferenceMutation, true],
  ["unsubscribe", unsubscribeMutation, true],
  ["hard_suppression", hardSuppressionMutation, false],
]);

const USER_ROW_MUTATIONS = Object.freeze(
  MUTATIONS.filter(([name]) => name !== "hard_suppression"),
);

export async function proveEmailEligibilityAccountDeletionLockOrder({
  database,
  connectionString,
  scenarioNamespace = "full_chain",
}) {
  for (const [name, factory] of USER_ROW_MUTATIONS) {
    const deletionFirst = await factory(
      database,
      `${scenarioNamespace}_${name}_deletion_first`,
    );
    await runDeletionFirstLockOrder({
      database,
      connectionString,
      suffix: `${scenarioNamespace}_${name}_deletion_first`,
      ...deletionFirst,
    });

    const mutationFirst = await factory(
      database,
      `${scenarioNamespace}_${name}_mutation_first`,
    );
    await runMutationFirstLockOrder({
      database,
      connectionString,
      suffix: `${scenarioNamespace}_${name}_mutation_first`,
      ...mutationFirst,
    });
  }

  return Object.freeze({
    ban: true,
    currentEmailChange: true,
    optionalPreferenceDisable: true,
    signedUnsubscribe: true,
    deletionFirst: true,
    mutationFirst: true,
  });
}

async function proveHardSuppressionSemantics(database) {
  const canonicalEmail = `${PREFIX}.provider.precedence@gmail.com`;
  const aliasEmail = `${PREFIX}.provider.precedence+newsletter@googlemail.com`;
  const directEventId = id("direct_suppression_event");
  await database.query(
    `INSERT INTO public."EmailSuppression" (
       id, email, reason, source, "eventId", details, "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 'COMPLAINT', 'resend', $3,
       '{"source":"direct_complaint"}'::jsonb, now(), now()
     )`,
    [id("direct_suppression"), canonicalEmail, directEventId],
  );
  await database.query(
    `INSERT INTO public."NewsletterSubscriber"
       (id, email, active, "confirmedAt", "subscribedAt")
     VALUES ($1, $2, true, now(), now())`,
    [id("provider_precedence_subscriber"), aliasEmail],
  );

  const applied = await database.query(
    `SELECT * FROM public.grainline_email_hard_suppression_apply(
       $1, $2, 'BOUNCE'::public."EmailSuppressionReason",
       'resend_provider_suppressed', $3,
       '{"source":"weaker_provider_evidence"}'::jsonb
     )`,
    [id("weaker_suppression"), canonicalEmail, id("weaker_suppression_event")],
  );
  assert.deepEqual(applied.rows, [{
    email: canonicalEmail,
    reason: "COMPLAINT",
    source: "resend",
    eventId: directEventId,
    details: { source: "direct_complaint" },
  }]);
  assert.deepEqual((await database.query(
    `SELECT active, "confirmationTokenHash", "confirmationExpiresAt",
            "confirmationSentAt", "deactivatedAt" IS NOT NULL AS deactivated
       FROM public."NewsletterSubscriber"
      WHERE email = $1`,
    [aliasEmail],
  )).rows, [{
    active: false,
    confirmationTokenHash: null,
    confirmationExpiresAt: null,
    confirmationSentAt: null,
    deactivated: true,
  }]);
}

export async function proveEmailProviderEligibilityFence({
  database,
  connectionString,
}) {
  for (const [name, factory, optional] of MUTATIONS) {
    const eligibilityFirst = await factory(database, `${name}_eligibility_first`);
    await proveEligibilityFirst({
      database,
      connectionString,
      suffix: name,
      optional,
      ...eligibilityFirst,
    });

    const providerFirst = await factory(database, `${name}_provider_first`);
    await proveProviderFirst({
      database,
      connectionString,
      suffix: name,
      optional,
      ...providerFirst,
    });
  }
  await proveHardSuppressionSemantics(database);
  await proveEmailEligibilityAccountDeletionLockOrder({
    database,
    connectionString,
  });

  return Object.freeze({
    ban: true,
    currentEmailChange: true,
    optionalPreferenceDisable: true,
    signedUnsubscribe: true,
    providerHardSuppression: true,
    eligibilityFirst: true,
    providerFirst: true,
    directSuppressionPrecedence: true,
    gmailNewsletterDeactivation: true,
    accountDeletionLockOrder: true,
  });
}
