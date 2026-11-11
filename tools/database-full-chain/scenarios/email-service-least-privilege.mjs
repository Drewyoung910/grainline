import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const EMAIL_SERVICE_LEAST_PRIVILEGE_PREPARATION_MIGRATION =
  "20261101080000_prepare_email_service_least_privilege";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function runtimeQuery(database, sql, params = []) {
  await database.query("SET ROLE grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.query("RESET ROLE");
  }
}

async function runtimeActorQuery(database, actorId, sql, params = []) {
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorId],
    );
    return await database.query(sql, params);
  } finally {
    await database.query("RESET app.user_id");
    await database.query("RESET ROLE");
  }
}

async function claimFanoutJob(database, fixture, {
  suffix,
  sourceType,
  sourceId,
  preferenceKey,
  templateName,
}) {
  const jobId = `${fixture.actorId}_${suffix}`;
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "userId", "preferenceKey", "templateName",
        "templateVersion", "sourceType", "sourceId", subject, html, lane,
        "dedupKey", status, attempts, "claimGeneration", "nextAttemptAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7,
             'Fanout proof', '<p>Fanout proof</p>', 'OPTIONAL', $8,
             'PENDING', 0, 0, '2020-01-01', $9, $9)`,
    [
      jobId,
      fixture.plainEmail,
      fixture.actorId,
      preferenceKey,
      templateName,
      sourceType,
      sourceId,
      `${fixture.actorId}_dedup_${suffix}`,
      fixture.now,
    ],
  );
  const claim = rowsOf(await runtimeQuery(
    database,
    `SELECT * FROM public.grainline_email_outbox_claim_one($1)`,
    [jobId],
  ))[0];
  assert.ok(claim, `expected fanout claim for ${suffix}`);
  return Object.freeze({
    jobId,
    generation: claim.claimGeneration,
    token: claim.claimToken,
  });
}

async function beginFanoutJob(database, claim) {
  return rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_outbox_begin_provider_attempt(
       $1, $2::bigint, $3::uuid
     ) AS result`,
    [claim.jobId, claim.generation, claim.token],
  ))[0]?.result;
}

export async function seedEmailServiceLeastPrivilegePredecessor({ database }) {
  const suffix = `email_boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const fixture = Object.freeze({
    plainEmail: `${suffix}@example.test`,
    pendingEmail: `${suffix}-pending@example.test`,
    suppressedEmail: `${suffix}-suppressed@example.test`,
    oneClickEmail: `${suffix}-one-click@example.test`,
    deletionEmail: `${suffix}-deleted@example.test`,
    transientEmail: `${suffix}-transient@example.test`,
    gmailEmail: `${suffix.replaceAll("_", "")}+grainline@gmail.com`,
    gmailCanonical: `${suffix.replaceAll("_", "")}@gmail.com`,
    actorId: `${suffix}_actor`,
    otherUserId: `${suffix}_other`,
    reclaimedUserId: `${suffix}_reclaimed`,
    sellerUserId: `${suffix}_seller_user`,
    sellerProfileId: `${suffix}_seller`,
    listingId: `${suffix}_listing`,
    broadcastId: `${suffix}_broadcast`,
    staffUserId: `${suffix}_staff`,
    ownedHistoricalEmail: `${suffix}-owned-history@example.test`,
    reusedHistoricalEmail: `${suffix}-reused@example.test`,
    outboxActorId: `${suffix}-outbox-actor`,
    outboxHistoryId: `${suffix}-outbox-history`,
    outboxOtherId: `${suffix}-outbox-other`,
    resendEventId: `svix_${suffix}`,
    deletionSideEffectId: `${suffix}_deletion_side_effect`,
    deletionClaimToken: randomUUID(),
    tokenA: "a".repeat(64),
    tokenB: "b".repeat(64),
    tokenC: "c".repeat(64),
    now: new Date("2026-11-01T18:00:00.000Z"),
  });

  const predecessor = rowsOf(await database.query(`
    SELECT
      pg_catalog.to_regprocedure(
        'public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)'
      ) IS NULL AS "reserveMissing",
      pg_catalog.to_regprocedure(
        'public.grainline_email_unsubscribe_apply(text,jsonb)'
      ) IS NULL AS "unsubscribeMissing"
  `))[0];
  assert.deepEqual(predecessor, {
    reserveMissing: true,
    unsubscribeMissing: true,
  }, "current-main predecessor must lack the fixed email-service authorities");

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Email boundary actor', 'USER', false, $7, $7),
       ($4, $5, $6, 'Email boundary other', 'USER', false, $7, $7),
       ($8, $9, $10, 'Email boundary reclaimed', 'USER', false, $7, $7)`,
    [
      fixture.actorId, `clerk_${fixture.actorId}`, fixture.plainEmail,
      fixture.otherUserId, `clerk_${fixture.otherUserId}`,
      fixture.reusedHistoricalEmail, fixture.now,
      fixture.reclaimedUserId, `clerk_${fixture.reclaimedUserId}`,
      fixture.deletionEmail,
    ],
  );
  await database.query(
    `INSERT INTO public."UserEmailAddress"
       (id, "userId", email, source, "isCurrent", "firstSeenAt", "lastSeenAt", "currentSinceAt")
     VALUES
       ($1, $2, $3, 'proof', false, $7, $7, $7),
       ($4, $2, $5, 'proof', false, $7, $7, $7),
       ($6, $8, $5, 'proof', true, $7, $7, $7)`,
    [
      `${suffix}-owned-history`, fixture.actorId, fixture.ownedHistoricalEmail,
      `${suffix}-reused-history`, fixture.reusedHistoricalEmail,
      `${suffix}-reused-current`, fixture.now, fixture.otherUserId,
    ],
  );
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status, attempts,
        "claimGeneration", "claimToken", "processingStartedAt",
        "createdAt", "updatedAt")
     VALUES ($1, $2, 'LOCAL_ANONYMIZE', $3, '{}'::jsonb, 'PROCESSING', 1,
             1, $4::uuid, $5, $5, $5)`,
    [
      fixture.deletionSideEffectId,
      fixture.actorId,
      `account-delete:local:${fixture.actorId}`,
      fixture.deletionClaimToken,
      fixture.now,
    ],
  );

  await database.query(
    `INSERT INTO public."EmailSuppression"
       (id, email, reason, source, "eventId", details, "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'BOUNCE'::public."EmailSuppressionReason", 'resend', 'evt-boundary', '{}'::jsonb, $7, $7),
       ($3, $4, 'MANUAL'::public."EmailSuppressionReason", 'one_click_unsubscribe', NULL,
        '{"disabledPreferences":["EMAIL_NEW_MESSAGE"]}'::jsonb, $7, $7),
       ($5, $6, 'MANUAL'::public."EmailSuppressionReason", 'account_deletion', NULL,
        '{"accountDeleted":true}'::jsonb, $7, $7)`,
    [
      `${suffix}-bounce`, fixture.suppressedEmail,
      `${suffix}-one-click`, fixture.oneClickEmail,
      `${suffix}-deletion`, fixture.deletionEmail,
      fixture.now,
    ],
  );
  await database.query(
    `INSERT INTO public."NewsletterSubscriber"
       (id, email, name, "subscribedAt", active, "confirmedAt")
     VALUES
       ($1, $2, 'Boundary actor', $7, true, $7),
       ($3, $4, 'Boundary history', $7, true, $7),
       ($5, $6, 'Boundary other', $7, true, $7)`,
    [
      `${suffix}-newsletter-actor`, fixture.plainEmail,
      `${suffix}-newsletter-history`, fixture.ownedHistoricalEmail,
      `${suffix}-newsletter-other`, fixture.reusedHistoricalEmail,
      fixture.now,
    ],
  );
  await database.query(
    `INSERT INTO public."EmailFailureCount"
       (email, count, "firstFailedAt", "lastFailedAt", "lastEventId")
     VALUES
       ($1, 2, $4, $4, 'evt-actor'),
       ($2, 3, $4, $4, 'evt-history'),
       ($3, 4, $4, $4, 'evt-other')`,
    [
      fixture.plainEmail,
      fixture.ownedHistoricalEmail,
      fixture.reusedHistoricalEmail,
      fixture.now,
    ],
  );
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "userId", "preferenceKey", "templateName",
        "templateVersion", subject, html, lane, "dedupKey", status, attempts,
        "claimGeneration", "nextAttemptAt", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'EMAIL_NEW_MESSAGE', 'welcome', 1,
        'Actor email', '<p>Actor</p>', 'OPTIONAL', $4, 'PENDING', 0, 0, $11, $11, $11),
       ($5, $6, NULL, 'EMAIL_NEW_MESSAGE', 'welcome', 1,
        'History email', '<p>History</p>', 'OPTIONAL', $7, 'PENDING', 0, 0, $11, $11, $11),
       ($8, $9, NULL, 'EMAIL_NEW_MESSAGE', 'welcome', 1,
        'Other email', '<p>Other</p>', 'OPTIONAL', $10, 'PENDING', 0, 0, $11, $11, $11)`,
    [
      fixture.outboxActorId, fixture.plainEmail, fixture.actorId,
      `${suffix}-dedup-actor`,
      fixture.outboxHistoryId, fixture.ownedHistoricalEmail,
      `${suffix}-dedup-history`,
      fixture.outboxOtherId, fixture.reusedHistoricalEmail,
      `${suffix}-dedup-other`, fixture.now,
    ],
  );
  return fixture;
}

export async function proveEmailServiceLeastPrivilegeAuthorities({ database, fixture }) {
  const expectedFunctions = [
    "grainline_email_account_deletion_suppression_clear",
    "grainline_email_one_click_suppression_clear",
    "grainline_email_outbox_begin_provider_attempt",
    "grainline_email_outbox_cancel_seller_broadcast",
    "grainline_email_outbox_redact_deleted_seller",
    "grainline_email_outbox_retention_delete_batch",
    "grainline_email_service_account_deletion_apply",
    "grainline_email_service_ops_health",
    "grainline_email_service_owner_export",
    "grainline_email_suppression_exists",
    "grainline_email_unsubscribe_apply",
    "grainline_newsletter_confirm",
    "grainline_newsletter_confirmation_valid",
    "grainline_newsletter_expired_unconfirmed_delete_batch",
    "grainline_newsletter_signup_release",
    "grainline_newsletter_signup_reserve",
    "grainline_newsletter_token_superseded",
    "grainline_resend_webhook_event_complete",
    "grainline_resend_webhook_event_fail",
    "grainline_resend_webhook_event_reserve",
    "grainline_resend_webhook_event_retention_delete_batch",
  ];
  const functionRows = rowsOf(await database.query(`
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
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.proname = ANY($1::text[])
     ORDER BY routine.proname
  `, [expectedFunctions]));
  assert.deepEqual(functionRows.map((row) => row.name), expectedFunctions);
  for (const row of functionRows) {
    assert.equal(row.securityDefiner, true, row.name);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.name);
    assert.equal(row.runtimeExecute, true, row.name);
    assert.equal(row.publicExecute, false, row.name);
  }

  const lookup = async (email, mode) => rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_suppression_exists($1, $2) AS result`,
    [email, mode],
  ))[0]?.result;
  assert.equal(await lookup(fixture.suppressedEmail, "any"), true);
  assert.equal(await lookup(fixture.suppressedEmail, "newsletter"), true);
  assert.equal(await lookup(fixture.suppressedEmail, "delivery"), true);

  const reserveResend = async (claimToken) => rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_reserve(
       $1, 'email.bounced', $2, $3, $4::uuid
     ) AS result`,
    [
      fixture.resendEventId,
      fixture.now,
      new Date(fixture.now.getTime() - 5 * 60 * 1000),
      claimToken,
    ],
  ))[0]?.result;
  const firstResendToken = randomUUID();
  const secondResendToken = randomUUID();
  const firstResendClaim = await reserveResend(firstResendToken);
  assert.deepEqual(firstResendClaim, {
    action: "process",
    claimGeneration: 1,
    claimToken: firstResendToken,
  });
  assert.deepEqual(await reserveResend(secondResendToken), {
    action: "in_progress",
  });
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_fail(
       $1, $2::bigint, $3::uuid, 'temporary proof failure', $4
     ) AS result`,
    [fixture.resendEventId, 1, firstResendToken, fixture.now],
  ))[0]?.result, true);
  const secondResendClaim = await reserveResend(secondResendToken);
  assert.deepEqual(secondResendClaim, {
    action: "process",
    claimGeneration: 2,
    claimToken: secondResendToken,
  });
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_complete(
       $1, $2::bigint, $3::uuid, $4
     ) AS result`,
    [fixture.resendEventId, 1, firstResendToken, fixture.now],
  ))[0]?.result, false, "a stale worker must not complete a newer lease");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_complete(
       $1, $2::bigint, $3::uuid, $4
     ) AS result`,
    [fixture.resendEventId, 2, secondResendToken, fixture.now],
  ))[0]?.result, true);
  assert.deepEqual(await reserveResend(randomUUID()), { action: "processed" });

  await database.query(
    `UPDATE public."User"
        SET "notificationPreferences" =
          pg_catalog.jsonb_build_object('EMAIL_SELLER_BROADCAST', true),
            "updatedAt" = $2
      WHERE id = $1`,
    [fixture.actorId, fixture.now],
  );
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Email boundary seller', 'USER', false, $7, $7),
       ($4, $5, $6, 'Email boundary staff', 'ADMIN', false, $7, $7)`,
    [
      fixture.sellerUserId,
      `clerk_${fixture.sellerUserId}`,
      `${fixture.sellerUserId}@example.test`,
      fixture.staffUserId,
      `clerk_${fixture.staffUserId}`,
      `${fixture.staffUserId}@example.test`,
      fixture.now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "ownerAccountActive", "displayName",
        "displayNameNormalized", "chargesEnabled", "acceptingNewOrders",
        "createdAt", "updatedAt")
     VALUES ($1, $2, true, 'Boundary seller', 'boundary seller', true, true, $3, $3)`,
    [fixture.sellerProfileId, fixture.sellerUserId, fixture.now],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "sellerPubliclyOrderable", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Boundary listing', 'Audience eligibility proof',
             2500, 'usd', 'ACTIVE', true, $3, $3)`,
    [fixture.listingId, fixture.sellerProfileId, fixture.now],
  );
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'Boundary broadcast', $3, 1)`,
    [fixture.broadcastId, fixture.sellerProfileId, fixture.now],
  );
  const ensureFollow = () => database.query(
    `INSERT INTO public."Follow"
       (id, "followerId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("followerId", "sellerProfileId") DO NOTHING`,
    [`${fixture.actorId}_follow`, fixture.actorId, fixture.sellerProfileId, fixture.now],
  );
  await ensureFollow();

  const listingFanout = {
    sourceType: "followed_maker_new_listing",
    sourceId: fixture.listingId,
    preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
    templateName: "followed_maker_new_listing",
  };
  const eligibleClaim = await claimFanoutJob(database, fixture, {
    suffix: "eligible_listing",
    ...listingFanout,
  });
  assert.equal(await beginFanoutJob(database, eligibleClaim), "ready");

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${fixture.actorId}_block_seller`, fixture.actorId, fixture.sellerUserId, fixture.now],
  );
  const blockedByRecipient = await claimFanoutJob(database, fixture, {
    suffix: "blocked_by_recipient",
    ...listingFanout,
  });
  assert.equal(await beginFanoutJob(database, blockedByRecipient), "ineligible");
  await database.query(
    `DELETE FROM public."Block" WHERE id = $1`,
    [`${fixture.actorId}_block_seller`],
  );
  await ensureFollow();

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`${fixture.actorId}_blocked_by_seller`, fixture.sellerUserId, fixture.actorId, fixture.now],
  );
  const blockedBySeller = await claimFanoutJob(database, fixture, {
    suffix: "blocked_by_seller",
    ...listingFanout,
  });
  assert.equal(await beginFanoutJob(database, blockedBySeller), "ineligible");
  await database.query(
    `DELETE FROM public."Block" WHERE id = $1`,
    [`${fixture.actorId}_blocked_by_seller`],
  );
  await ensureFollow();

  await database.query(
    `DELETE FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.actorId, fixture.sellerProfileId],
  );
  const unfollowed = await claimFanoutJob(database, fixture, {
    suffix: "unfollowed",
    ...listingFanout,
  });
  assert.equal(await beginFanoutJob(database, unfollowed), "ineligible");
  await ensureFollow();

  await database.query(
    `UPDATE public."Listing" SET status = 'HIDDEN', "updatedAt" = $2 WHERE id = $1`,
    [fixture.listingId, fixture.now],
  );
  const removedListing = await claimFanoutJob(database, fixture, {
    suffix: "removed_listing",
    ...listingFanout,
  });
  assert.equal(await beginFanoutJob(database, removedListing), "ineligible");
  await database.query(
    `UPDATE public."Listing"
        SET status = 'ACTIVE', "sellerPubliclyOrderable" = true, "updatedAt" = $2
      WHERE id = $1`,
    [fixture.listingId, fixture.now],
  );

  const broadcastFanout = {
    sourceType: "seller_broadcast",
    sourceId: fixture.broadcastId,
    preferenceKey: "EMAIL_SELLER_BROADCAST",
    templateName: "seller_broadcast",
  };
  const eligibleBroadcast = await claimFanoutJob(database, fixture, {
    suffix: "eligible_broadcast",
    ...broadcastFanout,
  });
  assert.equal(await beginFanoutJob(database, eligibleBroadcast), "ready");
  const deletedBroadcast = `${fixture.broadcastId}_deleted`;
  await database.query(
    `INSERT INTO public."SellerBroadcast"
       (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'Deleted source proof', $3, 1)`,
    [deletedBroadcast, fixture.sellerProfileId, fixture.now],
  );
  const deletedBroadcastClaim = await claimFanoutJob(database, fixture, {
    suffix: "deleted_broadcast",
    ...broadcastFanout,
    sourceId: deletedBroadcast,
  });
  await database.query(
    `DELETE FROM public."SellerBroadcast" WHERE id = $1`,
    [deletedBroadcast],
  );
  assert.equal(await beginFanoutJob(database, deletedBroadcastClaim), "ineligible");

  assert.equal(await lookup(fixture.oneClickEmail, "any"), true);
  assert.equal(await lookup(fixture.oneClickEmail, "newsletter"), false);
  assert.equal(await lookup(fixture.oneClickEmail, "delivery"), false);
  assert.equal(await lookup(fixture.transientEmail, "any"), false);
  await assert.rejects(
    runtimeQuery(
      database,
      `SELECT public.grainline_email_suppression_exists($1, 'unsupported')`,
      [fixture.plainEmail],
    ),
    /invalid/u,
  );

  const sentAt = fixture.now;
  const expiresAt = new Date(fixture.now.getTime() + 60 * 60 * 1000);
  const resendCutoff = new Date(fixture.now.getTime() - 15 * 60 * 1000);
  const reserve = async (email, tokenHash) => rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_signup_reserve(
       $1, 'Email boundary proof', $2, $3, $4, $5
     ) AS result`,
    [email, tokenHash, expiresAt, sentAt, resendCutoff],
  ))[0]?.result;
  assert.equal(await reserve(fixture.suppressedEmail, fixture.tokenA), "hidden");
  assert.equal(await reserve(fixture.pendingEmail, fixture.tokenA), "reserved");
  assert.equal(await reserve(fixture.pendingEmail, fixture.tokenB), "hidden");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_confirmation_valid($1, $2) AS result`,
    [fixture.tokenA, fixture.now],
  ))[0]?.result, true);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_signup_release($1, $2)::integer AS result`,
    [fixture.pendingEmail, fixture.tokenB],
  ))[0]?.result, 0);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_signup_release($1, $2)::integer AS result`,
    [fixture.pendingEmail, fixture.tokenA],
  ))[0]?.result, 1);

  assert.equal(await reserve(fixture.gmailEmail, fixture.tokenC), "reserved");
  await database.query(
    `INSERT INTO public."EmailSuppression"
       (id, email, reason, source, "eventId", details, "createdAt", "updatedAt")
     VALUES ($1, $2, 'MANUAL'::public."EmailSuppressionReason",
             'one_click_unsubscribe', NULL, '{}'::jsonb, $3, $3)`,
    [`${fixture.tokenC.slice(0, 20)}-confirm-clear`, fixture.gmailCanonical, fixture.now],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_confirm($1, $2) AS result`,
    [fixture.tokenC, fixture.now],
  ))[0]?.result, true);
  assert.equal(await lookup(fixture.gmailEmail, "any"), false);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_token_superseded($1, $2) AS result`,
    [fixture.gmailCanonical, new Date(fixture.now.getTime() - 1)],
  ))[0]?.result, true);

  const disabledPreferences = [
    "EMAIL_NEW_MESSAGE",
    "EMAIL_CUSTOM_ORDER",
    "EMAIL_VERIFICATION_APPROVED",
    "EMAIL_VERIFICATION_REJECTED",
    "EMAIL_BACK_IN_STOCK",
    "EMAIL_NEW_REVIEW",
    "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
    "EMAIL_SELLER_BROADCAST",
  ];
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_unsubscribe_apply($1, $2::jsonb)::integer AS result`,
    [fixture.gmailEmail, JSON.stringify(disabledPreferences)],
  ))[0]?.result, 1);
  const unsubscribed = rowsOf(await database.query(
    `SELECT active, "confirmationTokenHash", "deactivatedAt"
       FROM public."NewsletterSubscriber" WHERE email = $1`,
    [fixture.gmailEmail],
  ))[0];
  assert.equal(unsubscribed.active, false);
  assert.equal(unsubscribed.confirmationTokenHash, null);
  assert.ok(unsubscribed.deactivatedAt instanceof Date);
  const manualSuppression = rowsOf(await database.query(
    `SELECT reason::text AS reason, source, details
       FROM public."EmailSuppression" WHERE email = $1`,
    [fixture.gmailCanonical],
  ))[0];
  assert.equal(manualSuppression.reason, "MANUAL");
  assert.equal(manualSuppression.source, "one_click_unsubscribe");
  assert.deepEqual(manualSuppression.details.disabledPreferences, disabledPreferences);
  await assert.rejects(
    runtimeQuery(
      database,
      `SELECT public.grainline_email_unsubscribe_apply(
         $1, '["EMAIL_NEW_ORDER"]'::jsonb
       )`,
      [fixture.pendingEmail],
    ),
    /invalid/u,
    "always-on email preferences must not enter unsubscribe suppression metadata",
  );

  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_account_deletion_suppression_clear(
       $1
     )::integer AS result`,
    [fixture.actorId],
  ))[0]?.result, 0, "an unrelated actor must not clear another address");
  assert.equal(await lookup(fixture.deletionEmail, "any"), true);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_account_deletion_suppression_clear(
       $1
     )::integer AS result`,
    [fixture.reclaimedUserId],
  ))[0]?.result, 1);
  assert.equal(await lookup(fixture.deletionEmail, "any"), false);
  assert.equal(await lookup(fixture.suppressedEmail, "delivery"), true);

  const ownerExport = rowsOf(await runtimeActorQuery(
    database,
    fixture.actorId,
    `SELECT public.grainline_email_service_owner_export() AS result`,
  ))[0]?.result;
  assert.ok(ownerExport && typeof ownerExport === "object");
  assert.deepEqual(
    new Set(ownerExport.newsletterSubscriptions.map((row) => row.email)),
    new Set([fixture.plainEmail, fixture.ownedHistoricalEmail]),
    "owner export must include safe history and exclude a reused address",
  );
  assert.deepEqual(
    new Set(ownerExport.emailFailureCounts.map((row) => row.email)),
    new Set([fixture.plainEmail, fixture.ownedHistoricalEmail]),
  );
  assert.deepEqual(
    new Set(ownerExport.emailOutboxRows.map((row) => row.id)),
    new Set([
      fixture.outboxActorId,
      fixture.outboxHistoryId,
      ...[
        "eligible_listing",
        "blocked_by_recipient",
        "blocked_by_seller",
        "unfollowed",
        "removed_listing",
        "eligible_broadcast",
        "deleted_broadcast",
      ].map((suffix) => `${fixture.actorId}_${suffix}`),
    ]),
  );
  for (const collection of [
    ownerExport.emailSuppressions,
    ownerExport.emailOutboxRows,
    ownerExport.emailFailureCounts,
    ownerExport.newsletterSubscriptions,
  ]) {
    for (const row of collection) {
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith("At") && value !== null) {
          assert.match(
            value,
            /Z$/u,
            `email export timestamp ${key} must retain an explicit UTC marker`,
          );
        }
      }
    }
  }

  await assert.rejects(
    runtimeActorQuery(
      database,
      fixture.actorId,
      `SELECT public.grainline_email_service_account_deletion_apply(
         $1, 2, $2::uuid
       ) AS result`,
      [fixture.deletionSideEffectId, fixture.deletionClaimToken],
    ),
    /claim is not authorized/u,
    "a stale account-deletion claim must not mutate email service data",
  );
  const deletionResult = rowsOf(await runtimeActorQuery(
    database,
    fixture.actorId,
    `SELECT public.grainline_email_service_account_deletion_apply(
       $1, 1, $2::uuid
     ) AS result`,
    [fixture.deletionSideEffectId, fixture.deletionClaimToken],
  ))[0]?.result;
  assert.equal(deletionResult.deletedFailureCount, 2);
  assert.equal(deletionResult.deletedNewsletterCount, 2);
  assert.equal(deletionResult.skippedOutboxCount, 4);
  assert.equal(deletionResult.redactedOutboxCount, 9);
  const otherRows = rowsOf(await database.query(
    `SELECT
       (SELECT pg_catalog.count(*)::integer FROM public."NewsletterSubscriber" WHERE email = $1) AS newsletter,
       (SELECT pg_catalog.count(*)::integer FROM public."EmailFailureCount" WHERE email = $1) AS failure,
       (SELECT pg_catalog.count(*)::integer FROM public."EmailOutbox" WHERE id = $2) AS outbox`,
    [fixture.reusedHistoricalEmail, fixture.outboxOtherId],
  ))[0];
  assert.deepEqual(otherRows, { newsletter: 1, failure: 1, outbox: 1 });
  // The older C-715 scenario owns the global post-chain invariant that this
  // retired table is empty. Remove only this proof's preserved foreign row
  // after proving account deletion did not touch it.
  await database.query(
    `DELETE FROM public."EmailFailureCount" WHERE email = $1`,
    [fixture.reusedHistoricalEmail],
  );
  const deletedOutboxRows = rowsOf(await database.query(
    `SELECT status, "recipientEmail", subject, html
       FROM public."EmailOutbox"
      WHERE id IN ($1, $2)
      ORDER BY id`,
    [fixture.outboxActorId, fixture.outboxHistoryId],
  ));
  assert.equal(deletedOutboxRows.length, 2);
  for (const row of deletedOutboxRows) {
    assert.equal(row.status, "SKIPPED");
    assert.equal(row.recipientEmail, "deleted-account@deleted.thegrainline.local");
    assert.equal(row.subject, "Email removed after account deletion");
    assert.equal(row.html, "[Email removed after account deletion]");
  }

  const expiredNewsletterId = `${fixture.actorId}_expired_newsletter`;
  const confirmedNewsletterId = `${fixture.actorId}_confirmed_newsletter`;
  const activeNewsletterId = `${fixture.actorId}_active_newsletter`;
  await database.query(
    `INSERT INTO public."NewsletterSubscriber"
       (id, email, "subscribedAt", active, "confirmedAt",
        "confirmationTokenHash", "confirmationExpiresAt", "confirmationSentAt")
     VALUES
       ($1, $2, '2026-08-01', false, NULL, $7, '2026-08-02', '2026-08-01'),
       ($3, $4, '2026-08-01', false, '2026-08-01', NULL, '2026-08-02', '2026-08-01'),
       ($5, $6, '2026-08-01', true, '2026-08-01', NULL, '2026-08-02', '2026-08-01')`,
    [
      expiredNewsletterId,
      `${fixture.actorId}-expired-newsletter@example.test`,
      confirmedNewsletterId,
      `${fixture.actorId}-confirmed-newsletter@example.test`,
      activeNewsletterId,
      `${fixture.actorId}-active-newsletter@example.test`,
      "d".repeat(64),
    ],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_expired_unconfirmed_delete_batch(
       '2026-10-01', 1
     )::integer AS result`,
  ))[0]?.result, 1);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id FROM public."NewsletterSubscriber"
      WHERE id = ANY($1::text[]) ORDER BY id`,
    [[expiredNewsletterId, confirmedNewsletterId, activeNewsletterId]],
  )).map((row) => row.id), [activeNewsletterId, confirmedNewsletterId].sort());
  const recentExpiredNewsletterId = `${fixture.actorId}_recent_expired_newsletter`;
  await database.query(
    `INSERT INTO public."NewsletterSubscriber"
       (id, email, "subscribedAt", active, "confirmedAt",
        "confirmationTokenHash", "confirmationExpiresAt", "confirmationSentAt")
     VALUES ($1, $2, CURRENT_TIMESTAMP - INTERVAL '2 days', false, NULL,
             $3, CURRENT_TIMESTAMP - INTERVAL '1 day',
             CURRENT_TIMESTAMP - INTERVAL '2 days')`,
    [
      recentExpiredNewsletterId,
      `${fixture.actorId}-recent-expired-newsletter@example.test`,
      "e".repeat(64),
    ],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_newsletter_expired_unconfirmed_delete_batch(
       '2099-01-01', 10
     )::integer AS result`,
  ))[0]?.result, 0, "future input must not weaken newsletter retention");

  const oldResendId = `${fixture.resendEventId}_old`;
  const pendingResendId = `${fixture.resendEventId}_pending`;
  await database.query(
    `INSERT INTO public."ResendWebhookEvent"
       ("svixId", type, "processedAt", "createdAt", "updatedAt")
     VALUES
       ($1, 'email.bounced', '2026-08-01', '2026-08-01', '2026-08-01'),
       ($2, 'email.bounced', NULL, '2026-08-01', '2026-08-01')`,
    [oldResendId, pendingResendId],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_retention_delete_batch(
       '2026-10-01', 1
     )::integer AS result`,
  ))[0]?.result, 1);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "svixId" FROM public."ResendWebhookEvent"
      WHERE "svixId" = ANY($1::text[]) ORDER BY "svixId"`,
    [[oldResendId, pendingResendId]],
  )).map((row) => row.svixId), [pendingResendId]);
  const recentResendId = `${fixture.resendEventId}_recent`;
  await database.query(
    `INSERT INTO public."ResendWebhookEvent"
       ("svixId", type, "processedAt", "createdAt", "updatedAt")
     VALUES ($1, 'email.bounced', CURRENT_TIMESTAMP - INTERVAL '1 day',
             CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
    [recentResendId],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_resend_webhook_event_retention_delete_batch(
       '2099-01-01', 10
     )::integer AS result`,
  ))[0]?.result, 0, "future input must not weaken webhook retention");

  const oldSentId = `${fixture.actorId}_old_sent`;
  const oldDeadId = `${fixture.actorId}_old_dead`;
  const recentSentId = `${fixture.actorId}_recent_sent`;
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "templateName", subject, html, "dedupKey",
        status, attempts, "claimGeneration", "nextAttemptAt", "sentAt",
        "createdAt", "updatedAt")
     VALUES
       ($1, $7, 'welcome', 'Old sent', '<p>Old sent</p>', $2,
        'SENT', 1, 1, NULL, '2026-08-01', '2026-08-01', '2026-08-01'),
       ($3, $7, 'welcome', 'Old dead', '<p>Old dead</p>', $4,
        'DEAD', 10, 10, NULL, NULL, '2026-08-01', '2026-08-01'),
       ($5, $7, 'welcome', 'Recent sent', '<p>Recent sent</p>', $6,
        'SENT', 1, 1, NULL, $8, $8, $8)`,
    [
      oldSentId,
      `${fixture.actorId}_dedup_old_sent`,
      oldDeadId,
      `${fixture.actorId}_dedup_old_dead`,
      recentSentId,
      `${fixture.actorId}_dedup_recent_sent`,
      fixture.plainEmail,
      fixture.now,
    ],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_outbox_retention_delete_batch(
       '2026-10-01', '2026-10-01', 1
     )::integer AS result`,
  ))[0]?.result, 1);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_outbox_retention_delete_batch(
       '2026-10-01', '2026-10-01', 1
     )::integer AS result`,
  ))[0]?.result, 1);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id FROM public."EmailOutbox"
      WHERE id = ANY($1::text[]) ORDER BY id`,
    [[oldSentId, oldDeadId, recentSentId]],
  )).map((row) => row.id), [recentSentId]);
  assert.equal(rowsOf(await runtimeQuery(
    database,
    `SELECT public.grainline_email_outbox_retention_delete_batch(
       '2099-01-01', '2099-01-01', 10
     )::integer AS result`,
  ))[0]?.result, 0, "future input must not weaken outbox retention");

  const readHealth = async () => rowsOf(await runtimeQuery(
    database,
    `SELECT * FROM public.grainline_email_service_ops_health(
       '2026-10-01', '2026-10-01'
     )`,
  ))[0];
  const healthBefore = await readHealth();
  const staleOutboxId = `${fixture.actorId}_health_stale`;
  const deadOutboxId = `${fixture.actorId}_health_dead`;
  const acknowledgedDeadId = `${fixture.actorId}_health_dead_ack`;
  const stalledResendId = `${fixture.resendEventId}_health_stalled`;
  const acknowledgedResendId = `${fixture.resendEventId}_health_ack`;
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "templateName", subject, html, "dedupKey",
        status, attempts, "claimGeneration", "nextAttemptAt", "createdAt", "updatedAt",
        "acknowledgedAt", "acknowledgedById", acknowledgement)
     VALUES
       ($1, $7, 'welcome', 'Stale', '<p>Stale</p>', $2,
        'PENDING', 0, 0, '2026-08-01', '2026-08-01', '2026-08-01', NULL, NULL, NULL),
       ($3, $7, 'welcome', 'Dead', '<p>Dead</p>', $4,
        'DEAD', 10, 10, NULL, '2026-08-01', '2026-08-01', NULL, NULL, NULL),
       ($5, $7, 'welcome', 'Acknowledged', '<p>Acknowledged</p>', $6,
        'DEAD', 10, 10, NULL, '2026-08-01', '2026-08-01', $8, $9, 'reviewed')`,
    [
      staleOutboxId,
      `${fixture.actorId}_dedup_health_stale`,
      deadOutboxId,
      `${fixture.actorId}_dedup_health_dead`,
      acknowledgedDeadId,
      `${fixture.actorId}_dedup_health_dead_ack`,
      fixture.plainEmail,
      fixture.now,
      fixture.staffUserId,
    ],
  );
  await database.query(
    `INSERT INTO public."ResendWebhookEvent"
       ("svixId", type, "lastError", "processedAt", "createdAt", "updatedAt",
        "acknowledgedAt", "acknowledgedById", acknowledgement)
     VALUES
       ($1, 'email.bounced', 'proof failure', NULL, '2026-08-01', '2026-08-01',
        NULL, NULL, NULL),
       ($2, 'email.bounced', 'proof failure', NULL, '2026-08-01', '2026-08-01',
        $3, $4, 'reviewed')`,
    [stalledResendId, acknowledgedResendId, fixture.now, fixture.staffUserId],
  );
  const healthAfter = await readHealth();
  assert.equal(healthAfter.staleEmailCount, healthBefore.staleEmailCount + 1);
  assert.equal(healthAfter.deadEmailCount, healthBefore.deadEmailCount + 1);
  assert.equal(healthAfter.stalledResendCount, healthBefore.stalledResendCount + 1);

  const cancellablePendingId = `${fixture.actorId}_cancel_pending`;
  const cancellableFailedId = `${fixture.actorId}_cancel_failed`;
  const retainedSentId = `${fixture.actorId}_cancel_sent`;
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "preferenceKey", "templateName", "sourceType",
        "sourceId", subject, html, "dedupKey", status, attempts,
        "claimGeneration", "nextAttemptAt", "sentAt", "createdAt", "updatedAt")
     VALUES
       ($1, $7, 'EMAIL_SELLER_BROADCAST', 'seller_broadcast', 'seller_broadcast',
        $8, 'Pending', '<p>Pending</p>', $2, 'PENDING', 0, 0, $9, NULL, $9, $9),
       ($3, $7, 'EMAIL_SELLER_BROADCAST', 'seller_broadcast', 'seller_broadcast',
        $8, 'Failed', '<p>Failed</p>', $4, 'FAILED', 1, 1, $9, NULL, $9, $9),
       ($5, $7, 'EMAIL_SELLER_BROADCAST', 'seller_broadcast', 'seller_broadcast',
        $8, 'Sent', '<p>Sent</p>', $6, 'SENT', 1, 1, NULL, $9, $9, $9)`,
    [
      cancellablePendingId,
      `${fixture.actorId}_dedup_cancel_pending`,
      cancellableFailedId,
      `${fixture.actorId}_dedup_cancel_failed`,
      retainedSentId,
      `${fixture.actorId}_dedup_cancel_sent`,
      fixture.plainEmail,
      fixture.broadcastId,
      fixture.now,
    ],
  );
  await assert.rejects(
    runtimeActorQuery(
      database,
      fixture.actorId,
      `SELECT public.grainline_email_outbox_cancel_seller_broadcast($1)`,
      [fixture.broadcastId],
    ),
    /invalid/u,
  );
  assert.equal(rowsOf(await runtimeActorQuery(
    database,
    fixture.staffUserId,
    `SELECT public.grainline_email_outbox_cancel_seller_broadcast($1)::integer AS result`,
    [fixture.broadcastId],
  ))[0]?.result, 2);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id FROM public."EmailOutbox"
      WHERE id = ANY($1::text[]) ORDER BY id`,
    [[cancellablePendingId, cancellableFailedId, retainedSentId]],
  )).map((row) => row.id), [retainedSentId]);

  const redactedLegacyId = `${fixture.actorId}_seller_redact_legacy`;
  const redactedStructuredId = `${fixture.actorId}_seller_redact_structured`;
  const foreignOutboxId = `${fixture.actorId}_seller_redact_foreign`;
  await database.query(
    `INSERT INTO public."EmailOutbox"
       (id, "recipientEmail", "templateName", "sourceType", "sourceId",
        subject, html, "payloadVersion", payload, "dedupKey", status, attempts,
        "claimGeneration", "nextAttemptAt", "sentAt", "createdAt", "updatedAt")
     VALUES
       ($1, $7, 'followed_maker_new_listing', 'followed_maker_new_listing', $8,
        'Legacy seller mail', '<p>Legacy seller mail</p>', NULL, NULL, $2,
        'PENDING', 0, 0, $9, NULL, $9, $9),
       ($3, $7, 'followed_maker_new_listing', 'followed_maker_new_listing', $8,
        NULL, NULL, 1, '{"listing":"private"}'::jsonb, $4,
        'SENT', 1, 1, NULL, $9, $9, $9),
       ($5, $7, 'welcome', NULL, NULL,
        'Foreign mail', '<p>Foreign mail</p>', NULL, NULL, $6,
        'PENDING', 0, 0, $9, NULL, $9, $9)`,
    [
      redactedLegacyId,
      `${fixture.actorId}_dedup_seller_redact_legacy`,
      redactedStructuredId,
      `${fixture.actorId}_dedup_seller_redact_structured`,
      foreignOutboxId,
      `${fixture.actorId}_dedup_seller_redact_foreign`,
      fixture.plainEmail,
      fixture.listingId,
      fixture.now,
    ],
  );
  await assert.rejects(
    runtimeActorQuery(
      database,
      fixture.otherUserId,
      `SELECT public.grainline_email_outbox_redact_deleted_seller($1)`,
      [fixture.sellerProfileId],
    ),
    /invalid/u,
  );
  const expectedStructuredSellerRows = Number(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."EmailOutbox" AS outbox
      WHERE (outbox."sourceType" = 'seller_broadcast'
             AND outbox."sourceId" = $1)
         OR (outbox."sourceType" = 'followed_maker_new_listing'
             AND outbox."sourceId" = $2)`,
    [fixture.broadcastId, fixture.listingId],
  ))[0]?.count);
  assert.equal(rowsOf(await runtimeActorQuery(
    database,
    fixture.sellerUserId,
    `SELECT public.grainline_email_outbox_redact_deleted_seller($1)::integer AS result`,
    [fixture.sellerProfileId],
  ))[0]?.result, expectedStructuredSellerRows);
  const sellerRedactionRows = rowsOf(await database.query(
    `SELECT id, status, subject, html, payload
       FROM public."EmailOutbox"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [[redactedLegacyId, redactedStructuredId, foreignOutboxId]],
  ));
  assert.deepEqual(sellerRedactionRows, [
    {
      id: foreignOutboxId,
      status: "PENDING",
      subject: "Foreign mail",
      html: "<p>Foreign mail</p>",
      payload: null,
    },
    {
      id: redactedLegacyId,
      status: "SKIPPED",
      subject: "Email removed after maker deletion",
      html: "[Email removed after maker deletion]",
      payload: null,
    },
    {
      id: redactedStructuredId,
      status: "SENT",
      subject: null,
      html: null,
      payload: {},
    },
  ].sort((left, right) => left.id.localeCompare(right.id)));
  await database.query(
    `DELETE FROM public."EmailOutbox"
      WHERE ("sourceType" = 'seller_broadcast' AND "sourceId" = $1)
         OR ("sourceType" = 'followed_maker_new_listing' AND "sourceId" = $2)
         OR id = ANY($3::text[])`,
    [
      fixture.broadcastId,
      fixture.listingId,
      [
        recentSentId,
        staleOutboxId,
        deadOutboxId,
        acknowledgedDeadId,
        foreignOutboxId,
      ],
    ],
  );
  await database.query(
    `DELETE FROM public."ResendWebhookEvent"
      WHERE "svixId" = ANY($1::text[])`,
    [[pendingResendId, recentResendId, stalledResendId, acknowledgedResendId]],
  );
  await database.query(
    `DELETE FROM public."NewsletterSubscriber"
      WHERE id = ANY($1::text[])`,
    [[confirmedNewsletterId, activeNewsletterId, recentExpiredNewsletterId]],
  );
  await database.query(
    `DELETE FROM public."Follow"
      WHERE "followerId" = $1 AND "sellerProfileId" = $2`,
    [fixture.actorId, fixture.sellerProfileId],
  );
  await database.query(
    `DELETE FROM public."SellerBroadcast" WHERE "sellerProfileId" = $1`,
    [fixture.sellerProfileId],
  );
  await database.query(
    `DELETE FROM public."Listing" WHERE "sellerId" = $1`,
    [fixture.sellerProfileId],
  );
  await database.query(
    `DELETE FROM public."SellerProfile" WHERE id = $1`,
    [fixture.sellerProfileId],
  );
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[fixture.sellerUserId, fixture.staffUserId, fixture.reclaimedUserId]],
  );

  return Object.freeze({
    functions: functionRows.length,
    newsletterLifecycle: true,
    suppressionModes: true,
    invalidPreferenceRejected: true,
    accountPrivacy: true,
    resendLifecycle: true,
    audienceEligibility: true,
    boundedRetention: true,
    maintenanceIsolation: true,
  });
}
