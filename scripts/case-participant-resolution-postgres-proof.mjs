#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_PARTICIPANT_RESOLUTION_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-participant-resolution-proof";

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  sequentialOrder: `${PREFIX}-order-sequential`,
  refundOrder: `${PREFIX}-order-refund`,
  staffClaimOrder: `${PREFIX}-order-staff-claim`,
  nullableBuyerOrder: `${PREFIX}-order-nullable-buyer`,
  invalidReplayOrder: `${PREFIX}-order-invalid-replay`,
  concurrencyOrder: `${PREFIX}-order-concurrency`,
  rollbackOrder: `${PREFIX}-order-rollback`,
  sequentialCase: `${PREFIX}-case-sequential`,
  refundCase: `${PREFIX}-case-refund`,
  staffClaimCase: `${PREFIX}-case-staff-claim`,
  nullableBuyerCase: `${PREFIX}-case-nullable-buyer`,
  invalidReplayCase: `${PREFIX}-case-invalid-replay`,
  concurrencyCase: `${PREFIX}-case-concurrency`,
  rollbackCase: `${PREFIX}-case-rollback`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseParticipantResolutionProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case participant-resolution proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case participant-resolution proof requires the ${DATABASE_NAME} database`,
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

async function seedFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Resolution proof buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Resolution proof seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Resolution proof foreign', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($10, $11, $12, 'Resolution proof staff', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      $1, $2, 'Resolution proof seller', 'resolution proof seller',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sellerProfile, ids.seller]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Resolution proof listing',
      'Disposable loopback-only participant resolution proof.',
      10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.listing, ids.sellerProfile]);

  const fixtures = [
    [ids.sequentialOrder, ids.sequentialCase],
    [ids.refundOrder, ids.refundCase],
    [ids.staffClaimOrder, ids.staffClaimCase],
    [ids.nullableBuyerOrder, ids.nullableBuyerCase],
    [ids.invalidReplayOrder, ids.invalidReplayCase],
    [ids.concurrencyOrder, ids.concurrencyCase],
    [ids.rollbackOrder, ids.rollbackCase],
  ];
  for (const [position, [orderId, caseId]] of fixtures.entries()) {
    await client.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "stripeChargeId", "itemsSubtotalCents",
        "shippingAmountCents", "taxAmountCents"
      )
      VALUES ($1, $2, $3, 10000, 0, 0)
    `, [orderId, ids.buyer, `${PREFIX}-charge-${position}`]);
    await client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 10000)
    `, [`${PREFIX}-item-${position}`, orderId, ids.listing]);
    await client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, "sellerRespondBy", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'OTHER',
        'Disposable participant resolution proof Case.',
        'IN_DISCUSSION', CURRENT_TIMESTAMP + INTERVAL '48 hours',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [caseId, orderId, ids.buyer, ids.seller]);
    await client.query(`
      INSERT INTO public."CaseMessage" (
        id, "caseId", "authorId", "authorKind", body, "createdAt"
      )
      VALUES (
        $1, $2, $3, 'BUYER',
        'Disposable participant resolution proof opening.',
        CURRENT_TIMESTAMP
      )
    `, [`${caseId}-message`, caseId, ids.buyer]);
  }
  await client.query(`
    UPDATE public."Case"
       SET "buyerId" = NULL
     WHERE id = $1
  `, [ids.nullableBuyerCase]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(`
      DELETE FROM public."AdminAuditLog"
       WHERE "adminId" IN ($1, $2, $3, $4)
          OR "targetId" LIKE $5
    `, [
      ids.buyer,
      ids.seller,
      ids.foreign,
      ids.staff,
      `${PREFIX}%`,
    ]);
    await client.query(`
      DELETE FROM public."CaseResolutionClaim"
       WHERE "caseId" LIKE $1
          OR "orderId" LIKE $1
    `, [`${PREFIX}%`]);
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
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

async function markResolved(client, actorId, caseId) {
  const result = await runtimeQuery(
    client,
    `
      SELECT public.grainline_case_mark_resolved($1, $2) AS result
    `,
    [actorId, caseId],
  );
  return result.rows[0]?.result;
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

async function proveSequentialAuthority(observer, runtime) {
  await expectRuntimeError(
    runtime,
    "foreign_participant_resolution_mark",
    "SELECT public.grainline_case_mark_resolved($1, $2)",
    [ids.foreign, ids.sequentialCase],
    /participant authority is invalid/,
  );

  const buyerMark = await markResolved(
    runtime,
    ids.buyer,
    ids.sequentialCase,
  );
  assert.equal(buyerMark.status, "PENDING_CLOSE");
  assert.equal(buyerMark.buyerMarkedResolved, true);
  assert.equal(buyerMark.sellerMarkedResolved, false);
  assert.equal(buyerMark.action, "updated");

  const buyerReplay = await markResolved(
    runtime,
    ids.buyer,
    ids.sequentialCase,
  );
  assert.equal(buyerReplay.action, "replay");
  assert.equal(buyerReplay.auditLogId, buyerMark.auditLogId);

  const sellerMark = await markResolved(
    runtime,
    ids.seller,
    ids.sequentialCase,
  );
  assert.equal(sellerMark.status, "RESOLVED");
  assert.equal(sellerMark.buyerMarkedResolved, true);
  assert.equal(sellerMark.sellerMarkedResolved, true);
  assert.equal(sellerMark.action, "updated");

  const sellerReplay = await markResolved(
    runtime,
    ids.seller,
    ids.sequentialCase,
  );
  assert.equal(sellerReplay.action, "replay");
  assert.equal(sellerReplay.auditLogId, sellerMark.auditLogId);

  const state = await observer.query(`
    SELECT
      status::text,
      resolution::text,
      "resolvedById",
      "buyerMarkedResolved",
      "sellerMarkedResolved"
      FROM public."Case"
     WHERE id = $1
  `, [ids.sequentialCase]);
  assert.deepEqual(state.rows[0], {
    status: "RESOLVED",
    resolution: "DISMISSED",
    resolvedById: ids.seller,
    buyerMarkedResolved: true,
    sellerMarkedResolved: true,
  });
  const audits = await observer.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."AdminAuditLog"
     WHERE action = 'MARK_CASE_RESOLVED'
       AND "targetId" = $1
  `, [ids.sequentialCase]);
  assert.equal(audits.rows[0]?.count, 2);
}

async function proveLeaseFences(observer, runtime) {
  await observer.query(`
    UPDATE public."Order"
       SET "sellerRefundId" = 'pending',
           "sellerRefundLockedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [ids.refundOrder]);
  await expectRuntimeError(
    runtime,
    "refund_lease_blocks_resolution_mark",
    "SELECT public.grainline_case_mark_resolved($1, $2)",
    [ids.buyer, ids.refundCase],
    /conflicts with refund or staff state/,
  );

  const claim = await runtimeQuery(
    runtime,
    `
      SELECT public.grainline_case_staff_resolution_prepare(
        $1,
        $2,
        'DISMISSED'::public."CaseResolution",
        NULL,
        '[]'::jsonb
      ) AS result
    `,
    [ids.staff, ids.staffClaimCase],
  );
  const claimId = claim.rows[0]?.result?.claimId;
  assert.ok(claimId);
  await expectRuntimeError(
    runtime,
    "staff_claim_blocks_resolution_mark",
    "SELECT public.grainline_case_mark_resolved($1, $2)",
    [ids.buyer, ids.staffClaimCase],
    /conflicts with refund or staff state/,
  );
  await runtimeQuery(
    runtime,
    `
      SELECT public.grainline_case_staff_resolution_finalize($1, $2)
    `,
    [ids.staff, claimId],
  );

  const untouched = await observer.query(`
    SELECT id, status::text, "buyerMarkedResolved", "sellerMarkedResolved"
      FROM public."Case"
     WHERE id IN ($1, $2)
     ORDER BY id
  `, [ids.refundCase, ids.staffClaimCase]);
  const refundState = untouched.rows.find((row) => row.id === ids.refundCase);
  assert.deepEqual(refundState, {
    id: ids.refundCase,
    status: "IN_DISCUSSION",
    buyerMarkedResolved: false,
    sellerMarkedResolved: false,
  });
}

async function proveNullableLegacyParticipant(observer, runtime) {
  const sellerMark = await markResolved(
    runtime,
    ids.seller,
    ids.nullableBuyerCase,
  );
  assert.deepEqual(
    {
      buyerMarkedResolved: sellerMark.buyerMarkedResolved,
      sellerMarkedResolved: sellerMark.sellerMarkedResolved,
      status: sellerMark.status,
    },
    {
      buyerMarkedResolved: false,
      sellerMarkedResolved: true,
      status: "PENDING_CLOSE",
    },
  );
  const state = await observer.query(`
    SELECT
      "buyerMarkedResolved",
      "sellerMarkedResolved",
      status::text
      FROM public."Case"
     WHERE id = $1
  `, [ids.nullableBuyerCase]);
  assert.deepEqual(state.rows[0], {
    buyerMarkedResolved: false,
    sellerMarkedResolved: true,
    status: "PENDING_CLOSE",
  });
}

async function proveMalformedReplayAuditRejected(observer, runtime) {
  await observer.query(`
    UPDATE public."Case"
       SET status = 'PENDING_CLOSE'::public."CaseStatus",
           "buyerMarkedResolved" = true
     WHERE id = $1
  `, [ids.invalidReplayCase]);
  await observer.query(`
    INSERT INTO public."AdminAuditLog" (
      id,
      "adminId",
      action,
      "targetType",
      "targetId",
      metadata
    )
    VALUES (
      'case_resolution_mark_' || pg_catalog.md5($1::text || ':' || $2::text),
      $2,
      'MARK_CASE_RESOLVED',
      'CASE',
      $1,
      pg_catalog.jsonb_build_object(
        'actorKind', 'user',
        'orderId', $3::text,
        'at', '2026-07-29T00:00:00.000Z'
      )
    )
  `, [ids.invalidReplayCase, ids.buyer, ids.invalidReplayOrder]);
  await expectRuntimeError(
    runtime,
    "missing_replay_status_rejected",
    "SELECT public.grainline_case_mark_resolved($1, $2)",
    [ids.buyer, ids.invalidReplayCase],
    /replay audit is invalid/,
  );
}

async function proveConcurrentMarks(
  observer,
  first,
  second,
) {
  await first.query("BEGIN");
  await first.query("SET LOCAL ROLE grainline_app_runtime");
  const buyer = await first.query(
    "SELECT public.grainline_case_mark_resolved($1, $2) AS result",
    [ids.buyer, ids.concurrencyCase],
  );
  assert.equal(buyer.rows[0]?.result?.status, "PENDING_CLOSE");

  await second.query("BEGIN");
  await second.query("SET LOCAL ROLE grainline_app_runtime");
  const sellerPromise = second.query(
    "SELECT public.grainline_case_mark_resolved($1, $2) AS result",
    [ids.seller, ids.concurrencyCase],
  );
  const lock = await waitForLock(
    observer,
    "case-participant-resolution-proof-second",
  );
  await first.query("COMMIT");
  const seller = await sellerPromise;
  await second.query("COMMIT");

  assert.equal(lock.wait_event_type, "Lock");
  assert.equal(seller.rows[0]?.result?.status, "RESOLVED");
  const finalState = await observer.query(`
    SELECT
      status::text,
      resolution::text,
      "buyerMarkedResolved",
      "sellerMarkedResolved"
      FROM public."Case"
     WHERE id = $1
  `, [ids.concurrencyCase]);
  assert.deepEqual(finalState.rows[0], {
    status: "RESOLVED",
    resolution: "DISMISSED",
    buyerMarkedResolved: true,
    sellerMarkedResolved: true,
  });
}

async function proveRollback(observer, runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(
      "SELECT public.grainline_case_mark_resolved($1, $2) AS result",
      [ids.buyer, ids.rollbackCase],
    );
    assert.equal(result.rows[0]?.result?.status, "PENDING_CLOSE");
  } finally {
    await runtime.query("ROLLBACK");
  }
  const residue = await observer.query(`
    SELECT
      case_row.status::text,
      case_row."buyerMarkedResolved",
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog" AS audit
         WHERE audit."targetId" = case_row.id
           AND audit.action = 'MARK_CASE_RESOLVED'
      ) AS audit_count
      FROM public."Case" AS case_row
     WHERE case_row.id = $1
  `, [ids.rollbackCase]);
  assert.deepEqual(residue.rows[0], {
    status: "IN_DISCUSSION",
    buyerMarkedResolved: false,
    audit_count: 0,
  });
}

export async function runParticipantResolutionPostgresProof(
  env = process.env,
) {
  const { databaseUrl } = parseParticipantResolutionProofConfig(env);
  const observer = createClient(
    databaseUrl,
    "case-participant-resolution-proof-observer",
  );
  const runtime = createClient(
    databaseUrl,
    "case-participant-resolution-proof-runtime",
  );
  const first = createClient(
    databaseUrl,
    "case-participant-resolution-proof-first",
  );
  const second = createClient(
    databaseUrl,
    "case-participant-resolution-proof-second",
  );
  await Promise.all([
    observer.connect(),
    runtime.connect(),
    first.connect(),
    second.connect(),
  ]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    await proveSequentialAuthority(observer, runtime);
    await proveLeaseFences(observer, runtime);
    await proveNullableLegacyParticipant(observer, runtime);
    await proveMalformedReplayAuditRejected(observer, runtime);
    await proveConcurrentMarks(observer, first, second);
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
            FROM public."AdminAuditLog"
           WHERE "targetId" LIKE $1
              OR "adminId" LIKE $1
        ) AS audit_count
    `, [`${PREFIX}%`]);
    assert.deepEqual(residue.rows[0], {
      case_count: 0,
      audit_count: 0,
    });
    return Object.freeze({
      checks: 12,
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
  runParticipantResolutionPostgresProof()
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
