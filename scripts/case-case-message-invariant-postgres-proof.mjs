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
const READ_MODE_DRAFT =
  "docs/rls-drafts/case-case-message-read-mode.sql";
const ACTIVATION_DRAFT =
  "docs/rls-drafts/case-case-message-activation.sql";
const ACTIVATION_ROLLBACK_DRAFT =
  "docs/rls-drafts/case-case-message-activation-rollback.sql";
const FORCE_DRAFT =
  "docs/rls-drafts/case-case-message-force.sql";
const FORCE_ROLLBACK_DRAFT =
  "docs/rls-drafts/case-case-message-force-rollback.sql";

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
  sellerRefundOrder: "case-invariant-proof-order-seller-refund",
  staffDismissOrder: "case-invariant-proof-order-staff-dismiss",
  staffRefundOrder: "case-invariant-proof-order-staff-refund",
  staffRetryOrder: "case-invariant-proof-order-staff-retry",
  staffReleaseOrder: "case-invariant-proof-order-staff-release",
  activationOrder: "case-invariant-proof-order-activation",
  ordinaryCase: "case-invariant-proof-case-ordinary",
  sourceCase: "case-invariant-proof-case-source",
  refundCase: "case-invariant-proof-case-refund",
  releaseCase: "case-invariant-proof-case-release",
  sellerRefundCase: "case-invariant-proof-case-seller-refund",
  staffDismissCase: "case-invariant-proof-case-staff-dismiss",
  staffRefundCase: "case-invariant-proof-case-staff-refund",
  staffRetryCase: "case-invariant-proof-case-staff-retry",
  staffReleaseCase: "case-invariant-proof-case-staff-release",
  activationCase: "case-invariant-proof-case-activation",
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
    ids.sellerRefundOrder,
    ids.staffDismissOrder,
    ids.staffRefundOrder,
    ids.staffRetryOrder,
    ids.staffReleaseOrder,
    ids.activationOrder,
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

async function expectLegacyPreflightError(
  client,
  name,
  seedInvalidLegacyState,
  pattern,
  draftBody,
) {
  await client.query("BEGIN");
  try {
    await seedBaseFixtures(client);
    await seedInvalidLegacyState();
    let caught;
    try {
      await client.query(draftBody);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `${name} unexpectedly passed the invariant preflight`);
    assert.match(safeError(caught), pattern, name);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function proveLegacyPreflightRejects(client, draftBody) {
  await expectLegacyPreflightError(
    client,
    "legacy_case_relationship_preflight",
    () => client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, "sellerRespondBy", "createdAt", "updatedAt"
      )
      VALUES (
        'case-invariant-proof-legacy-case',
        $1, $2, $3, 'OTHER',
        'Legacy relationship preflight fixture.',
        'OPEN', CURRENT_TIMESTAMP + INTERVAL '48 hours',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.ordinaryOrder, ids.buyer, ids.foreign]),
    /Case relationship preflight found incompatible rows/,
    draftBody,
  );

  await expectLegacyPreflightError(
    client,
    "legacy_message_author_preflight",
    async () => {
      await insertParticipantCase(
        client,
        ids.ordinaryCase,
        ids.ordinaryOrder,
      );
      await client.query(`
        INSERT INTO public."CaseMessage" (
          id, "caseId", "authorId", "authorKind", body, "createdAt"
        )
        VALUES (
          'case-invariant-proof-legacy-forged-message',
          $1, $2, 'BUYER',
          'Legacy forged-author preflight fixture.',
          CURRENT_TIMESTAMP
        )
      `, [ids.ordinaryCase, ids.foreign]);
    },
    /CaseMessage relationship preflight found incompatible rows/,
    draftBody,
  );
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

  await expectPostgresError(
    client,
    "forged_case_dispute_source",
    async () => {
      await client.query(`
        INSERT INTO public."OrderPaymentEvent" (
          id, "orderId", "stripeEventId", "stripeObjectId",
          "stripeObjectType", "eventType", currency, metadata,
          "createdAt", "updatedAt"
        )
        VALUES (
          'case-invariant-proof-forged-case-dispute-event',
          $1, 'evt_case_invariant_proof_forged_case_dispute',
          'dp_case_invariant_proof_forged', 'dispute', 'DISPUTE', 'usd',
          pg_catalog.jsonb_build_object(
            'chargeId', 'ch_wrong_case_invariant_proof',
            'disputeId', 'dp_case_invariant_proof_forged',
            'stripeEventType', 'charge.dispute.created',
            'stripeEventCreated', 1770000000
          ),
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [ids.sourceOrder]);
      await client.query(`
        INSERT INTO public."Case" (
          id, "orderId", "buyerId", "sellerId", reason, description,
          status, "sellerRespondBy", "openedByPaymentEventId",
          "createdAt", "updatedAt"
        )
        VALUES (
          'case-invariant-proof-forged-source-case',
          $1, $2, $3, 'OTHER', 'Forged dispute source.',
          'UNDER_REVIEW', CURRENT_TIMESTAMP + INTERVAL '48 hours',
          'case-invariant-proof-forged-case-dispute-event',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [ids.sourceOrder, ids.buyer, ids.seller]);
    },
    /Case webhook opening source is invalid/,
  );

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

async function proveSellerRefundAuthority(client) {
  const refundId = "re_case_invariant_seller_refund";
  const paymentEventId = "case-invariant-proof-seller-refund-event";
  await insertParticipantCase(
    client,
    ids.sellerRefundCase,
    ids.sellerRefundOrder,
  );
  await client.query(`
    UPDATE public."Order"
       SET "itemsSubtotalCents" = 10000,
           "shippingAmountCents" = 0,
           "giftWrappingPriceCents" = NULL,
           "taxAmountCents" = 0,
           "sellerRefundId" = $2,
           "sellerRefundAmountCents" = 10000,
           "sellerRefundLockedAt" = NULL
     WHERE id = $1
  `, [ids.sellerRefundOrder, refundId]);
  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", "amountCents", currency,
      status, reason, metadata, "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4::varchar(255),
      'refund', 'REFUND', 10000, 'usd',
      'succeeded', 'seller_refund',
      pg_catalog.jsonb_build_object(
        'localAction', 'SELLER_REFUND_RECORDED',
        'refundType', 'FULL',
        'refundIds', pg_catalog.jsonb_build_array($4::varchar(255))
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    paymentEventId,
    ids.sellerRefundOrder,
    `local:seller_refund_recorded:${refundId}`,
    refundId,
  ]);

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  await expectPostgresError(
    client,
    "forged_seller_refund_actor",
    () => client.query(`
      SELECT *
        FROM public.grainline_case_seller_refund_apply($1, $2)
    `, [ids.foreign, paymentEventId]),
    /Case seller-refund Order has invalid seller authority/,
  );
  const applied = await client.query(`
    SELECT *
      FROM public.grainline_case_seller_refund_apply($1, $2)
  `, [ids.seller, paymentEventId]);
  await client.query("RESET ROLE");
  assert.deepEqual(applied.rows, [{
    caseId: ids.sellerRefundCase,
    orderId: ids.sellerRefundOrder,
    sellerUserId: ids.seller,
    buyerUserId: ids.buyer,
    paymentEventId,
    action: "resolve",
  }]);
  await setConstraintsImmediate(client);

  const resolved = await client.query(`
    SELECT
      status::text,
      resolution::text,
      "refundAmountCents",
      "stripeRefundId",
      "resolvedById",
      "buyerMarkedResolved",
      "sellerMarkedResolved"
      FROM public."Case"
     WHERE id = $1
  `, [ids.sellerRefundCase]);
  assert.deepEqual(resolved.rows[0], {
    status: "RESOLVED",
    resolution: "REFUND_FULL",
    refundAmountCents: 10000,
    stripeRefundId: refundId,
    resolvedById: ids.seller,
    buyerMarkedResolved: false,
    sellerMarkedResolved: false,
  });

  const immutableEvidence = await client.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseSellerRefundApplication"
         WHERE "paymentEventId" = $1
           AND "caseId" = $2
           AND "orderId" = $3
           AND action = 'resolve'
      ) AS application_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."SystemAuditLog"
         WHERE action = 'CASE_SELLER_REFUND_APPLIED'
           AND metadata->>'orderPaymentEventId' = $1
           AND metadata->>'caseAction' = 'resolve'
      ) AS audit_count
  `, [paymentEventId, ids.sellerRefundCase, ids.sellerRefundOrder]);
  assert.deepEqual(immutableEvidence.rows[0], {
    application_count: 1,
    audit_count: 1,
  });

  // Model a later provider dispute reopening the Case. Replaying the old local
  // refund source must not resolve the newly active Case again.
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
  `, [ids.sellerRefundCase]);
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const replayed = await client.query(`
    SELECT *
      FROM public.grainline_case_seller_refund_apply($1, $2)
  `, [ids.seller, paymentEventId]);
  await client.query("RESET ROLE");
  assert.equal(replayed.rows[0]?.action, "replay");
  const replayState = await client.query(`
    SELECT status::text, resolution
      FROM public."Case"
     WHERE id = $1
  `, [ids.sellerRefundCase]);
  assert.deepEqual(replayState.rows[0], {
    status: "UNDER_REVIEW",
    resolution: null,
  });

  const invalidEventId = "case-invariant-proof-invalid-seller-refund-event";
  const invalidRefundId = "re_case_invariant_invalid_seller_refund";
  await client.query(`
    INSERT INTO public."OrderPaymentEvent" (
      id, "orderId", "stripeEventId", "stripeObjectId",
      "stripeObjectType", "eventType", "amountCents", currency,
      status, reason, metadata, "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4::varchar(255),
      'refund', 'REFUND', 9999, 'usd',
      'succeeded', 'seller_refund',
      pg_catalog.jsonb_build_object(
        'localAction', 'SELLER_REFUND_RECORDED',
        'refundType', 'PARTIAL',
        'refundIds', pg_catalog.jsonb_build_array($4::varchar(255))
      ),
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    invalidEventId,
    ids.sellerRefundOrder,
    `local:seller_refund_recorded:${invalidRefundId}`,
    invalidRefundId,
  ]);
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  await expectPostgresError(
    client,
    "forged_seller_refund_source",
    () => client.query(`
      SELECT *
        FROM public.grainline_case_seller_refund_apply($1, $2)
    `, [ids.seller, invalidEventId]),
    /Case seller-refund source is invalid/,
  );
  await client.query("RESET ROLE");
  const invalidResidue = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."CaseSellerRefundApplication"
     WHERE "paymentEventId" = $1
  `, [invalidEventId]);
  assert.equal(invalidResidue.rows[0]?.count, 0);
}

async function proveStaffResolutionAuthority(client) {
  for (const [caseId, orderId, paymentIntentId] of [
    [ids.staffDismissCase, ids.staffDismissOrder, null],
    [ids.staffRefundCase, ids.staffRefundOrder, "pi_case_staff_refund"],
    [ids.staffRetryCase, ids.staffRetryOrder, "pi_case_staff_retry"],
    [ids.staffReleaseCase, ids.staffReleaseOrder, "pi_case_staff_release"],
  ]) {
    await insertParticipantCase(client, caseId, orderId);
    await client.query(`
      UPDATE public."Order"
         SET "itemsSubtotalCents" = 10000,
             "shippingAmountCents" = 0,
             "giftWrappingPriceCents" = NULL,
             "taxAmountCents" = 0,
             "stripePaymentIntentId" = $2
       WHERE id = $1
    `, [orderId, paymentIntentId]);
  }
  await client.query(`
    UPDATE public."Listing"
       SET "listingType" = 'IN_STOCK',
           "stockQuantity" = 0,
           status = 'SOLD_OUT',
           "isPrivate" = false
     WHERE id = $1
  `, [ids.listing]);

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const dismissPrepare = await client.query(`
    SELECT public.grainline_case_staff_resolution_prepare(
      $1,
      $2,
      'DISMISSED'::public."CaseResolution",
      NULL,
      '[]'::jsonb
    ) AS result
  `, [ids.staff, ids.staffDismissCase]);
  const dismissClaimId = dismissPrepare.rows[0]?.result?.claimId;
  assert.ok(dismissClaimId);
  assert.equal(dismissPrepare.rows[0]?.result?.status, "LOCAL_READY");
  assert.equal(dismissPrepare.rows[0]?.result?.action, "prepared");

  const dismissReplay = await client.query(`
    SELECT public.grainline_case_staff_resolution_prepare(
      $1,
      $2,
      'DISMISSED'::public."CaseResolution",
      NULL,
      '[]'::jsonb
    ) AS result
  `, [ids.staff, ids.staffDismissCase]);
  assert.equal(dismissReplay.rows[0]?.result?.claimId, dismissClaimId);
  assert.equal(dismissReplay.rows[0]?.result?.action, "replay");

  await expectPostgresError(
    client,
    "forged_staff_resolution_finalizer",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_finalize($1, $2)
    `, [ids.foreign, dismissClaimId]),
    /Case staff-resolution finalizer is invalid/,
  );
  const dismissed = await client.query(`
    SELECT public.grainline_case_staff_resolution_finalize($1, $2) AS result
  `, [ids.staff, dismissClaimId]);
  assert.equal(dismissed.rows[0]?.result?.status, "FINALIZED");
  assert.equal(dismissed.rows[0]?.result?.resolution, "DISMISSED");
  const dismissFinalizeReplay = await client.query(`
    SELECT public.grainline_case_staff_resolution_finalize($1, $2) AS result
  `, [ids.staff, dismissClaimId]);
  assert.equal(dismissFinalizeReplay.rows[0]?.result?.action, "replay");
  await client.query("RESET ROLE");
  await setConstraintsImmediate(client);

  const dismissalState = await client.query(`
    SELECT
      case_row.status::text,
      case_row.resolution::text,
      case_row."resolvedById",
      case_row."refundAmountCents",
      case_row."stripeRefundId",
      claim.status::text AS claim_status,
      orders."caseResolutionClaimId" AS lease_id,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseMessage" AS message
         WHERE message.id = 'case_resolution_message_' || claim.id
           AND message."caseId" = case_row.id
           AND message."authorKind" = 'STAFF'
      ) AS message_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog" AS audit
         WHERE audit.action = 'RESOLVE_CASE'
           AND audit.metadata->>'resolutionClaimId' = claim.id
      ) AS audit_count
      FROM public."Case" AS case_row
      JOIN public."Order" AS orders ON orders.id = case_row."orderId"
      JOIN public."CaseResolutionClaim" AS claim
        ON claim."caseId" = case_row.id
     WHERE case_row.id = $1
  `, [ids.staffDismissCase]);
  assert.deepEqual(dismissalState.rows[0], {
    status: "RESOLVED",
    resolution: "DISMISSED",
    resolvedById: ids.staff,
    refundAmountCents: null,
    stripeRefundId: null,
    claim_status: "FINALIZED",
    lease_id: null,
    message_count: 1,
    audit_count: 1,
  });

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const refundPrepare = await client.query(`
    SELECT public.grainline_case_staff_resolution_prepare(
      $1,
      $2,
      'REFUND_FULL'::public."CaseResolution",
      NULL,
      '[]'::jsonb
    ) AS result
  `, [ids.staff, ids.staffRefundCase]);
  const refundClaimId = refundPrepare.rows[0]?.result?.claimId;
  assert.ok(refundClaimId);
  assert.equal(refundPrepare.rows[0]?.result?.refundAmountCents, 10000);
  assert.deepEqual(refundPrepare.rows[0]?.result?.stockRestorePlan, [{
    listingId: ids.listing,
    quantity: 1,
  }]);
  assert.match(
    refundPrepare.rows[0]?.result?.idempotencyScope ?? "",
    new RegExp(`^case-resolve:${refundClaimId}:REFUND_FULL:10000$`),
  );

  await expectPostgresError(
    client,
    "null_provider_outcome",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_provider_record(
        $1, $2, NULL::text,
        're_casestaffnulloutcome',
        ARRAY['re_casestaffnulloutcome']::text[],
        ARRAY['succeeded']::text[],
        NULL, NULL, false, false
      )
    `, [ids.staff, refundClaimId]),
    /Case provider-record input is invalid/,
  );
  await expectPostgresError(
    client,
    "ambiguous_provider_cannot_assert_refund",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_provider_record(
        $1, $2, 'AMBIGUOUS',
        're_case_staff_forged',
        ARRAY['re_case_staff_forged']::text[],
        ARRAY['succeeded']::text[],
        NULL, NULL, false, false
      )
    `, [ids.staff, refundClaimId]),
    /Ambiguous provider outcome cannot assert evidence/,
  );
  await expectPostgresError(
    client,
    "forged_provider_record_actor",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_provider_record(
        $1, $2, 'RECORDED',
        're_casestaffrefund',
        ARRAY['re_casestaffrefund']::text[],
        ARRAY['succeeded']::text[],
        'trr_casestaffrefund',
        10000,
        false,
        false
      )
    `, [ids.foreign, refundClaimId]),
    /Case provider-record actor is invalid/,
  );
  const providerRecorded = await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'RECORDED',
      're_casestaffrefund',
      ARRAY['re_casestaffrefund']::text[],
      ARRAY['succeeded']::text[],
      'trr_casestaffrefund',
      10000,
      false,
      false
    ) AS result
  `, [ids.staff, refundClaimId]);
  assert.equal(providerRecorded.rows[0]?.result?.status, "PROVIDER_RECORDED");
  const refundPaymentEventId =
    providerRecorded.rows[0]?.result?.paymentEventId;
  assert.ok(refundPaymentEventId);
  const providerReplay = await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'RECORDED',
      're_casestaffrefund',
      ARRAY['re_casestaffrefund']::text[],
      ARRAY['succeeded']::text[],
      'trr_casestaffrefund',
      10000,
      false,
      false
    ) AS result
  `, [ids.staff, refundClaimId]);
  assert.equal(providerReplay.rows[0]?.result?.action, "replay");

  const refundFinalized = await client.query(`
    SELECT public.grainline_case_staff_resolution_finalize($1, $2) AS result
  `, [ids.staff, refundClaimId]);
  assert.equal(refundFinalized.rows[0]?.result?.status, "FINALIZED");
  assert.equal(refundFinalized.rows[0]?.result?.resolution, "REFUND_FULL");
  await client.query("RESET ROLE");
  await setConstraintsImmediate(client);

  const refundState = await client.query(`
    SELECT
      case_row.status::text,
      case_row.resolution::text,
      case_row."refundAmountCents",
      case_row."stripeRefundId",
      orders."sellerRefundId",
      orders."sellerRefundAmountCents",
      orders."caseResolutionClaimId",
      claim.status::text AS claim_status,
      payment_event."stripeObjectId",
      payment_event."amountCents",
      payment_event.metadata->>'resolutionClaimId'
        AS payment_claim_id,
      listing."stockQuantity",
      listing.status::text AS listing_status
      FROM public."Case" AS case_row
      JOIN public."Order" AS orders ON orders.id = case_row."orderId"
      JOIN public."CaseResolutionClaim" AS claim
        ON claim."caseId" = case_row.id
      JOIN public."OrderPaymentEvent" AS payment_event
        ON payment_event.id = claim."orderPaymentEventId"
      JOIN public."Listing" AS listing ON listing.id = $2
     WHERE case_row.id = $1
  `, [ids.staffRefundCase, ids.listing]);
  assert.deepEqual(refundState.rows[0], {
    status: "RESOLVED",
    resolution: "REFUND_FULL",
    refundAmountCents: 10000,
    stripeRefundId: "re_casestaffrefund",
    sellerRefundId: "re_casestaffrefund",
    sellerRefundAmountCents: 10000,
    caseResolutionClaimId: null,
    claim_status: "FINALIZED",
    stripeObjectId: "re_casestaffrefund",
    amountCents: 10000,
    payment_claim_id: refundClaimId,
    stockQuantity: 1,
    listing_status: "ACTIVE",
  });

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const retryPrepare = await client.query(`
    SELECT public.grainline_case_staff_resolution_prepare(
      $1,
      $2,
      'REFUND_PARTIAL'::public."CaseResolution",
      1000,
      '[]'::jsonb
    ) AS result
  `, [ids.staff, ids.staffRetryCase]);
  const retryClaimId = retryPrepare.rows[0]?.result?.claimId;
  const retryScope = retryPrepare.rows[0]?.result?.idempotencyScope;
  assert.ok(retryClaimId);
  assert.ok(retryScope);
  const ambiguous = await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'AMBIGUOUS',
      NULL,
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL, NULL, false, false
    ) AS result
  `, [ids.staff, retryClaimId]);
  assert.equal(ambiguous.rows[0]?.result?.status, "RECONCILIATION_REQUIRED");
  const ambiguousReplay = await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'AMBIGUOUS',
      NULL,
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL, NULL, false, false
    ) AS result
  `, [ids.staff, retryClaimId]);
  assert.equal(ambiguousReplay.rows[0]?.result?.action, "ambiguous_replay");

  await expectPostgresError(
    client,
    "null_provider_reconciliation_action",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_reconcile(
        $1, $2, NULL::text, 'Null action must fail closed.'
      )
    `, [ids.staff, retryClaimId]),
    /Case reconciliation input is invalid/,
  );
  await expectPostgresError(
    client,
    "non_admin_provider_reconciliation",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_reconcile(
        $1, $2, 'RETRY_EXISTING_SCOPE', 'Forged non-admin retry.'
      )
    `, [ids.foreign, retryClaimId]),
    /Case reconciliation requires a current ADMIN/,
  );
  const retry = await client.query(`
    SELECT public.grainline_case_staff_resolution_reconcile(
      $1,
      $2,
      'RETRY_EXISTING_SCOPE',
      'Disposable proof retries the exact reviewed provider scope.'
    ) AS result
  `, [ids.staff, retryClaimId]);
  assert.equal(retry.rows[0]?.result?.idempotencyScope, retryScope);
  assert.equal(retry.rows[0]?.result?.status, "PROVIDER_PENDING");

  const retryRecorded = await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'RECORDED',
      're_casestaffretry',
      ARRAY['re_casestaffretry']::text[],
      ARRAY['succeeded']::text[],
      NULL, NULL, true, false
    ) AS result
  `, [ids.staff, retryClaimId]);
  assert.equal(retryRecorded.rows[0]?.result?.status, "PROVIDER_RECORDED");
  const retryFinalized = await client.query(`
    SELECT public.grainline_case_staff_resolution_finalize($1, $2) AS result
  `, [ids.staff, retryClaimId]);
  assert.equal(retryFinalized.rows[0]?.result?.status, "FINALIZED");

  const releasePrepare = await client.query(`
    SELECT public.grainline_case_staff_resolution_prepare(
      $1,
      $2,
      'REFUND_PARTIAL'::public."CaseResolution",
      500,
      '[]'::jsonb
    ) AS result
  `, [ids.staff, ids.staffReleaseCase]);
  const releaseClaimId = releasePrepare.rows[0]?.result?.claimId;
  assert.ok(releaseClaimId);
  await client.query(`
    SELECT public.grainline_case_staff_resolution_provider_record(
      $1, $2, 'AMBIGUOUS',
      NULL,
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL, NULL, false, false
    )
  `, [ids.staff, releaseClaimId]);
  const released = await client.query(`
    SELECT public.grainline_case_staff_resolution_reconcile(
      $1,
      $2,
      'CONFIRMED_NO_PROVIDER_EFFECT',
      'Disposable proof confirms no provider refund exists.'
    ) AS result
  `, [ids.staff, releaseClaimId]);
  assert.equal(released.rows[0]?.result?.status, "RELEASED_NO_PROVIDER_EFFECT");
  await expectPostgresError(
    client,
    "released_claim_cannot_finalize",
    () => client.query(`
      SELECT public.grainline_case_staff_resolution_finalize($1, $2)
    `, [ids.staff, releaseClaimId]),
    /Case finalization claim authority is invalid|not finalizable/,
  );
  await client.query("RESET ROLE");
  await setConstraintsImmediate(client);

  const reconciliationState = await client.query(`
    SELECT
      retry_claim.status::text AS retry_status,
      retry_order."caseResolutionClaimId" AS retry_lease,
      retry_order."sellerRefundId" AS retry_refund_id,
      retry_seller."manualStripeReconciliationNeeded"
        AS seller_reconciliation_needed,
      release_claim.status::text AS release_status,
      release_claim."reconciliationAction" AS release_action,
      release_order."caseResolutionClaimId" AS release_lease,
      release_order."sellerRefundId" AS release_refund_id,
      release_case.status::text AS release_case_status,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."OrderPaymentEvent" AS payment_event
         WHERE payment_event.metadata->>'resolutionClaimId' =
               release_claim.id
      ) AS release_payment_event_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog" AS audit
         WHERE audit.action =
               'RELEASE_CASE_RESOLUTION_NO_PROVIDER_EFFECT'
           AND audit."targetId" = release_claim.id
      ) AS release_audit_count
      FROM public."CaseResolutionClaim" AS retry_claim
      JOIN public."Order" AS retry_order
        ON retry_order.id = retry_claim."orderId"
      JOIN public."Case" AS retry_case
        ON retry_case.id = retry_claim."caseId"
      JOIN public."SellerProfile" AS retry_seller
        ON retry_seller."userId" = retry_case."sellerId"
      JOIN public."CaseResolutionClaim" AS release_claim
        ON release_claim.id = $2
      JOIN public."Order" AS release_order
        ON release_order.id = release_claim."orderId"
      JOIN public."Case" AS release_case
        ON release_case.id = release_claim."caseId"
     WHERE retry_claim.id = $1
  `, [retryClaimId, releaseClaimId]);
  assert.deepEqual(reconciliationState.rows[0], {
    retry_status: "FINALIZED",
    retry_lease: null,
    retry_refund_id: "re_casestaffretry",
    seller_reconciliation_needed: true,
    release_status: "RELEASED_NO_PROVIDER_EFFECT",
    release_action: "CONFIRMED_NO_PROVIDER_EFFECT",
    release_lease: null,
    release_refund_id: null,
    release_case_status: "OPEN",
    release_payment_event_count: 0,
    release_audit_count: 1,
  });
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
     WHERE id IN (
       'case-invariant-proof-refund-claim',
       'case-invariant-proof-release-claim'
     )
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
    "CaseSellerRefundApplication",
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
  await expectPostgresError(
    client,
    "runtime_direct_seller_refund_application_read",
    async () => {
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query(
        'SELECT pg_catalog.count(*) FROM public."CaseSellerRefundApplication"',
      );
    },
    /permission denied for table CaseSellerRefundApplication/,
  );
  const identity = await client.query(
    "SELECT current_user AS current_user",
  );
  assert.equal(identity.rows[0]?.current_user, "ci");
}

async function provePolicylessActivation(
  client,
  readModeBody,
  activationBody,
  activationRollbackBody,
  forceBody,
  forceRollbackBody,
) {
  await insertParticipantCase(
    client,
    ids.activationCase,
    ids.activationOrder,
  );

  await client.query(readModeBody);
  await client.query(activationBody);

  const activatedCatalog = await client.query(`
    SELECT
      class.relname,
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
      ) AS runtime_has_dml,
      pg_catalog.has_any_column_privilege(
        'grainline_app_runtime',
        class.oid,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS runtime_has_column_access
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
     ORDER BY class.relname
  `);
  assert.deepEqual(activatedCatalog.rows, [
    {
      relname: "Case",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policy_count: 0,
      runtime_has_dml: false,
      runtime_has_column_access: false,
    },
    {
      relname: "CaseMessage",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policy_count: 0,
      runtime_has_dml: false,
      runtime_has_column_access: false,
    },
    {
      relname: "CaseMessageAttachment",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policy_count: 0,
      runtime_has_dml: false,
      runtime_has_column_access: false,
    },
  ]);

  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const participantCase = await client.query(
    "SELECT * FROM public.grainline_case_get($1, $2)",
    [ids.buyer, ids.activationCase],
  );
  assert.equal(participantCase.rows.length, 1);
  assert.equal(participantCase.rows[0]?.id, ids.activationCase);

  const foreignCase = await client.query(
    "SELECT * FROM public.grainline_case_get($1, $2)",
    [ids.foreign, ids.activationCase],
  );
  assert.equal(foreignCase.rows.length, 0);

  const staffCase = await client.query(
    "SELECT * FROM public.grainline_case_get($1, $2)",
    [ids.staff, ids.activationCase],
  );
  assert.equal(staffCase.rows.length, 1);
  assert.equal(staffCase.rows[0]?.actsAsStaff, true);

  const exportPage = await client.query(`
    SELECT *
      FROM public.grainline_case_export_page(
        $1,
        NULL::timestamp,
        NULL::text,
        25
      )
  `, [ids.buyer]);
  assert.ok(
    exportPage.rows.some((row) => row.id === ids.activationCase),
    "activated participant export omitted the exact Case",
  );

  const reply = await client.query(`
    SELECT public.grainline_case_reply(
      $1,
      $2,
      'Policyless activation proof reply.',
      ARRAY[]::text[]
    ) AS result
  `, [ids.seller, ids.activationCase]);
  assert.equal(reply.rows[0]?.result?.caseId, ids.activationCase);
  assert.equal(reply.rows[0]?.result?.authorKind, "SELLER");
  await client.query("RESET ROLE");

  await expectPostgresError(
    client,
    "activated_runtime_direct_case_read",
    async () => {
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query(
        'SELECT id FROM public."Case" WHERE id = $1',
        [ids.activationCase],
      );
    },
    /permission denied for table Case/,
  );
  await expectPostgresError(
    client,
    "activated_runtime_direct_message_insert",
    async () => {
      await client.query("SET LOCAL ROLE grainline_app_runtime");
      await client.query(`
        INSERT INTO public."CaseMessage" (
          id, "caseId", "authorId", "authorKind", body, "createdAt"
        )
        VALUES (
          'case-invariant-proof-direct-activation-message',
          $1, $2, 'BUYER', 'Forged direct activation message.',
          CURRENT_TIMESTAMP
        )
      `, [ids.activationCase, ids.buyer]);
    },
    /permission denied for table CaseMessage/,
  );
  const identity = await client.query("SELECT current_user AS current_user");
  assert.equal(identity.rows[0]?.current_user, "ci");

  await client.query("SAVEPOINT case_force_candidate");
  await client.query(forceBody);
  const forced = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  `);
  assert.equal(forced.rows[0]?.count, 3);

  await client.query(forceRollbackBody);
  const forceRolledBack = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
  `);
  assert.equal(forceRolledBack.rows[0]?.count, 3);
  await client.query("RELEASE SAVEPOINT case_force_candidate");

  await client.query(activationRollbackBody);
  const rolledBackCatalog = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
       AND pg_catalog.has_table_privilege(
         'grainline_app_runtime',
         class.oid,
         'SELECT,INSERT,UPDATE,DELETE'
       )
  `);
  assert.equal(rolledBackCatalog.rows[0]?.count, 3);
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
    const draftBody = readDraftTransactionBody(INVARIANT_DRAFT);
    const readModeBody = readDraftTransactionBody(READ_MODE_DRAFT);
    const activationBody = readDraftTransactionBody(ACTIVATION_DRAFT);
    const activationRollbackBody = readDraftTransactionBody(
      ACTIVATION_ROLLBACK_DRAFT,
    );
    const forceBody = readDraftTransactionBody(FORCE_DRAFT);
    const forceRollbackBody = readDraftTransactionBody(FORCE_ROLLBACK_DRAFT);
    await proveLegacyPreflightRejects(client, draftBody);
    await client.query("BEGIN");
    began = true;
    await client.query(draftBody);
    await seedBaseFixtures(client);
    await proveCaseAndMessageInvariants(client);
    await proveStripeDisputeAuthority(client);
    await proveSellerRefundAuthority(client);
    await proveStaffResolutionAuthority(client);
    await proveClaimLedger(client);
    await provePrivatePosture(client);
    await provePolicylessActivation(
      client,
      readModeBody,
      activationBody,
      activationRollbackBody,
      forceBody,
      forceRollbackBody,
    );
    await client.query("ROLLBACK");
    began = false;
    return Object.freeze({
      checks: 54,
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
