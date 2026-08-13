#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_REPLY_AUTHORITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-reply-authority-proof";
const BODY = "Disposable loopback-only Case-reply authority proof.";

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  openCase: `${PREFIX}-case-open`,
  pendingCase: `${PREFIX}-case-pending`,
  underReviewCase: `${PREFIX}-case-under-review`,
  closedCase: `${PREFIX}-case-closed`,
  attachmentCase: `${PREFIX}-case-attachment`,
  replayCase: `${PREFIX}-case-replay`,
  concurrencyCase: `${PREFIX}-case-concurrency`,
  rollbackCase: `${PREFIX}-case-rollback`,
  validUpload: `${PREFIX}-upload-valid`,
  foreignUpload: `${PREFIX}-upload-foreign`,
  wrongCaseUpload: `${PREFIX}-upload-wrong-case`,
  unverifiedUpload: `${PREFIX}-upload-unverified`,
  rollbackUpload: `${PREFIX}-upload-rollback`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseReplyAuthorityProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case-reply authority proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case-reply authority proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

function createClient(databaseUrl, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

async function runtimeQuery(client, sql, params = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function expectRuntimeError(client, name, params, pattern) {
  let caught;
  try {
    await runtimeQuery(
      client,
      "SELECT public.grainline_case_reply($1, $2, $3, $4) AS result",
      params,
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${name} unexpectedly succeeded`);
  assert.match(safeError(caught), pattern, name);
}

async function reply(
  client,
  actorId,
  caseId,
  body = BODY,
  uploadIds = [],
) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_case_reply($1, $2, $3, $4) AS result",
    [actorId, caseId, body, uploadIds],
  );
  return result.rows[0]?.result;
}

function orderId(caseId) {
  return caseId.replace("-case-", "-order-");
}

function openingMessageId(caseId) {
  return `${caseId}-opening-message`;
}

async function seedUsers(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Case-reply proof buyer', 'USER',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Case-reply proof seller', 'USER',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Case-reply proof foreign', 'USER',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($10, $11, $12, 'Case-reply proof staff', 'EMPLOYEE',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.buyer,
    `clerk-${ids.buyer}`,
    `${ids.buyer}@example.invalid`,
    ids.seller,
    `clerk-${ids.seller}`,
    `${ids.seller}@example.invalid`,
    ids.foreign,
    `clerk-${ids.foreign}`,
    `${ids.foreign}@example.invalid`,
    ids.staff,
    `clerk-${ids.staff}`,
    `${ids.staff}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Case-reply proof seller', 'case-reply proof seller',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sellerProfile, ids.seller]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Case-reply proof listing',
      'Disposable loopback-only Case-reply authority proof.',
      10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.listing, ids.sellerProfile]);
}

async function seedCase(client, caseId, status, {
  buyerMarkedResolved = false,
  sellerMarkedResolved = false,
} = {}) {
  const targetOrderId = orderId(caseId);
  await client.query(`
    INSERT INTO public."Order" (
      id, "buyerId", "stripeChargeId", "itemsSubtotalCents",
      "shippingAmountCents", "taxAmountCents", "paidAt",
      "fulfillmentStatus", "estimatedDeliveryDate"
    )
    VALUES (
      $1, $2, $3, 10000, 0, 0, CURRENT_TIMESTAMP,
      'SHIPPED', CURRENT_TIMESTAMP - INTERVAL '1 day'
    )
  `, [
    targetOrderId,
    ids.buyer,
    `${PREFIX}-charge-${caseId}`,
  ]);
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 10000)
  `, [`${targetOrderId}-item`, targetOrderId, ids.listing]);
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, "sellerRespondBy", "discussionStartedAt",
      "escalateUnlocksAt", "buyerMarkedResolved",
      "sellerMarkedResolved", "resolutionMarkedAt", resolution, "resolvedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, 'OTHER',
      'Disposable loopback-only Case-reply authority proof.',
      $5::public."CaseStatus",
      CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CASE WHEN $5 = 'OPEN' THEN NULL ELSE CURRENT_TIMESTAMP - INTERVAL '1 hour' END,
      CASE WHEN $5 = 'OPEN' THEN NULL ELSE CURRENT_TIMESTAMP + INTERVAL '47 hours' END,
      $6, $7,
      CASE WHEN $5 = 'PENDING_CLOSE' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CASE WHEN $5 IN ('RESOLVED', 'CLOSED')
        THEN 'DISMISSED'::public."CaseResolution"
        ELSE NULL
      END,
      CASE WHEN $5 IN ('RESOLVED', 'CLOSED')
        THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP
    )
  `, [
    caseId,
    targetOrderId,
    ids.buyer,
    ids.seller,
    status,
    buyerMarkedResolved,
    sellerMarkedResolved,
  ]);
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    VALUES (
      $1, $2, $3, 'BUYER',
      'Disposable opening evidence for the Case-reply authority proof.',
      CURRENT_TIMESTAMP
    )
  `, [openingMessageId(caseId), caseId, ids.buyer]);
}

function uploadKey(caseId, suffix) {
  return `caseEvidenceImage/clerk-${ids.buyer}/${caseId}/${suffix}.webp`;
}

async function seedUpload(client, id, {
  caseId = ids.attachmentCase,
  ownerId = ids.buyer,
  status = "VERIFIED",
} = {}) {
  await client.query(`
    INSERT INTO public."DirectUpload" (
      id, key, endpoint, "userId", "publicUrl", "storageClass",
      "contentType", "expectedSize", status, "verifiedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'caseEvidenceImage', $3, NULL, 'PRIVATE',
      'image/webp', 2048, $4::text,
      CASE WHEN $4::text = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [id, uploadKey(caseId, id), ownerId, status]);
}

async function seedFixturesBody(client) {
  await seedUsers(client);
  await seedCase(client, ids.openCase, "OPEN");
  await seedCase(client, ids.pendingCase, "PENDING_CLOSE", {
    buyerMarkedResolved: true,
  });
  await seedCase(client, ids.underReviewCase, "UNDER_REVIEW");
  await seedCase(client, ids.closedCase, "CLOSED");
  await seedCase(client, ids.attachmentCase, "IN_DISCUSSION");
  await seedCase(client, ids.replayCase, "IN_DISCUSSION");
  await seedCase(client, ids.concurrencyCase, "IN_DISCUSSION");
  await seedCase(client, ids.rollbackCase, "IN_DISCUSSION");
  await seedUpload(client, ids.validUpload);
  await seedUpload(client, ids.foreignUpload, { ownerId: ids.foreign });
  await seedUpload(client, ids.wrongCaseUpload, { caseId: ids.replayCase });
  await seedUpload(client, ids.unverifiedUpload, { status: "PRESIGNED" });
  await seedUpload(client, ids.rollbackUpload, { caseId: ids.rollbackCase });
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedFixturesBody(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(`
      DELETE FROM public."CaseMessageAttachment" AS attachment
       USING public."CaseMessage" AS message
       WHERE message.id = attachment."caseMessageId"
         AND message."caseId" LIKE $1
    `, [`${PREFIX}%`]);
    await client.query(
      'DELETE FROM public."DirectUploadReference" WHERE "directUploadId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."DirectUpload" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."OrderItem" WHERE "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Listing" WHERE id = $1',
      [ids.listing],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id = $1',
      [ids.sellerProfile],
    );
    await client.query(
      'DELETE FROM public."User" WHERE id IN ($1, $2, $3, $4)',
      [ids.buyer, ids.seller, ids.foreign, ids.staff],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveActorAndStatusAuthority(observer, runtime) {
  await expectRuntimeError(
    runtime,
    "forged_actor_rejected",
    [ids.foreign, ids.openCase, BODY, []],
    /actor is not authorized/,
  );
  await expectRuntimeError(
    runtime,
    "party_under_review_rejected",
    [ids.buyer, ids.underReviewCase, BODY, []],
    /Case is closed/,
  );
  await expectRuntimeError(
    runtime,
    "closed_case_rejected",
    [ids.staff, ids.closedCase, BODY, []],
    /Case is closed/,
  );

  const staffReply = await reply(runtime, ids.staff, ids.underReviewCase);
  assert.equal(staffReply.action, "created");
  assert.equal(staffReply.authorKind, "STAFF");
  assert.equal(staffReply.actsAsStaff, true);
  assert.equal(staffReply.status, "UNDER_REVIEW");

  await observer.query(
    'UPDATE public."User" SET banned = true WHERE id = $1',
    [ids.seller],
  );
  await expectRuntimeError(
    runtime,
    "suspended_recipient_rejected",
    [ids.buyer, ids.attachmentCase, BODY, []],
    /recipient is suspended/,
  );
  await observer.query(
    'UPDATE public."User" SET banned = false WHERE id = $1',
    [ids.seller],
  );
}

async function proveTransitions(observer, runtime) {
  const sellerReply = await reply(runtime, ids.seller, ids.openCase);
  assert.equal(sellerReply.action, "created");
  assert.equal(sellerReply.authorKind, "SELLER");
  assert.equal(sellerReply.status, "IN_DISCUSSION");
  assert.equal(sellerReply.actsAsStaff, false);

  const openState = await observer.query(`
    SELECT
      status::text,
      "discussionStartedAt" IS NOT NULL AS discussion_started,
      "escalateUnlocksAt" > "discussionStartedAt" AS escalation_after_discussion
      FROM public."Case"
     WHERE id = $1
  `, [ids.openCase]);
  assert.deepEqual(openState.rows[0], {
    status: "IN_DISCUSSION",
    discussion_started: true,
    escalation_after_discussion: true,
  });

  const buyerReply = await reply(runtime, ids.buyer, ids.pendingCase);
  assert.equal(buyerReply.authorKind, "BUYER");
  assert.equal(buyerReply.status, "IN_DISCUSSION");
  const pendingState = await observer.query(`
    SELECT status::text, "buyerMarkedResolved", "sellerMarkedResolved"
      FROM public."Case"
     WHERE id = $1
  `, [ids.pendingCase]);
  assert.deepEqual(pendingState.rows[0], {
    status: "IN_DISCUSSION",
    buyerMarkedResolved: false,
    sellerMarkedResolved: false,
  });
}

async function proveAttachmentAuthority(observer, runtime) {
  for (const [name, uploadId, pattern] of [
    ["foreign_upload_rejected", ids.foreignUpload, /upload authority is invalid/],
    ["wrong_case_upload_rejected", ids.wrongCaseUpload, /upload authority is invalid/],
    ["unverified_upload_rejected", ids.unverifiedUpload, /upload authority is invalid/],
  ]) {
    await expectRuntimeError(
      runtime,
      name,
      [ids.buyer, ids.attachmentCase, BODY, [uploadId]],
      pattern,
    );
  }

  const created = await reply(
    runtime,
    ids.buyer,
    ids.attachmentCase,
    BODY,
    [ids.validUpload],
  );
  assert.equal(created.action, "created");
  assert.equal(created.attachments.length, 1);
  assert.equal(created.attachments[0].contentType, "image/webp");
  assert.equal(created.attachments[0].byteSize, 2048);

  const evidence = await observer.query(`
    SELECT
      attachment."directUploadId" AS upload_id,
      upload.key AS object_key,
      attachment."contentType" AS content_type,
      attachment."byteSize" AS byte_size,
      upload.status,
      upload."claimedByType" AS claimed_by_type,
      reference."sourceType" AS source_type,
      reference."sourceId" AS source_id,
      reference.exclusive
      FROM public."CaseMessageAttachment" AS attachment
      JOIN public."DirectUpload" AS upload
        ON upload.id = attachment."directUploadId"
      JOIN public."DirectUploadReference" AS reference
        ON reference."directUploadId" = upload.id
       AND reference."releasedAt" IS NULL
     WHERE attachment.id = $1
  `, [created.attachments[0].id]);
  assert.deepEqual(evidence.rows[0], {
    upload_id: ids.validUpload,
    object_key: uploadKey(ids.attachmentCase, ids.validUpload),
    content_type: "image/webp",
    byte_size: 2048,
    status: "CLAIMED",
    claimed_by_type: "CASE_MESSAGE_ATTACHMENT",
    source_type: "CASE_MESSAGE_ATTACHMENT",
    source_id: created.attachments[0].id,
    exclusive: true,
  });

  const replayed = await reply(
    runtime,
    ids.buyer,
    ids.attachmentCase,
    BODY,
    [ids.validUpload],
  );
  assert.equal(replayed.action, "replay");
  assert.equal(replayed.messageId, created.messageId);
  assert.deepEqual(replayed.attachments, created.attachments);

  await expectRuntimeError(
    runtime,
    "claimed_upload_changed_body_rejected",
    [
      ids.buyer,
      ids.attachmentCase,
      `${BODY} Changed.`,
      [ids.validUpload],
    ],
    /upload authority is invalid/,
  );
  const attachmentCaseCount = await observer.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."CaseMessage"
     WHERE "caseId" = $1
       AND id <> $2
  `, [ids.attachmentCase, openingMessageId(ids.attachmentCase)]);
  assert.equal(attachmentCaseCount.rows[0]?.count, 1);
}

async function proveReplay(observer, runtime) {
  const created = await reply(runtime, ids.buyer, ids.replayCase);
  const replayed = await reply(runtime, ids.buyer, ids.replayCase);
  assert.equal(created.action, "created");
  assert.equal(replayed.action, "replay");
  assert.equal(replayed.messageId, created.messageId);
  assert.deepEqual(replayed.attachments, []);

  const changed = await reply(
    runtime,
    ids.buyer,
    ids.replayCase,
    `${BODY} Changed.`,
  );
  assert.equal(changed.action, "created");
  assert.notEqual(changed.messageId, created.messageId);
  const count = await observer.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."CaseMessage"
     WHERE "caseId" = $1
       AND id <> $2
  `, [ids.replayCase, openingMessageId(ids.replayCase)]);
  assert.equal(count.rows[0]?.count, 2);
}

async function waitForLock(observer, applicationName) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await observer.query(`
      SELECT wait_event_type, wait_event
        FROM pg_catalog.pg_stat_activity
       WHERE application_name = $1
         AND state = 'active'
    `, [applicationName]);
    if (result.rows[0]?.wait_event_type === "Lock") return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function proveConcurrency(observer, first, second) {
  await first.query("BEGIN");
  await first.query("SET LOCAL ROLE grainline_app_runtime");
  const created = await first.query(
    "SELECT public.grainline_case_reply($1, $2, $3, $4) AS result",
    [ids.buyer, ids.concurrencyCase, BODY, []],
  );
  assert.equal(created.rows[0]?.result?.action, "created");

  await second.query("BEGIN");
  await second.query("SET LOCAL ROLE grainline_app_runtime");
  const replayPromise = second.query(
    "SELECT public.grainline_case_reply($1, $2, $3, $4) AS result",
    [ids.buyer, ids.concurrencyCase, BODY, []],
  );
  const lock = await waitForLock(observer, "case-reply-proof-second");
  await first.query("COMMIT");
  const replay = await replayPromise;
  await second.query("COMMIT");

  assert.equal(lock.wait_event_type, "Lock");
  assert.equal(replay.rows[0]?.result?.action, "replay");
  assert.equal(
    replay.rows[0]?.result?.messageId,
    created.rows[0]?.result?.messageId,
  );
}

async function proveRollback(observer, runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(
      "SELECT public.grainline_case_reply($1, $2, $3, $4) AS result",
      [ids.buyer, ids.rollbackCase, BODY, [ids.rollbackUpload]],
    );
    assert.equal(result.rows[0]?.result?.action, "created");
  } finally {
    await runtime.query("ROLLBACK");
  }

  const residue = await observer.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseMessage"
         WHERE "caseId" = $1
           AND id <> $3
      ) AS message_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseMessageAttachment" AS attachment
          JOIN public."CaseMessage" AS message
            ON message.id = attachment."caseMessageId"
         WHERE message."caseId" = $1
      ) AS attachment_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."DirectUploadReference"
         WHERE "directUploadId" = $2
      ) AS reference_count,
      (
        SELECT status
          FROM public."DirectUpload"
         WHERE id = $2
      ) AS upload_status
  `, [
    ids.rollbackCase,
    ids.rollbackUpload,
    openingMessageId(ids.rollbackCase),
  ]);
  assert.deepEqual(residue.rows[0], {
    message_count: 0,
    attachment_count: 0,
    reference_count: 0,
    upload_status: "VERIFIED",
  });
}

export async function runCaseReplyAuthorityPostgresProof(env = process.env) {
  const { databaseUrl } = parseCaseReplyAuthorityProofConfig(env);
  const observer = createClient(databaseUrl, "case-reply-proof-observer");
  const runtime = createClient(databaseUrl, "case-reply-proof-runtime");
  const first = createClient(databaseUrl, "case-reply-proof-first");
  const second = createClient(databaseUrl, "case-reply-proof-second");
  await Promise.all([
    observer.connect(),
    runtime.connect(),
    first.connect(),
    second.connect(),
  ]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    await proveActorAndStatusAuthority(observer, runtime);
    await proveTransitions(observer, runtime);
    await proveAttachmentAuthority(observer, runtime);
    await proveReplay(observer, runtime);
    await proveConcurrency(observer, first, second);
    await proveRollback(observer, runtime);
    await cleanupFixtures(observer);
    const residue = await observer.query(`
      SELECT
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."Case"
           WHERE id LIKE $1
        ) AS case_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."CaseMessage"
           WHERE "caseId" LIKE $1
        ) AS message_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."CaseMessageAttachment" AS attachment
            JOIN public."CaseMessage" AS message
              ON message.id = attachment."caseMessageId"
           WHERE message."caseId" LIKE $1
        ) AS attachment_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUpload"
           WHERE id LIKE $1
        ) AS upload_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."DirectUploadReference"
           WHERE "directUploadId" LIKE $1
        ) AS reference_count
    `, [`${PREFIX}%`]);
    assert.deepEqual(residue.rows[0], {
      case_count: 0,
      message_count: 0,
      attachment_count: 0,
      upload_count: 0,
      reference_count: 0,
    });
    return Object.freeze({
      checks: 20,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-runtime-role-concurrency-cleanup",
      status: "passed",
    });
  } finally {
    await Promise.allSettled([
      runtime.query("ROLLBACK"),
      first.query("ROLLBACK"),
      second.query("ROLLBACK"),
    ]);
    await cleanupFixtures(observer).catch(() => {});
    await Promise.allSettled([
      observer.end(),
      runtime.end(),
      first.end(),
      second.end(),
    ]);
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCaseReplyAuthorityPostgresProof()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          message: safeError(error),
          persistentStagingChanged: false,
          productionChanged: false,
          status: "failed",
        })}\n`,
      );
      process.exitCode = 1;
    });
}
