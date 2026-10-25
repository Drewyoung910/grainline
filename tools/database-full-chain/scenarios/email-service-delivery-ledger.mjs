import assert from "node:assert/strict";

const PREFIX = "full_chain_email_delivery";

async function insertLegacyJob(database, {
  id,
  templateName,
  recipientEmail,
  status = "PENDING",
  attempts = 0,
  createdAt = "2026-10-25 00:00:00",
  updatedAt = createdAt,
  nextAttemptAt = "2026-10-25 00:00:00",
  firstProviderAttemptAt = null,
}) {
  await database.query(
    `INSERT INTO public."EmailOutbox" (
       id, "recipientEmail", "templateName", "templateVersion", subject, html,
       "dedupKey", status, attempts, "nextAttemptAt", "firstProviderAttemptAt",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 1, 'subject', '<p>body</p>', $4, $5, $6,
       $7::timestamp, $8::timestamp, $9::timestamp, $10::timestamp
     )`,
    [
      id,
      recipientEmail,
      templateName,
      `dedup-${id}`,
      status,
      attempts,
      nextAttemptAt,
      firstProviderAttemptAt,
      createdAt,
      updatedAt,
    ],
  );
}

export async function proveEmailServiceDeliveryLedger({ database }) {
  await database.query("BEGIN");
  try {
    await insertLegacyJob(database, {
      id: `${PREFIX}_optional`,
      templateName: "seller_broadcast",
      recipientEmail: `${PREFIX}_optional@example.test`,
      createdAt: "2026-10-24 20:00:00",
    });
    await insertLegacyJob(database, {
      id: `${PREFIX}_transactional`,
      templateName: "refund_issued",
      recipientEmail: `${PREFIX}_transactional@example.test`,
      createdAt: "2026-10-24 21:00:00",
    });

    const first = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_batch(1)",
    );
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].jobId, `${PREFIX}_transactional`);
    assert.equal(first.rows[0].lane, "TRANSACTIONAL");
    assert.equal(Number(first.rows[0].claimGeneration), 1);
    assert.match(first.rows[0].claimToken, /^[a-f0-9-]{36}$/u);

    await database.query(
      `UPDATE public."EmailOutbox"
          SET "processingStartedAt" = now() - interval '20 minutes'
        WHERE id = $1`,
      [`${PREFIX}_transactional`],
    );
    const reclaimed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_transactional`],
    );
    assert.equal(Number(reclaimed.rows[0].claimGeneration), 2);
    assert.notEqual(reclaimed.rows[0].claimToken, first.rows[0].claimToken);

    const stale = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      [`${PREFIX}_transactional`, 1, first.rows[0].claimToken, "provider-old"],
    );
    assert.equal(stale.rows[0].result, "stale_claim");
    const providerReady = await database.query(
      "SELECT public.grainline_email_outbox_begin_provider_attempt($1,$2,$3::uuid) AS result",
      [`${PREFIX}_transactional`, 2, reclaimed.rows[0].claimToken],
    );
    assert.equal(providerReady.rows[0].result, "ready");
    const complete = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      [`${PREFIX}_transactional`, 2, reclaimed.rows[0].claimToken, "provider-current"],
    );
    assert.equal(complete.rows[0].result, "applied");

    await insertLegacyJob(database, {
      id: `${PREFIX}_attempt_cap`,
      templateName: "welcome",
      recipientEmail: `${PREFIX}_cap@example.test`,
      status: "PROCESSING",
      attempts: 10,
      nextAttemptAt: null,
      updatedAt: "2026-10-24 00:00:00",
    });
    await insertLegacyJob(database, {
      id: `${PREFIX}_expired`,
      templateName: "welcome",
      recipientEmail: `${PREFIX}_expired@example.test`,
      status: "FAILED",
      attempts: 1,
      firstProviderAttemptAt: "2026-10-23 00:00:00",
    });
    const capped = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_batch(10)",
    );
    assert.equal(
      capped.rows.some((row) => row.jobId === `${PREFIX}_attempt_cap`),
      false,
    );
    assert.equal(
      capped.rows.some((row) => row.jobId === `${PREFIX}_expired`),
      false,
    );
    const stopped = await database.query(
      `SELECT id, status, "nextAttemptAt", "claimToken", "lastError"
         FROM public."EmailOutbox"
        WHERE id IN ($1,$2)
        ORDER BY id`,
      [`${PREFIX}_attempt_cap`, `${PREFIX}_expired`],
    );
    assert.equal(stopped.rows.length, 2);
    for (const row of stopped.rows) {
      assert.equal(row.status, "DEAD");
      assert.equal(row.nextAttemptAt, null);
      assert.equal(row.claimToken, null);
      assert.match(row.lastError, /manual review required/iu);
    }

    await insertLegacyJob(database, {
      id: `${PREFIX}_suppressed`,
      templateName: "welcome",
      recipientEmail: `${PREFIX}_suppressed@example.test`,
    });
    await database.query(
      `INSERT INTO public."EmailSuppression" (
         id,email,reason,source,details,"createdAt","updatedAt"
       ) VALUES ($1,$2,'BOUNCE'::public."EmailSuppressionReason",'test','{}',now(),now())`,
      [`${PREFIX}_suppression`, `${PREFIX}_suppressed@example.test`],
    );
    const suppressed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_suppressed`],
    );
    assert.equal(suppressed.rows.length, 0);
    const suppressedState = await database.query(
      'SELECT status,"sentAt","lastError" FROM public."EmailOutbox" WHERE id=$1',
      [`${PREFIX}_suppressed`],
    );
    assert.equal(suppressedState.rows[0].status, "SKIPPED");
    assert.ok(suppressedState.rows[0].sentAt);
    assert.match(suppressedState.rows[0].lastError, /hard-suppressed/iu);

    await insertLegacyJob(database, {
      id: `${PREFIX}_gmail_suppressed`,
      templateName: "welcome",
      recipientEmail: "full.chain.hard+alias@googlemail.com",
    });
    await database.query(
      `INSERT INTO public."EmailSuppression" (
         id,email,reason,source,details,"createdAt","updatedAt"
       ) VALUES ($1,$2,'COMPLAINT'::public."EmailSuppressionReason",'test','{}',now(),now())`,
      [`${PREFIX}_gmail_suppression`, "fullchainhard@gmail.com"],
    );
    const gmailSuppressed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_gmail_suppressed`],
    );
    assert.equal(gmailSuppressed.rows.length, 0);

    await insertLegacyJob(database, {
      id: `${PREFIX}_anonymous`,
      templateName: "welcome",
      recipientEmail: `${PREFIX}_no_account@example.test`,
    });
    const anonymous = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_anonymous`],
    );
    assert.equal(anonymous.rows.length, 1);

    await insertLegacyJob(database, {
      id: `${PREFIX}_defer`,
      templateName: "seller_broadcast",
      recipientEmail: `${PREFIX}_defer@example.test`,
    });
    const deferClaim = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_defer`],
    );
    const prematureComplete = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      [
        `${PREFIX}_defer`,
        deferClaim.rows[0].claimGeneration,
        deferClaim.rows[0].claimToken,
        "provider-before-begin",
      ],
    );
    assert.equal(prematureComplete.rows[0].result, "stale_claim");
    const deferred = await database.query(
      "SELECT public.grainline_email_outbox_defer($1,$2,$3::uuid,$4) AS result",
      [
        `${PREFIX}_defer`,
        deferClaim.rows[0].claimGeneration,
        deferClaim.rows[0].claimToken,
        "recipient_optional_quota",
      ],
    );
    assert.equal(deferred.rows[0].result, "applied");
    const deferredState = await database.query(
      `SELECT status, attempts, "claimToken", "processingStartedAt", "firstProviderAttemptAt"
         FROM public."EmailOutbox"
        WHERE id = $1`,
      [`${PREFIX}_defer`],
    );
    assert.deepEqual(deferredState.rows[0], {
      status: "PENDING",
      attempts: 0,
      claimToken: null,
      processingStartedAt: null,
      firstProviderAttemptAt: null,
    });

    await insertLegacyJob(database, {
      id: `${PREFIX}_transactional_global_defer`,
      templateName: "refund_issued",
      recipientEmail: `${PREFIX}_transactional_global_defer@example.test`,
    });
    const transactionalGlobalClaim = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [`${PREFIX}_transactional_global_defer`],
    );
    const transactionalGlobalDeferred = await database.query(
      "SELECT public.grainline_email_outbox_defer($1,$2,$3::uuid,$4) AS result",
      [
        `${PREFIX}_transactional_global_defer`,
        transactionalGlobalClaim.rows[0].claimGeneration,
        transactionalGlobalClaim.rows[0].claimToken,
        "transactional_global_quota",
      ],
    );
    assert.equal(transactionalGlobalDeferred.rows[0].result, "applied");

    const constraintState = await database.query(`
      SELECT conname, convalidated
        FROM pg_catalog.pg_constraint
       WHERE conrelid IN (
         'public."EmailOutbox"'::regclass,
         'public."ResendWebhookEvent"'::regclass
       )
         AND conname IN (
           'EmailOutbox_claimGeneration_chk',
           'EmailOutbox_attempts_nonnegative_chk',
           'EmailOutbox_representation_chk',
           'EmailOutbox_source_pair_chk',
           'ResendWebhookEvent_claimGeneration_chk',
           'ResendWebhookEvent_attempts_nonnegative_chk'
         )
       ORDER BY conname
    `);
    assert.equal(constraintState.rows.length, 6);
    assert.equal(constraintState.rows.every((row) => row.convalidated), true);

    return Object.freeze({
      priority: true,
      staleClaimFence: true,
      attemptCeiling: true,
      providerDeadline: true,
      suppressionBeforeBody: true,
      canonicalSuppression: true,
      anonymousRecipient: true,
      providerAttemptOrdering: true,
      constraintsValidated: true,
    });
  } finally {
    await database.query("ROLLBACK");
  }
}
