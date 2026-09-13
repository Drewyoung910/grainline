#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-open-authority-proof";
const DESCRIPTION =
  "Disposable buyer Case-opening authority proof description.";

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  secondSeller: `${PREFIX}-second-seller`,
  foreign: `${PREFIX}-foreign`,
  sellerProfile: `${PREFIX}-seller-profile`,
  secondSellerProfile: `${PREFIX}-second-seller-profile`,
  listing: `${PREFIX}-listing`,
  secondListing: `${PREFIX}-second-listing`,
  validOrder: `${PREFIX}-order-valid`,
  unpaidOrder: `${PREFIX}-order-unpaid`,
  multiSellerOrder: `${PREFIX}-order-multi-seller`,
  refundSentinelOrder: `${PREFIX}-order-refund-sentinel`,
  refundEventOrder: `${PREFIX}-order-refund-event`,
  earlyOrder: `${PREFIX}-order-early`,
  labelOrder: `${PREFIX}-order-label`,
  futureOrder: `${PREFIX}-order-future`,
  reviewNeededOrder: `${PREFIX}-order-review-needed`,
  expiredOrder: `${PREFIX}-order-expired`,
  malformedReplayOrder: `${PREFIX}-order-malformed-replay`,
  concurrencyOrder: `${PREFIX}-order-concurrency`,
  rollbackOrder: `${PREFIX}-order-rollback`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseOpenAuthorityProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case-open authority proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case-open authority proof requires the ${DATABASE_NAME} database`,
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

async function expectRuntimeError(client, name, sql, params, pattern) {
  let caught;
  try {
    await runtimeQuery(client, sql, params);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${name} unexpectedly succeeded`);
  assert.match(safeError(caught), pattern, name);
}

async function openCase(
  client,
  actorId,
  orderId,
  reason = "OTHER",
  description = DESCRIPTION,
) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_case_open($1, $2, $3, $4) AS result",
    [actorId, orderId, reason, description],
  );
  return result.rows[0]?.result;
}

async function seedUsersAndListings(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Case-open proof buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Case-open proof seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Case-open proof second seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($10, $11, $12, 'Case-open proof foreign user', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.buyer,
    `clerk-${ids.buyer}`,
    `${ids.buyer}@example.invalid`,
    ids.seller,
    `clerk-${ids.seller}`,
    `${ids.seller}@example.invalid`,
    ids.secondSeller,
    `clerk-${ids.secondSeller}`,
    `${ids.secondSeller}@example.invalid`,
    ids.foreign,
    `clerk-${ids.foreign}`,
    `${ids.foreign}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, 'Case-open proof seller', 'case-open proof seller',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($3, $4, 'Case-open proof second seller', 'case-open proof second seller',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.sellerProfile,
    ids.seller,
    ids.secondSellerProfile,
    ids.secondSeller,
  ]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, 'Case-open proof listing',
       'Disposable loopback-only Case-open authority proof.',
       10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($3, $4, 'Case-open proof second listing',
       'Disposable second-seller Case-open authority proof.',
       10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.listing,
    ids.sellerProfile,
    ids.secondListing,
    ids.secondSellerProfile,
  ]);
}

async function seedOrder(
  client,
  orderId,
  {
    estimated = "past",
    fulfillmentStatus = "SHIPPED",
    labelStatus = null,
    paid = true,
    reviewNeeded = false,
  } = {},
) {
  const estimatedExpression =
    estimated === "future"
      ? "CURRENT_TIMESTAMP + INTERVAL '1 day'"
      : estimated === "expired"
        ? "CURRENT_TIMESTAMP - INTERVAL '31 days'"
        : "CURRENT_TIMESTAMP - INTERVAL '1 day'";
  const deliveredExpression =
    fulfillmentStatus === "DELIVERED"
      ? estimatedExpression
      : "NULL";
  await client.query(`
    INSERT INTO public."Order" (
      id,
      "buyerId",
      "stripeChargeId",
      "itemsSubtotalCents",
      "shippingAmountCents",
      "taxAmountCents",
      "paidAt",
      "fulfillmentStatus",
      "labelStatus",
      "estimatedDeliveryDate",
      "deliveredAt",
      "reviewNeeded"
    )
    VALUES (
      $1,
      $2,
      $3,
      10000,
      0,
      0,
      ${paid ? "CURRENT_TIMESTAMP" : "NULL"},
      $4::public."FulfillmentStatus",
      $5::public."LabelStatus",
      ${estimatedExpression},
      ${deliveredExpression},
      $6
    )
  `, [
    orderId,
    ids.buyer,
    `${PREFIX}-charge-${orderId}`,
    fulfillmentStatus,
    labelStatus,
    reviewNeeded,
  ]);
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 10000)
  `, [`${orderId}-item-primary`, orderId, ids.listing]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUsersAndListings(client);
    await seedOrder(client, ids.validOrder);
    await seedOrder(client, ids.unpaidOrder, { paid: false });
    await seedOrder(client, ids.multiSellerOrder);
    await seedOrder(client, ids.refundSentinelOrder);
    await seedOrder(client, ids.refundEventOrder);
    await seedOrder(client, ids.earlyOrder, {
      fulfillmentStatus: "PENDING",
    });
    await seedOrder(client, ids.labelOrder, {
      fulfillmentStatus: "PENDING",
      labelStatus: "PURCHASED",
    });
    await seedOrder(client, ids.futureOrder, { estimated: "future" });
    await seedOrder(client, ids.reviewNeededOrder, {
      estimated: "future",
      fulfillmentStatus: "PENDING",
      reviewNeeded: true,
    });
    await seedOrder(client, ids.expiredOrder, {
      estimated: "expired",
      fulfillmentStatus: "DELIVERED",
    });
    await seedOrder(client, ids.malformedReplayOrder);
    await seedOrder(client, ids.concurrencyOrder);
    await seedOrder(client, ids.rollbackOrder);

    await client.query("SAVEPOINT reject_multi_seller_item");
    let multiSellerError;
    try {
      await client.query(`
        INSERT INTO public."OrderItem" (
          id, "orderId", "listingId", quantity, "priceCents"
        )
        VALUES ($1, $2, $3, 1, 10000)
      `, [
        `${ids.multiSellerOrder}-item-second`,
        ids.multiSellerOrder,
        ids.secondListing,
      ]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      multiSellerError = error;
      await client.query("ROLLBACK TO SAVEPOINT reject_multi_seller_item");
    }
    assert.ok(multiSellerError, "multi_seller_item_invariant_rejected");
    assert.match(
      safeError(multiSellerError),
      /Order cannot contain items from multiple sellers/,
    );
    await client.query("RELEASE SAVEPOINT reject_multi_seller_item");

    await client.query(`
      UPDATE public."Order"
         SET "sellerRefundId" = 'pending',
             "sellerRefundLockedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
    `, [ids.refundSentinelOrder]);
    await client.query(`
      INSERT INTO public."OrderPaymentEvent" (
        id,
        "orderId",
        "stripeEventId",
        "stripeObjectId",
        "stripeObjectType",
        "eventType",
        "amountCents",
        currency,
        status,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'refund', 'REFUND', 1000, 'usd', 'succeeded',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [
      `${PREFIX}-refund-event`,
      ids.refundEventOrder,
      `${PREFIX}-stripe-refund-event`,
      `${PREFIX}-stripe-refund`,
    ]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."CaseOpenApplication" WHERE "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."AdminAuditLog" WHERE "adminId" LIKE $1 OR "targetId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1 OR "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."OrderPaymentEvent" WHERE "orderId" LIKE $1',
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
      'DELETE FROM public."Listing" WHERE id IN ($1, $2)',
      [ids.listing, ids.secondListing],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id IN ($1, $2)',
      [ids.sellerProfile, ids.secondSellerProfile],
    );
    await client.query(
      'DELETE FROM public."User" WHERE id IN ($1, $2, $3, $4)',
      [ids.buyer, ids.seller, ids.secondSeller, ids.foreign],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveInputAndSourceDenials(runtime) {
  await expectRuntimeError(
    runtime,
    "foreign_buyer_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.foreign, ids.validOrder, "OTHER", DESCRIPTION],
    /buyer authority is invalid/,
  );
  await expectRuntimeError(
    runtime,
    "unpaid_order_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.unpaidOrder, "OTHER", DESCRIPTION],
    /Order is not paid/,
  );
  await expectRuntimeError(
    runtime,
    "refund_sentinel_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.refundSentinelOrder, "OTHER", DESCRIPTION],
    /conflicts with refund or staff state/,
  );
  await expectRuntimeError(
    runtime,
    "refund_event_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.refundEventOrder, "OTHER", DESCRIPTION],
    /refund evidence/,
  );
  await expectRuntimeError(
    runtime,
    "pending_order_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.earlyOrder, "OTHER", DESCRIPTION],
    /has not shipped/,
  );
  await expectRuntimeError(
    runtime,
    "label_purchase_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.labelOrder, "OTHER", DESCRIPTION],
    /label purchase is active/,
  );
  await expectRuntimeError(
    runtime,
    "future_estimate_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.futureOrder, "OTHER", DESCRIPTION],
    /estimated delivery is in the future/,
  );
  await expectRuntimeError(
    runtime,
    "expired_window_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.expiredOrder, "OTHER", DESCRIPTION],
    /window has closed/,
  );
}

async function proveCreateAndReplay(observer, runtime) {
  const created = await openCase(
    runtime,
    ids.buyer,
    ids.validOrder,
    "DAMAGED",
  );
  assert.equal(created.action, "created");
  assert.equal(created.orderId, ids.validOrder);
  assert.equal(created.buyerUserId, ids.buyer);
  assert.equal(created.sellerUserId, ids.seller);
  assert.equal(created.reason, "DAMAGED");
  assert.equal(created.status, "OPEN");
  assert.ok(created.caseId);
  assert.ok(created.openingMessageId);
  assert.ok(created.auditLogId);

  const replay = await openCase(
    runtime,
    ids.buyer,
    ids.validOrder,
    "DAMAGED",
  );
  assert.equal(replay.action, "replay");
  assert.equal(replay.caseId, created.caseId);
  assert.equal(replay.openingMessageId, created.openingMessageId);
  assert.equal(replay.auditLogId, created.auditLogId);

  await expectRuntimeError(
    runtime,
    "changed_description_replay_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [
      ids.buyer,
      ids.validOrder,
      "DAMAGED",
      `${DESCRIPTION} Changed.`,
    ],
    /replay authority is invalid/,
  );

  const artifacts = await observer.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Case"
         WHERE "orderId" = $1
      ) AS case_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseMessage"
         WHERE "caseId" = $2
      ) AS message_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog"
         WHERE id = $3
           AND action = 'BUYER_OPEN_CASE'
      ) AS audit_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseOpenApplication"
         WHERE "orderId" = $1
      ) AS application_count
  `, [ids.validOrder, created.caseId, created.auditLogId]);
  assert.deepEqual(artifacts.rows[0], {
    case_count: 1,
    message_count: 1,
    audit_count: 1,
    application_count: 1,
  });
}

async function proveReviewOverride(runtime) {
  const result = await openCase(
    runtime,
    ids.buyer,
    ids.reviewNeededOrder,
  );
  assert.equal(result.action, "created");
  assert.equal(result.orderId, ids.reviewNeededOrder);
}

async function proveMalformedReplayAuditRejected(observer, runtime) {
  const created = await openCase(
    runtime,
    ids.buyer,
    ids.malformedReplayOrder,
  );
  await observer.query(`
    UPDATE public."AdminAuditLog"
       SET metadata = metadata - 'openingMessageId'
     WHERE id = $1
  `, [created.auditLogId]);
  await expectRuntimeError(
    runtime,
    "malformed_replay_audit_rejected",
    "SELECT public.grainline_case_open($1, $2, $3, $4)",
    [ids.buyer, ids.malformedReplayOrder, "OTHER", DESCRIPTION],
    /replay audit is invalid/,
  );
}

async function provePrivateLedgerDenied(runtime) {
  await expectRuntimeError(
    runtime,
    "runtime_private_ledger_select_denied",
    'SELECT * FROM public."CaseOpenApplication" LIMIT 1',
    [],
    /permission denied|row-level security policy/,
  );
  await expectRuntimeError(
    runtime,
    "runtime_private_ledger_delete_denied",
    'DELETE FROM public."CaseOpenApplication" WHERE "orderId" = $1',
    [ids.validOrder],
    /permission denied|row-level security policy/,
  );
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
    if (result.rows[0]?.wait_event_type === "Lock") {
      return result.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function proveConcurrentOpen(observer, first, second) {
  await first.query("BEGIN");
  await first.query("SET LOCAL ROLE grainline_app_runtime");
  const created = await first.query(
    "SELECT public.grainline_case_open($1, $2, $3, $4) AS result",
    [ids.buyer, ids.concurrencyOrder, "OTHER", DESCRIPTION],
  );
  assert.equal(created.rows[0]?.result?.action, "created");

  await second.query("BEGIN");
  await second.query("SET LOCAL ROLE grainline_app_runtime");
  const replayPromise = second.query(
    "SELECT public.grainline_case_open($1, $2, $3, $4) AS result",
    [ids.buyer, ids.concurrencyOrder, "OTHER", DESCRIPTION],
  );
  const lock = await waitForLock(observer, "case-open-proof-second");
  await first.query("COMMIT");
  const replay = await replayPromise;
  await second.query("COMMIT");

  assert.equal(lock.wait_event_type, "Lock");
  assert.equal(replay.rows[0]?.result?.action, "replay");
  assert.equal(
    replay.rows[0]?.result?.caseId,
    created.rows[0]?.result?.caseId,
  );
  const count = await observer.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."Case"
     WHERE "orderId" = $1
  `, [ids.concurrencyOrder]);
  assert.equal(count.rows[0]?.count, 1);
}

async function proveRollback(observer, runtime) {
  const auditBefore = await observer.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."AdminAuditLog"
     WHERE "adminId" = $1
       AND action = 'BUYER_OPEN_CASE'
  `, [ids.buyer]);
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(
      "SELECT public.grainline_case_open($1, $2, $3, $4) AS result",
      [ids.buyer, ids.rollbackOrder, "OTHER", DESCRIPTION],
    );
    assert.equal(result.rows[0]?.result?.action, "created");
  } finally {
    await runtime.query("ROLLBACK");
  }
  const residue = await observer.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Case"
         WHERE "orderId" = $1
      ) AS case_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseOpenApplication"
         WHERE "orderId" = $1
      ) AS application_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog"
         WHERE "adminId" = $2
           AND action = 'BUYER_OPEN_CASE'
      ) AS audit_count
  `, [ids.rollbackOrder, ids.buyer]);
  assert.deepEqual(residue.rows[0], {
    case_count: 0,
    application_count: 0,
    audit_count: auditBefore.rows[0]?.count,
  });
}

export async function runCaseOpenAuthorityPostgresProof(env = process.env) {
  const { databaseUrl } = parseCaseOpenAuthorityProofConfig(env);
  const observer = createClient(databaseUrl, "case-open-proof-observer");
  const runtime = createClient(databaseUrl, "case-open-proof-runtime");
  const first = createClient(databaseUrl, "case-open-proof-first");
  const second = createClient(databaseUrl, "case-open-proof-second");
  await Promise.all([
    observer.connect(),
    runtime.connect(),
    first.connect(),
    second.connect(),
  ]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    await proveInputAndSourceDenials(runtime);
    await proveCreateAndReplay(observer, runtime);
    await proveReviewOverride(runtime);
    await proveMalformedReplayAuditRejected(observer, runtime);
    await provePrivateLedgerDenied(runtime);
    await proveConcurrentOpen(observer, first, second);
    await proveRollback(observer, runtime);
    await cleanupFixtures(observer);
    const residue = await observer.query(`
      SELECT
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."Case"
           WHERE id LIKE $1 OR "orderId" LIKE $1
        ) AS case_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."CaseOpenApplication"
           WHERE "orderId" LIKE $1
        ) AS application_count,
        (
          SELECT pg_catalog.count(*)::integer
            FROM public."AdminAuditLog"
           WHERE "adminId" LIKE $1 OR "targetId" LIKE $1
        ) AS audit_count
    `, [`${PREFIX}%`]);
    assert.deepEqual(residue.rows[0], {
      case_count: 0,
      application_count: 0,
      audit_count: 0,
    });
    return Object.freeze({
      checks: 19,
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
  runCaseOpenAuthorityPostgresProof()
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
