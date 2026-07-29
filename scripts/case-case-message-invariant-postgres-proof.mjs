#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_INVARIANT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const INVARIANT_DRAFT =
  "docs/rls-drafts/case-case-message-invariants.sql";

const ids = Object.freeze({
  buyer: "case-invariant-proof-buyer",
  seller: "case-invariant-proof-seller",
  foreign: "case-invariant-proof-foreign",
  staff: "case-invariant-proof-staff",
  sellerProfile: "case-invariant-proof-seller-profile",
  listing: "case-invariant-proof-listing",
  ordinaryOrder: "case-invariant-proof-order-ordinary",
  sourceOrder: "case-invariant-proof-order-source",
  refundOrder: "case-invariant-proof-order-refund",
  releaseOrder: "case-invariant-proof-order-release",
  ordinaryCase: "case-invariant-proof-case-ordinary",
  sourceCase: "case-invariant-proof-case-source",
  refundCase: "case-invariant-proof-case-refund",
  releaseCase: "case-invariant-proof-case-release",
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseInvariantProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case invariant proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case invariant proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export function readDraftTransactionBody(path) {
  const sql = fs.readFileSync(path, "utf8").trim();
  assert.match(sql, /\bDRAFT ONLY\b/);
  assert.match(sql, /^--[\s\S]*?\nBEGIN;\s*/);
  assert.match(sql, /\sCOMMIT;\s*$/);
  return sql
    .replace(/^([\s\S]*?\n)BEGIN;\s*/, "$1")
    .replace(/\sCOMMIT;\s*$/, "\n");
}

async function expectPostgresError(client, name, work, pattern) {
  const savepoint = `proof_${name.replace(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.ok(caught, `${name} unexpectedly succeeded`);
  assert.match(safeError(caught), pattern, name);
}

async function setConstraintsImmediate(client) {
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

async function seedBaseFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Proof buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Proof seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Proof foreign', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($10, $11, $12, 'Proof staff', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.buyer,
    "clerk-case-invariant-proof-buyer",
    "case-invariant-proof-buyer@example.invalid",
    ids.seller,
    "clerk-case-invariant-proof-seller",
    "case-invariant-proof-seller@example.invalid",
    ids.foreign,
    "clerk-case-invariant-proof-foreign",
    "case-invariant-proof-foreign@example.invalid",
    ids.staff,
    "clerk-case-invariant-proof-staff",
    "case-invariant-proof-staff@example.invalid",
  ]);

  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Proof seller', 'proof seller',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sellerProfile, ids.seller]);

  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Invariant proof listing',
      'Disposable loopback-only invariant proof listing.',
      10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.listing, ids.sellerProfile]);

  for (const [position, orderId] of [
    ids.ordinaryOrder,
    ids.sourceOrder,
    ids.refundOrder,
    ids.releaseOrder,
  ].entries()) {
    await client.query(`
      INSERT INTO public."Order" (id, "buyerId", "stripeChargeId")
      VALUES ($1, $2, $3)
    `, [
      orderId,
      ids.buyer,
      `ch_case_invariant_proof_${position}`,
    ]);
    await client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 10000)
    `, [
      `case-invariant-proof-order-item-${position}`,
      orderId,
      ids.listing,
    ]);
  }
}

async function insertParticipantCase(client, caseId, orderId) {
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, "sellerRespondBy", "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, 'OTHER',
      'Disposable participant Case invariant proof.',
      'OPEN', CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [caseId, orderId, ids.buyer, ids.seller]);
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    VALUES (
      $1, $2, $3, 'BUYER',
      'Disposable participant opening message.',
      CURRENT_TIMESTAMP
    )
  `, [`${caseId}-message`, caseId, ids.buyer]);
  await setConstraintsImmediate(client);
}

async function proveCaseAndMessageInvariants(client) {
  await insertParticipantCase(
    client,
    ids.ordinaryCase,
    ids.ordinaryOrder,
  );

  await expectPostgresError(
    client,
    "forged_buyer_author",
    () => client.query(`
      INSERT INTO public."CaseMessage" (
        id, "caseId", "authorId", "authorKind", body, "createdAt"
      )
      VALUES (
        'case-invariant-proof-forged-message',
        $1, $2, 'BUYER', 'Forged buyer message.', CURRENT_TIMESTAMP
      )
    `, [ids.ordinaryCase, ids.foreign]),
    /CaseMessage author relationship is invalid/,
  );

  await expectPostgresError(
    client,
    "mixed_active_refund_evidence",
    () => client.query(`
      UPDATE public."Case"
         SET "refundAmountCents" = 100
       WHERE id = $1
    `, [ids.ordinaryCase]),
    /Case_lifecycle_evidence_check/,
  );

  await client.query(`
    UPDATE public."Case"
       SET status = 'RESOLVED',
           resolution = 'REFUND_FULL',
           "refundAmountCents" = 10000,
           "stripeRefundId" = 're_case_invariant_proof',
           "resolvedAt" = CURRENT_TIMESTAMP,
           "resolvedById" = $2,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [ids.ordinaryCase, ids.staff]);

  await expectPostgresError(
    client,
    "stale_refund_snapshot_on_reopen",
    () => client.query(`
      UPDATE public."Case"
         SET status = 'UNDER_REVIEW',
             resolution = NULL,
             "resolvedAt" = NULL,
             "resolvedById" = NULL,
             "buyerMarkedResolved" = false,
             "sellerMarkedResolved" = false,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
    `, [ids.ordinaryCase]),
    /Case_lifecycle_evidence_check/,
  );

  await client.query(`
    UPDATE public."Case"
       SET status = 'UNDER_REVIEW',
           resolution = NULL,
           "refundAmountCents" = NULL,
           "stripeRefundId" = NULL,
           "resolvedAt" = NULL,
           "resolvedById" = NULL,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [ids.ordinaryCase]);

  await expectPostgresError(
    client,
    "empty_participant_opening",
    async () => {
      await client.query(`
        INSERT INTO public."Case" (
          id, "orderId", "buyerId", "sellerId", reason, description,
          status, "sellerRespondBy", "createdAt", "updatedAt"
        )
        VALUES (
          'case-invariant-proof-empty-case',
          $1, $2, $3, 'OTHER', 'Unproven empty opening.',
          'OPEN', CURRENT_TIMESTAMP + INTERVAL '48 hours',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [ids.sourceOrder, ids.buyer, ids.seller]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },
    /Case has no human or durable webhook opening evidence/,
  );
  await client.query("SET CONSTRAINTS ALL DEFERRED");

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", currency, metadata,
      "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-dispute-event',
      $1, 'evt_case_invariant_proof_dispute',
      'dp_case_invariant_proof', 'dispute', 'DISPUTE', 'usd',
      pg_catalog.jsonb_build_object(
        'chargeId', 'ch_case_invariant_proof_1',
        'disputeId', 'dp_case_invariant_proof',
        'stripeEventType', 'charge.dispute.created',
        'stripeEventCreated', 1770000000
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sourceOrder]);

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const appliedDispute = await client.query(`
    SELECT *
      FROM public.grainline_case_stripe_dispute_apply(
        'case-invariant-proof-dispute-event'
      )
  `);
  await client.query("RESET ROLE");
  assert.deepEqual(appliedDispute.rows, [{
    caseId: appliedDispute.rows[0]?.caseId,
    orderId: ids.sourceOrder,
    sellerUserId: ids.seller,
    buyerUserId: ids.buyer,
    paymentEventId: "case-invariant-proof-dispute-event",
    action: "create",
  }]);
  assert.match(
    appliedDispute.rows[0]?.caseId ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await setConstraintsImmediate(client);

  const sourceCase = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."Case" AS case_row
     WHERE case_row.id = $1
       AND case_row."openedByPaymentEventId" =
           'case-invariant-proof-dispute-event'
       AND NOT EXISTS (
         SELECT 1
           FROM public."CaseMessage" AS message
          WHERE message."caseId" = case_row.id
       )
  `, [appliedDispute.rows[0].caseId]);
  assert.equal(sourceCase.rows[0]?.count, 1);

  const replayedDispute = await client.query(`
    SELECT *
      FROM public.grainline_case_stripe_dispute_apply(
        'case-invariant-proof-dispute-event'
      )
  `);
  assert.equal(replayedDispute.rows[0]?.caseId, appliedDispute.rows[0]?.caseId);
  assert.equal(replayedDispute.rows[0]?.action, "replay");

  const disputeApplication = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."CaseStripeDisputeApplication"
     WHERE "paymentEventId" = 'case-invariant-proof-dispute-event'
       AND "caseId" = $1
       AND "orderId" = $2
       AND action = 'create'
  `, [appliedDispute.rows[0].caseId, ids.sourceOrder]);
  assert.equal(disputeApplication.rows[0]?.count, 1);

  const disputeAudit = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."SystemAuditLog"
     WHERE action = 'CASE_STRIPE_DISPUTE_APPLIED'
       AND metadata->>'orderPaymentEventId' =
           'case-invariant-proof-dispute-event'
  `);
  assert.equal(disputeAudit.rows[0]?.count, 1);
}

async function proveStripeDisputeAuthority(client) {
  await client.query(`
    UPDATE public."Case"
       SET status = 'RESOLVED',
           resolution = 'REFUND_FULL',
           "refundAmountCents" = 10000,
           "stripeRefundId" = 're_case_invariant_stale_snapshot',
           "resolvedAt" = CURRENT_TIMESTAMP,
           "resolvedById" = $2,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [ids.ordinaryCase, ids.staff]);

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", currency, reason, metadata,
      "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-reopen-event',
      $1, 'evt_case_invariant_proof_reopen',
      'dp_case_invariant_reopen', 'dispute', 'DISPUTE', 'usd',
      'fraudulent',
      pg_catalog.jsonb_build_object(
        'chargeId', 'ch_case_invariant_proof_0',
        'disputeId', 'dp_case_invariant_reopen',
        'stripeEventType', 'charge.dispute.created',
        'stripeEventCreated', 1770000001
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.ordinaryOrder]);

  const reopened = await client.query(`
    SELECT *
      FROM public.grainline_case_stripe_dispute_apply(
        'case-invariant-proof-reopen-event'
      )
  `);
  assert.equal(reopened.rows[0]?.caseId, ids.ordinaryCase);
  assert.equal(reopened.rows[0]?.action, "reopen");

  const cleared = await client.query(`
    SELECT
      status::text,
      resolution,
      "refundAmountCents",
      "stripeRefundId",
      "resolvedAt",
      "resolvedById",
      "buyerMarkedResolved",
      "sellerMarkedResolved"
      FROM public."Case"
     WHERE id = $1
  `, [ids.ordinaryCase]);
  assert.deepEqual(cleared.rows[0], {
    status: "UNDER_REVIEW",
    resolution: null,
    refundAmountCents: null,
    stripeRefundId: null,
    resolvedAt: null,
    resolvedById: null,
    buyerMarkedResolved: false,
    sellerMarkedResolved: false,
  });

  await client.query(`
    UPDATE public."Case"
       SET status = 'RESOLVED',
           resolution = 'DISMISSED',
           "resolvedAt" = CURRENT_TIMESTAMP,
           "resolvedById" = $2,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [ids.ordinaryCase, ids.staff]);

  const replayed = await client.query(`
    SELECT *
      FROM public.grainline_case_stripe_dispute_apply(
        'case-invariant-proof-reopen-event'
      )
  `);
  assert.equal(replayed.rows[0]?.action, "replay");
  const replayState = await client.query(`
    SELECT status::text, resolution::text
      FROM public."Case"
     WHERE id = $1
  `, [ids.ordinaryCase]);
  assert.deepEqual(replayState.rows[0], {
    status: "RESOLVED",
    resolution: "DISMISSED",
  });

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", currency, status, metadata,
      "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-reopen-terminal-event',
      $1, 'evt_case_invariant_proof_reopen_terminal',
      'dp_case_invariant_reopen', 'dispute', 'DISPUTE', 'usd', 'won',
      pg_catalog.jsonb_build_object(
        'chargeId', 'ch_case_invariant_proof_0',
        'disputeId', 'dp_case_invariant_reopen',
        'stripeEventType', 'charge.dispute.closed',
        'stripeEventCreated', 1770000002
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.ordinaryOrder]);
  const replayedAfterTerminal = await client.query(`
    SELECT *
      FROM public.grainline_case_stripe_dispute_apply(
        'case-invariant-proof-reopen-event'
      )
  `);
  assert.equal(replayedAfterTerminal.rows[0]?.action, "replay");
  const postTerminalReplayState = await client.query(`
    SELECT status::text, resolution::text
      FROM public."Case"
     WHERE id = $1
  `, [ids.ordinaryCase]);
  assert.deepEqual(postTerminalReplayState.rows[0], {
    status: "RESOLVED",
    resolution: "DISMISSED",
  });

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", currency, status, metadata,
      "createdAt", "updatedAt"
    )
    VALUES
      (
        'case-invariant-proof-superseded-dispute-event',
        $1, 'evt_case_invariant_proof_superseded',
        'dp_case_invariant_superseded', 'dispute', 'DISPUTE', 'usd',
        'needs_response',
        pg_catalog.jsonb_build_object(
          'chargeId', 'ch_case_invariant_proof_3',
          'disputeId', 'dp_case_invariant_superseded',
          'stripeEventType', 'charge.dispute.created',
          'stripeEventCreated', 1770000002
        ),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ),
      (
        'case-invariant-proof-terminal-dispute-event',
        $1, 'evt_case_invariant_proof_terminal',
        'dp_case_invariant_superseded', 'dispute', 'DISPUTE', 'usd',
        'won',
        pg_catalog.jsonb_build_object(
          'chargeId', 'ch_case_invariant_proof_3',
          'disputeId', 'dp_case_invariant_superseded',
          'stripeEventType', 'charge.dispute.closed',
          'stripeEventCreated', 1770000003
        ),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
  `, [ids.releaseOrder]);
  await expectPostgresError(
    client,
    "superseded_dispute_source",
    () => client.query(`
      SELECT *
        FROM public.grainline_case_stripe_dispute_apply(
          'case-invariant-proof-superseded-dispute-event'
        )
    `),
    /Case Stripe dispute source is superseded/,
  );
  const supersededResidue = await client.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Case"
         WHERE "orderId" = $1
      ) AS case_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseStripeDisputeApplication"
         WHERE "paymentEventId" =
               'case-invariant-proof-superseded-dispute-event'
      ) AS application_count
  `, [ids.releaseOrder]);
  assert.deepEqual(supersededResidue.rows[0], {
    case_count: 0,
    application_count: 0,
  });

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", currency, metadata,
      "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-invalid-dispute-event',
      $1, 'evt_case_invariant_proof_invalid_dispute',
      'dp_case_invariant_invalid', 'dispute', 'DISPUTE', 'usd',
      pg_catalog.jsonb_build_object(
        'chargeId', 'ch_case_invariant_proof_wrong',
        'disputeId', 'dp_case_invariant_invalid',
        'stripeEventType', 'charge.dispute.created'
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.releaseOrder]);
  await expectPostgresError(
    client,
    "forged_dispute_order_charge",
    () => client.query(`
      SELECT *
        FROM public.grainline_case_stripe_dispute_apply(
          'case-invariant-proof-invalid-dispute-event'
        )
    `),
    /Case Stripe dispute source is invalid/,
  );
}

async function proveClaimLedger(client) {
  await insertParticipantCase(client, ids.refundCase, ids.refundOrder);
  await insertParticipantCase(client, ids.releaseCase, ids.releaseOrder);

  await expectPostgresError(
    client,
    "claim_without_order_lease",
    async () => {
      await client.query(`
        INSERT INTO public."CaseResolutionClaim" (
          id, "caseId", "orderId", "staffActorId", resolution,
          currency, "stockRestorePlan", status, "createdAt", "updatedAt"
        )
        VALUES (
          'case-invariant-proof-missing-lease-claim',
          $1, $2, $3, 'DISMISSED',
          'usd', '[]'::jsonb, 'LOCAL_READY',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [ids.ordinaryCase, ids.ordinaryOrder, ids.staff]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    },
    /CaseResolutionClaim Order lease is inconsistent/,
  );
  await client.query("SET CONSTRAINTS ALL DEFERRED");

  await client.query(`
    INSERT INTO public."CaseResolutionClaim" (
      id, "caseId", "orderId", "staffActorId", resolution,
      "refundAmountCents", currency, "stockRestorePlan", status,
      "idempotencyScope", "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-refund-claim',
      $1, $2, $3, 'REFUND_FULL',
      10000, 'usd', '[]'::jsonb, 'PROVIDER_PENDING',
      'case-resolution:case-invariant-proof-refund-claim',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.refundCase, ids.refundOrder, ids.staff]);
  await client.query(`
    UPDATE public."Order"
       SET "caseResolutionClaimId" =
           'case-invariant-proof-refund-claim'
     WHERE id = $1
  `, [ids.refundOrder]);
  await setConstraintsImmediate(client);

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "eventType",
      "amountCents", currency, "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-wrong-order-refund-event',
      $1, 'evt_case_invariant_proof_wrong_order_refund',
      'refund.created', 10000, 'usd',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sourceOrder]);

  await expectPostgresError(
    client,
    "wrong_order_payment_evidence",
    () => client.query(`
      UPDATE public."CaseResolutionClaim"
         SET status = 'PROVIDER_RECORDED',
             "orderPaymentEventId" =
               'case-invariant-proof-wrong-order-refund-event',
             "providerRecordedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = 'case-invariant-proof-refund-claim'
    `),
    /CaseResolutionClaim_orderPaymentEventId_fkey/,
  );

  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "eventType",
      "amountCents", currency, "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-refund-event',
      $1, 'evt_case_invariant_proof_refund',
      'refund.created', 10000, 'usd',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.refundOrder]);

  await client.query(`
    UPDATE public."CaseResolutionClaim"
       SET status = 'RECONCILIATION_REQUIRED',
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = 'case-invariant-proof-refund-claim'
  `);

  await expectPostgresError(
    client,
    "provider_evidence_before_recorded_state",
    () => client.query(`
      UPDATE public."CaseResolutionClaim"
         SET status = 'PROVIDER_PENDING',
             "orderPaymentEventId" = 'case-invariant-proof-refund-event',
             "providerRecordedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = 'case-invariant-proof-refund-claim'
    `),
    /CaseResolutionClaim_status_evidence_check/,
  );

  await client.query(`
    UPDATE public."CaseResolutionClaim"
       SET status = 'PROVIDER_RECORDED',
           "orderPaymentEventId" = 'case-invariant-proof-refund-event',
           "providerRecordedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = 'case-invariant-proof-refund-claim'
  `);

  await expectPostgresError(
    client,
    "provider_evidence_rebinding",
    async () => {
      await client.query(`
        INSERT INTO public."OrderPaymentEvent" (
          id, "orderId", "stripeEventId", "eventType",
          "amountCents", currency, "createdAt", "updatedAt"
        )
        VALUES (
          'case-invariant-proof-refund-event-rebind',
          $1, 'evt_case_invariant_proof_refund_rebind',
          'refund.created', 10000, 'usd',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [ids.refundOrder]);
      await client.query(`
        UPDATE public."CaseResolutionClaim"
           SET status = 'RECONCILIATION_REQUIRED',
               "orderPaymentEventId" =
                 'case-invariant-proof-refund-event-rebind',
               "providerRecordedAt" = CURRENT_TIMESTAMP,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = 'case-invariant-proof-refund-claim'
      `);
    },
    /CaseResolutionClaim provider evidence is immutable/,
  );

  await client.query(`
    UPDATE public."CaseResolutionClaim"
       SET status = 'FINALIZED',
           "finalizedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = 'case-invariant-proof-refund-claim'
  `);
  await client.query(`
    UPDATE public."Order"
       SET "caseResolutionClaimId" = NULL
     WHERE id = $1
  `, [ids.refundOrder]);
  await setConstraintsImmediate(client);

  await expectPostgresError(
    client,
    "terminal_claim_mutation",
    () => client.query(`
      UPDATE public."CaseResolutionClaim"
         SET "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = 'case-invariant-proof-refund-claim'
    `),
    /Terminal CaseResolutionClaim is immutable/,
  );

  await client.query(`
    INSERT INTO public."CaseResolutionClaim" (
      id, "caseId", "orderId", "staffActorId", resolution,
      "refundAmountCents", currency, "stockRestorePlan", status,
      "idempotencyScope", "createdAt", "updatedAt"
    )
    VALUES (
      'case-invariant-proof-release-claim',
      $1, $2, $3, 'REFUND_PARTIAL',
      100, 'usd', '[]'::jsonb, 'PROVIDER_PENDING',
      'case-resolution:case-invariant-proof-release-claim',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.releaseCase, ids.releaseOrder, ids.staff]);
  await client.query(`
    UPDATE public."Order"
       SET "caseResolutionClaimId" =
           'case-invariant-proof-release-claim'
     WHERE id = $1
  `, [ids.releaseOrder]);
  await setConstraintsImmediate(client);

  await expectPostgresError(
    client,
    "unattested_no_effect_release",
    () => client.query(`
      UPDATE public."CaseResolutionClaim"
         SET status = 'RELEASED_NO_PROVIDER_EFFECT',
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = 'case-invariant-proof-release-claim'
    `),
    /CaseResolutionClaim_reconciliation_shape_check|CaseResolutionClaim_status_evidence_check/,
  );

  await client.query(`
    UPDATE public."CaseResolutionClaim"
       SET status = 'RELEASED_NO_PROVIDER_EFFECT',
           "reconciledAt" = CURRENT_TIMESTAMP,
           "reconciledById" = $1,
           "reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT',
           "reconciliationReason" =
             'Disposable proof confirms explicit administrator evidence.',
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = 'case-invariant-proof-release-claim'
  `, [ids.staff]);
  await client.query(`
    UPDATE public."Order"
       SET "caseResolutionClaimId" = NULL
     WHERE id = $1
  `, [ids.releaseOrder]);
  await setConstraintsImmediate(client);

  const terminalStates = await client.query(`
    SELECT status::text, pg_catalog.count(*)::integer AS count
      FROM public."CaseResolutionClaim"
     GROUP BY status
     ORDER BY status
  `);
  assert.deepEqual(
    terminalStates.rows.map((row) => [row.status, row.count]),
    [
      ["FINALIZED", 1],
      ["RELEASED_NO_PROVIDER_EFFECT", 1],
    ],
  );
}

async function provePrivatePosture(client) {
  for (const privateTable of [
    "CaseResolutionClaim",
    "CaseStripeDisputeApplication",
  ]) {
    const posture = await client.query(`
      SELECT
        class.relrowsecurity,
        class.relforcerowsecurity,
        (
          SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = class.oid
        ) AS policy_count,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime',
          class.oid,
          'SELECT,INSERT,UPDATE,DELETE'
        ) AS runtime_has_dml
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = $1
    `, [privateTable]);
    assert.deepEqual(posture.rows[0], {
      relrowsecurity: true,
      relforcerowsecurity: true,
      policy_count: 0,
      runtime_has_dml: false,
    });
  }

  await expectPostgresError(
    client,
    "runtime_direct_claim_read",
    async () => {
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query(
        'SELECT pg_catalog.count(*) FROM public."CaseResolutionClaim"',
      );
    },
    /permission denied for table CaseResolutionClaim/,
  );
  await expectPostgresError(
    client,
    "runtime_direct_dispute_application_read",
    async () => {
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query(
        'SELECT pg_catalog.count(*) FROM public."CaseStripeDisputeApplication"',
      );
    },
    /permission denied for table CaseStripeDisputeApplication/,
  );
  const identity = await client.query(
    "SELECT current_user AS current_user",
  );
  assert.equal(identity.rows[0]?.current_user, "ci");
}

export async function runCaseInvariantPostgresProof(env = process.env) {
  const { databaseUrl } = parseCaseInvariantProofConfig(env);
  const client = new Client({
    application_name: "grainline-case-invariant-proof",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 55_000,
    statement_timeout: 50_000,
  });
  await client.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query(readDraftTransactionBody(INVARIANT_DRAFT));
    await seedBaseFixtures(client);
    await proveCaseAndMessageInvariants(client);
    await proveStripeDisputeAuthority(client);
    await proveClaimLedger(client);
    await provePrivatePosture(client);
    await client.query("ROLLBACK");
    began = false;
    return Object.freeze({
      checks: 24,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-migration-plus-draft-rollback",
      status: "passed",
    });
  } finally {
    if (began) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCaseInvariantPostgresProof()
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
