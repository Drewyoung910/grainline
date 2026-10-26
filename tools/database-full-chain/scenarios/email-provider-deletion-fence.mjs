import assert from "node:assert/strict";

import pg from "pg";

const PREFIX = "full_chain_email_deletion_fence";

export const EMAIL_PROVIDER_DELETION_FENCE_MIGRATION =
  "20261025020000_fence_email_provider_and_account_deletion";

function id(suffix) {
  return `${PREFIX}_${suffix}`;
}

function email(suffix) {
  return `${PREFIX}.${suffix}@example.test`;
}

async function connect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function seedUser(database, suffix, { gmail = false } = {}) {
  const userId = id(`user_${suffix}`);
  const userEmail = gmail
    ? `${PREFIX.replaceAll("_", "")}.${suffix}@gmail.com`
    : email(suffix);
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'USER', false, now(), now())`,
    [userId, id(`clerk_${suffix}`), userEmail, `Email fence ${suffix}`],
  );
  return Object.freeze({ userId, email: userEmail });
}

export async function seedHistoricalEmailProviderDeletionFenceRows({
  database,
  seller,
}) {
  const recipient = await seedUser(database, "historical_recipient");
  const broadcastId = id("historical_broadcast");
  const listingId = id("historical_listing");
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'Historical fanout source', now(), 1)`,
    [broadcastId, seller.sellerProfileId],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", status,
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'Historical listing source', 'Full-chain source recovery proof',
             1200, 'HIDDEN', now(), now())`,
    [listingId, seller.sellerProfileId],
  );

  const rows = Object.freeze({
    broadcast: id("historical_job_broadcast"),
    followedListing: id("historical_job_followed_listing"),
    approvedListing: id("historical_job_approved_listing"),
    activeListing: id("historical_job_active_listing"),
    unavailable: id("historical_job_unavailable"),
    ambiguous: id("historical_job_ambiguous"),
  });
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "userId", "preferenceKey", "templateName",
        "templateVersion", "sourceType", "sourceId", subject, html, "dedupKey",
        status, attempts, "claimGeneration", "claimToken", "processingStartedAt",
        "firstProviderAttemptAt", "providerAttemptGeneration", "nextAttemptAt",
        "createdAt", "updatedAt")
     VALUES
       ($1, $7, $8, 'EMAIL_SELLER_BROADCAST', 'seller_broadcast', 1,
        NULL, NULL, 'Legacy subject', '<p>Legacy body</p>',
        'seller-broadcast:' || $10 || ':recipient',
        'PENDING', 0, 0, NULL, NULL, NULL, NULL, now(), now(), now()),
       ($2, $7, $8, 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
        'followed_maker_new_listing', 1, NULL, NULL,
        'Legacy subject', '<p>Legacy body</p>',
        'followed-listing:' || $9 || ':recipient',
        'PENDING', 0, 0, NULL, NULL, NULL, NULL, now(), now(), now()),
       ($3, $7, $8, 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
        'followed_maker_new_listing', 1, NULL, NULL,
        'Legacy subject', '<p>Legacy body</p>',
        'admin-approved-listing:' || $9 || ':recipient',
        'PENDING', 0, 0, NULL, NULL, NULL, NULL, now(), now(), now()),
       ($4, $7, $8, 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
        'followed_maker_new_listing', 1, NULL, NULL,
        'Legacy subject', '<p>Legacy body</p>',
        'followed-listing-active:' || $9 || ':recipient:2026-10-25',
        'PENDING', 0, 0, NULL, NULL, NULL, NULL, now(), now(), now()),
       ($5, $7, $8, 'EMAIL_SELLER_BROADCAST', 'seller_broadcast', 1,
        NULL, NULL, 'Legacy subject', '<p>Legacy body</p>',
        'seller-broadcast:missing-safe:recipient',
        'PENDING', 0, 0, NULL, NULL, NULL, NULL, now(), now(), now()),
       ($6, $7, $8, 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
        'followed_maker_new_listing', 1, NULL, NULL,
        'Legacy subject', '<p>Legacy body</p>',
        'followed-listing:missing-ambiguous:recipient',
        'PROCESSING', 1, 1, pg_catalog.gen_random_uuid(), now(), now(), 1,
        NULL, now(), now())`,
    [
      rows.broadcast,
      rows.followedListing,
      rows.approvedListing,
      rows.activeListing,
      rows.unavailable,
      rows.ambiguous,
      recipient.email,
      recipient.userId,
      listingId,
      broadcastId,
    ],
  );
  return Object.freeze({
    ...rows,
    recipient,
    broadcastId,
    listingId,
  });
}

export async function prepareHistoricalEmailProviderDeletionFenceUpgrade({
  database,
  migrationSql,
  historical,
}) {
  await assert.rejects(
    database.executeMigration(migrationSql, {
      migrationName: `${EMAIL_PROVIDER_DELETION_FENCE_MIGRATION}-expected-rejection`,
    }),
    /active ambiguous legacy seller fanout row/u,
    "an active ambiguous legacy provider attempt must block the entire migration",
  );
  await database.resetOwner();

  const rolledBack = (await database.query(
    `SELECT "sourceType", "sourceId"
       FROM public."EmailOutbox"
      WHERE id = $1`,
    [historical.broadcast],
  )).rows[0];
  assert.deepEqual(rolledBack, {
    sourceType: null,
    sourceId: null,
  }, "failed migration must roll back the source correction");
  assert.equal(
    (await database.query(
      `SELECT pg_catalog.to_regprocedure(
         'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)'
       ) AS routine`,
    )).rows[0].routine,
    null,
    "failed migration must not leave the new SECURITY DEFINER entry point behind",
  );

  await database.query(
    `UPDATE public."EmailOutbox"
        SET "firstProviderAttemptAt" = now() - interval '24 hours',
            "updatedAt" = now()
      WHERE id = $1`,
    [historical.ambiguous],
  );
}

async function proveHistoricalSourceReconciliation(database, historical, seller) {
  const rows = (await database.query(
    `SELECT id, status, "sourceType", "sourceId", subject, html,
            "providerAttemptGeneration"
       FROM public."EmailOutbox"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[
      historical.broadcast,
      historical.followedListing,
      historical.approvedListing,
      historical.activeListing,
      historical.unavailable,
      historical.ambiguous,
    ]],
  )).rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.deepEqual(
    {
      sourceType: byId.get(historical.broadcast)?.sourceType,
      sourceId: byId.get(historical.broadcast)?.sourceId,
    },
    { sourceType: "seller_broadcast", sourceId: historical.broadcastId },
  );
  for (const jobId of [
    historical.followedListing,
    historical.approvedListing,
    historical.activeListing,
  ]) {
    assert.deepEqual(
      {
        sourceType: byId.get(jobId)?.sourceType,
        sourceId: byId.get(jobId)?.sourceId,
      },
      { sourceType: "followed_maker_new_listing", sourceId: historical.listingId },
    );
  }
  for (const jobId of [historical.unavailable, historical.ambiguous]) {
    assert.deepEqual(
      {
        status: byId.get(jobId)?.status,
        sourceType: byId.get(jobId)?.sourceType,
        sourceId: byId.get(jobId)?.sourceId,
        subject: byId.get(jobId)?.subject,
        html: byId.get(jobId)?.html,
        providerAttemptGeneration: byId.get(jobId)?.providerAttemptGeneration == null
          ? null
          : Number(byId.get(jobId).providerAttemptGeneration),
      },
      {
        status: "SKIPPED",
        sourceType: null,
        sourceId: null,
        subject: "Email removed because its historical source is unavailable",
        html: "[Email removed because its historical source is unavailable]",
        providerAttemptGeneration: null,
      },
    );
  }

  await database.query("BEGIN");
  let baselineFenceCount;
  try {
    baselineFenceCount = await deletionFence(
      database,
      seller.userId,
      ["historical-source@example.test"],
    );
  } finally {
    await database.query("ROLLBACK");
  }

  await database.query(
    `UPDATE public."EmailOutbox"
        SET status = 'PROCESSING',
            attempts = 1,
            "claimGeneration" = 1,
            "claimToken" = pg_catalog.gen_random_uuid(),
            "processingStartedAt" = now(),
            "firstProviderAttemptAt" = now(),
            "providerAttemptGeneration" = 1,
            "nextAttemptAt" = NULL,
            "updatedAt" = now()
      WHERE id = $1`,
    [historical.broadcast],
  );
  await database.query("BEGIN");
  try {
    assert.equal(
      await deletionFence(database, seller.userId, ["historical-source@example.test"]),
      baselineFenceCount + 1,
      "backfilled legacy fanout must participate in source-owner deletion fencing",
    );
  } finally {
    await database.query("ROLLBACK");
  }
}

async function enqueue(database, {
  suffix,
  recipientEmail,
  userId = null,
  templateName = "welcome",
  preferenceKey = null,
  sourceType = null,
  sourceId = null,
}) {
  const result = await database.query(
    `SELECT *
       FROM public.grainline_email_outbox_enqueue_legacy(
         $1, $2, $3, $4, $5, 1, $6, $7,
         'Email fence subject', '<p>Email fence body</p>', $8
       )`,
    [
      id(`job_${suffix}`),
      recipientEmail,
      userId,
      preferenceKey,
      templateName,
      sourceType,
      sourceId,
      id(`dedup_${suffix}`),
    ],
  );
  assert.deepEqual(result.rows, [{
    jobId: id(`job_${suffix}`),
    created: true,
    outcome: "ready",
  }]);
  return result.rows[0].jobId;
}

async function enqueueResult(database, {
  suffix,
  recipientEmail,
  userId = null,
}) {
  return (await database.query(
    `SELECT *
       FROM public.grainline_email_outbox_enqueue_legacy(
         $1, $2, $3, NULL, 'welcome', 1, NULL, NULL,
         'Email fence subject', '<p>Email fence body</p>', $4
       )`,
    [
      id(`job_${suffix}`),
      recipientEmail,
      userId,
      id(`dedup_${suffix}`),
    ],
  )).rows[0];
}

async function claim(database, jobId) {
  const result = await database.query(
    `SELECT * FROM public.grainline_email_outbox_claim_one($1)`,
    [jobId],
  );
  assert.equal(result.rows.length, 1, `expected a claim for ${jobId}`);
  return Object.freeze({
    generation: Number(result.rows[0].claimGeneration),
    token: result.rows[0].claimToken,
  });
}

async function beginProvider(database, jobId, claimIdentity) {
  return (await database.query(
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [jobId, claimIdentity.generation, claimIdentity.token],
  )).rows[0].result;
}

async function deletionFence(database, userId, emailKeys) {
  await database.query(
    `SELECT pg_catalog.set_config('app.user_id', $1, true)`,
    [userId],
  );
  return Number((await database.query(
    `SELECT public.grainline_email_outbox_account_deletion_fence(
       $1, $2::text[]
     )::integer AS count`,
    [userId, emailKeys],
  )).rows[0].count);
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

async function proveDeletionFirstProviderStart({
  database,
  connectionString,
  fixture,
}) {
  const jobId = await enqueue(database, {
    suffix: "deletion_first_provider",
    recipientEmail: fixture.email,
    userId: fixture.userId,
  });
  const claimIdentity = await claim(database, jobId);
  const deletionClient = await connect(connectionString);
  const providerClient = await connect(connectionString);
  let providerSettled = false;
  try {
    await deletionClient.query("BEGIN");
    await deletionClient.query("SET LOCAL statement_timeout = '8s'");
    assert.equal(
      await deletionFence(deletionClient, fixture.userId, [fixture.email]),
      0,
    );

    const providerPid = Number((await providerClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const providerStart = beginProvider(providerClient, jobId, claimIdentity);
    providerStart.finally(() => { providerSettled = true; }).catch(() => {});
    await waitForAdvisoryLockWait(database, providerPid, "provider start");
    assert.equal(providerSettled, false);

    await deletionClient.query(
      `UPDATE public."EmailOutbox"
          SET status = 'SKIPPED',
              "nextAttemptAt" = NULL,
              "sentAt" = now(),
              "claimToken" = NULL,
              "processingStartedAt" = NULL,
              subject = 'Email removed after account deletion',
              html = '[Email removed after account deletion]',
              "recipientEmail" = 'deleted-account@deleted.thegrainline.local',
              "updatedAt" = now()
        WHERE id = $1`,
      [jobId],
    );
    await deletionClient.query(
      `UPDATE public."User"
          SET "deletedAt" = now(), "updatedAt" = now()
        WHERE id = $1`,
      [fixture.userId],
    );
    await deletionClient.query("COMMIT");

    assert.equal(
      await providerStart,
      "stale_claim",
      "provider start must re-read identity after the deletion fence releases",
    );
    assert.deepEqual((await database.query(
      `SELECT status, subject, "recipientEmail", "providerAttemptGeneration"
         FROM public."EmailOutbox"
        WHERE id = $1`,
      [jobId],
    )).rows, [{
      status: "SKIPPED",
      subject: "Email removed after account deletion",
      recipientEmail: "deleted-account@deleted.thegrainline.local",
      providerAttemptGeneration: null,
    }]);
  } catch (error) {
    await deletionClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await providerClient.end().catch(() => {});
    await deletionClient.end().catch(() => {});
  }
}

async function proveDeletionFirstEnqueue({
  database,
  connectionString,
  fixture,
}) {
  const deletionClient = await connect(connectionString);
  const enqueueClient = await connect(connectionString);
  let enqueueSettled = false;
  const suffix = "deletion_first_enqueue";
  try {
    await deletionClient.query("BEGIN");
    await deletionClient.query("SET LOCAL statement_timeout = '8s'");
    assert.equal(
      await deletionFence(deletionClient, fixture.userId, [fixture.email]),
      0,
    );

    const enqueuePid = Number((await enqueueClient.query(
      "SELECT pg_catalog.pg_backend_pid() AS pid",
    )).rows[0].pid);
    const pendingEnqueue = enqueueResult(enqueueClient, {
      suffix,
      recipientEmail: fixture.email,
      userId: fixture.userId,
    });
    pendingEnqueue.finally(() => { enqueueSettled = true; }).catch(() => {});
    await waitForAdvisoryLockWait(database, enqueuePid, "email enqueue");
    assert.equal(enqueueSettled, false);

    await deletionClient.query(
      `UPDATE public."User"
          SET "deletedAt" = now(), "updatedAt" = now()
        WHERE id = $1`,
      [fixture.userId],
    );
    await deletionClient.query("COMMIT");

    assert.deepEqual(await pendingEnqueue, {
      jobId: null,
      created: false,
      outcome: "deleted",
    });
    assert.deepEqual((await database.query(
      `SELECT id FROM public."EmailOutbox" WHERE id = $1`,
      [id(`job_${suffix}`)],
    )).rows, []);
  } catch (error) {
    await deletionClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await enqueueClient.end().catch(() => {});
    await deletionClient.end().catch(() => {});
  }
}

async function proveProviderMarkers({ database, fixture }) {
  const definitiveJob = await enqueue(database, {
    suffix: "definitive",
    recipientEmail: fixture.email,
    userId: fixture.userId,
  });
  const definitiveClaim = await claim(database, definitiveJob);
  assert.equal(await beginProvider(database, definitiveJob, definitiveClaim), "ready");
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      fixture.userId,
      [fixture.email],
    ), 1, "a committed provider start must temporarily block deletion");
  } finally {
    await database.query("ROLLBACK");
  }
  assert.equal((await database.query(
    `SELECT public.grainline_email_outbox_fail(
       $1, $2::bigint, $3::uuid, 'provider_rejected', 'rejected'
     ) AS result`,
    [definitiveJob, definitiveClaim.generation, definitiveClaim.token],
  )).rows[0].result, "applied");
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      fixture.userId,
      [fixture.email],
    ), 0);
  } finally {
    await database.query("ROLLBACK");
  }

  const retryableJob = await enqueue(database, {
    suffix: "retryable",
    recipientEmail: fixture.email,
    userId: fixture.userId,
  });
  const retryableClaim = await claim(database, retryableJob);
  assert.equal(await beginProvider(database, retryableJob, retryableClaim), "ready");
  assert.equal((await database.query(
    `SELECT public.grainline_email_outbox_fail(
       $1, $2::bigint, $3::uuid, 'provider_retryable', 'timeout'
     ) AS result`,
    [retryableJob, retryableClaim.generation, retryableClaim.token],
  )).rows[0].result, "applied");
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      fixture.userId,
      [fixture.email],
    ), 1);
  } finally {
    await database.query("ROLLBACK");
  }

  await database.query(
    `UPDATE public."EmailOutbox"
        SET "firstProviderAttemptAt" = now() - interval '24 hours'
      WHERE id = $1`,
    [retryableJob],
  );
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      fixture.userId,
      [fixture.email],
    ), 0);
  } finally {
    await database.query("ROLLBACK");
  }
}

async function proveEnqueueFirstDeletion(database, fixture) {
  const jobId = await enqueue(database, {
    suffix: "enqueue_first",
    recipientEmail: fixture.email,
    userId: fixture.userId,
  });
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      fixture.userId,
      [fixture.email],
    ), 0);
    const update = await database.query(
      `UPDATE public."EmailOutbox"
          SET status = 'SKIPPED',
              "nextAttemptAt" = NULL,
              "sentAt" = now(),
              subject = 'Email removed after account deletion',
              html = '[Email removed after account deletion]',
              "recipientEmail" = 'deleted-account@deleted.thegrainline.local',
              "updatedAt" = now()
        WHERE id = $1
          AND status IN ('PENDING','PROCESSING','FAILED','DEAD')
      RETURNING status, subject, "recipientEmail"`,
      [jobId],
    );
    assert.deepEqual(update.rows, [{
      status: "SKIPPED",
      subject: "Email removed after account deletion",
      recipientEmail: "deleted-account@deleted.thegrainline.local",
    }]);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveStaleGenerationCannotStart(database, fixture) {
  const jobId = await enqueue(database, {
    suffix: "stale_generation",
    recipientEmail: fixture.email,
    userId: fixture.userId,
  });
  const staleClaim = await claim(database, jobId);
  await database.query(
    `UPDATE public."EmailOutbox"
        SET "processingStartedAt" = now() - interval '20 minutes'
      WHERE id = $1`,
    [jobId],
  );
  const currentClaim = await claim(database, jobId);
  assert.equal(currentClaim.generation, staleClaim.generation + 1);
  assert.equal(await beginProvider(database, jobId, staleClaim), "stale_claim");
  assert.equal(await beginProvider(database, jobId, currentClaim), "ready");
}

async function proveSourceOwnerAndAnonymousAlias({
  database,
  seller,
}) {
  const recipient = await seedUser(database, "source_recipient");
  const broadcastId = id("broadcast");
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'Email deletion fence source proof', now(), 1)`,
    [broadcastId, seller.sellerProfileId],
  );
  const sourceJob = await enqueue(database, {
    suffix: "source_owner",
    recipientEmail: recipient.email,
    userId: recipient.userId,
    templateName: "seller_broadcast",
    sourceType: "seller_broadcast",
    sourceId: broadcastId,
  });
  const sourceClaim = await claim(database, sourceJob);
  assert.equal(await beginProvider(database, sourceJob, sourceClaim), "ready");
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      seller.userId,
      ["source-owner@example.test"],
    ), 1, "source-owner deletion must see an in-flight fanout email");
  } finally {
    await database.query("ROLLBACK");
  }

  const gmailOwner = await seedUser(database, "gmailowner", { gmail: true });
  const alias = `${PREFIX.replaceAll("_", "")}.gmail.owner+deletion@googlemail.com`;
  const anonymousJob = await enqueue(database, {
    suffix: "anonymous_alias",
    recipientEmail: alias,
  });
  const anonymousClaim = await claim(database, anonymousJob);
  assert.equal(await beginProvider(database, anonymousJob, anonymousClaim), "ready");
  const key = (await database.query(
    `SELECT public.grainline_account_deletion_email_key_core($1) AS key`,
    [gmailOwner.email],
  )).rows[0].key;
  await database.query("BEGIN");
  try {
    assert.equal(await deletionFence(
      database,
      gmailOwner.userId,
      [key],
    ), 1, "canonical fallback email must see an anonymous provider attempt");
  } finally {
    await database.query("ROLLBACK");
  }
}

export async function proveEmailProviderDeletionFence({
  database,
  connectionString,
  seller,
  historical,
}) {
  const functionState = (await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       'public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)'::regprocedure,
       'public.grainline_email_outbox_account_deletion_fence(text,text[])'::regprocedure
     )
     ORDER BY routine.proname
  `)).rows;
  assert.deepEqual(functionState, [
    {
      name: "grainline_email_outbox_account_deletion_fence",
      securityDefiner: true,
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_email_outbox_enqueue_legacy",
      securityDefiner: true,
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT public.grainline_email_outbox_account_deletion_fence(
           'forged-user', ARRAY['forged@example.test']::text[]
         )`,
      ),
      /unauthorized/u,
      "runtime cannot invoke the deletion fence without matching actor context",
    );
    const runtimeEnqueue = await enqueueResult(database, {
      suffix: "runtime_grant",
      recipientEmail: email("runtime_grant"),
    });
    assert.deepEqual(runtimeEnqueue, {
      jobId: id("job_runtime_grant"),
      created: true,
      outcome: "ready",
    });
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_email_outbox_enqueue_legacy(
           $1, $2, NULL, NULL, 'welcome', 1, 'unreviewed_source', 'forged',
           'Email fence subject', '<p>Email fence body</p>', $3
         )`,
        [
          id("job_unreviewed_source"),
          email("unreviewed_source"),
          id("dedup_unreviewed_source"),
        ],
      ),
      /enqueue input is invalid/u,
      "runtime cannot invent an unreviewed source identity that bypasses deletion fencing",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  const deletionFirstProvider = await seedUser(database, "deletion_first_provider");
  const deletionFirstEnqueue = await seedUser(database, "deletion_first_enqueue");
  const providerMarkers = await seedUser(database, "provider_markers");
  const staleGeneration = await seedUser(database, "stale_generation");
  const enqueueFirst = await seedUser(database, "enqueue_first");

  await proveDeletionFirstProviderStart({
    database,
    connectionString,
    fixture: deletionFirstProvider,
  });
  await proveDeletionFirstEnqueue({
    database,
    connectionString,
    fixture: deletionFirstEnqueue,
  });
  await proveProviderMarkers({ database, fixture: providerMarkers });
  await proveEnqueueFirstDeletion(database, enqueueFirst);
  await proveStaleGenerationCannotStart(database, staleGeneration);
  await proveSourceOwnerAndAnonymousAlias({ database, seller });
  assert.ok(historical, "historical source reconciliation fixture is required");
  await proveHistoricalSourceReconciliation(database, historical, seller);

  return Object.freeze({
    deletionFirstProviderStart: true,
    deletionFirstEnqueue: true,
    enqueueFirstDeletion: true,
    providerFirstDeletionBlock: true,
    definitiveFailureRelease: true,
    retryableFailureRetention: true,
    providerDeadlineRelease: true,
    staleGenerationFence: true,
    sourceOwnerFence: true,
    anonymousCanonicalEmailFence: true,
    historicalSourceReconciliation: true,
    ambiguousLegacyFailClosed: true,
    atomicMigrationRollback: true,
  });
}
