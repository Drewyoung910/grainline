import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CHECKOUT_PREDECESSOR =
  "20261015030000_preserve_blocked_checkout_refund_witness";
const RECONCILIATION_PREDECESSOR =
  "20260824040000_prepare_order_refund_reconciliation_authority";
const REPAIR = "20261015040000_repair_blocked_checkout_refund_recovery";

function replaceFunctionStatement(sql, name) {
  const markers = [
    `CREATE OR REPLACE FUNCTION public.${name}(`,
    `CREATE FUNCTION public.${name}(`,
  ];
  const start = markers
    .map((marker) => sql.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  assert.ok(Number.isInteger(start), `missing ${name} function`);
  const source = sql.slice(start);
  const delimiterMatch = source.match(/\nAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/u);
  assert.ok(delimiterMatch, `missing ${name} function delimiter`);
  const delimiter = `${delimiterMatch[1]};`;
  const bodyStart = start + delimiterMatch.index + delimiterMatch[0].length;
  const end = sql.indexOf(delimiter, bodyStart);
  assert.ok(end > bodyStart, `missing ${name} function terminator`);
  return sql
    .slice(start, end + delimiter.length)
    .replace(/^CREATE FUNCTION/u, "CREATE OR REPLACE FUNCTION");
}

async function asRuntime(database, sql, params = []) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

async function seedUser(database, { id, role = "USER" }) {
  const now = new Date();
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Blocked checkout recovery fixture', $4, $5, $5,
       $5, '2026-01-01', $5)`,
    [id, `user_${id}`, `${id}@example.test`, role, now],
  );
}

async function seedBlockedRefundFixture(database, seller, suffix) {
  const now = new Date();
  const buyerId = `full_chain_688_buyer_${suffix}`;
  const listingId = `full_chain_688_listing_${suffix}`;
  const orderId = `full_chain_688_order_${suffix}`;
  const eventId = `evt_fullchain688_${suffix}`;
  const sessionId = `cs_fullchain688_${suffix}`;
  const chargeId = `ch_fullchain688${suffix}`;

  await seedUser(database, { id: buyerId });
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "shipsWithinDays", category, tags,
       "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
       "packagedHeightCm", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Blocked checkout refund recovery fixture',
       'Disposable full-chain fixture', 500, 'usd', 'SOLD_OUT', 'IN_STOCK', 0,
       2, 'KITCHEN', ARRAY['fixture'], 1000, 30, 20, 10, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO public."Order"
        (id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
         "stripeSessionId", currency, "chargedTotalCents", "itemsSubtotalCents",
         "shippingAmountCents", "taxAmountCents", "giftWrappingPriceCents",
         "stripePaymentIntentId", "stripeChargeId", "stripeTransferId",
         "fulfillmentMethod", "fulfillmentStatus",
         "blockedCheckoutRefundRequiredAt", "reviewNeeded", "reviewNote")
       VALUES ($1, $2, $3, $4, $4, $5, 'usd', 1325, 1000, 200, 75, 50,
         $6, $7, $8, 'SHIPPING', 'PENDING', $4, true,
         'Checkout became ineligible after payment. Order was held for staff review.')`,
      [
        orderId,
        buyerId,
        seller.sellerProfileId,
        now,
        sessionId,
        `pi_fullchain688${suffix}`,
        chargeId,
        `tr_fullchain688${suffix}`,
      ],
    );
    await database.query(
      `INSERT INTO public."OrderItem"
        (id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents",
         "createdAt")
       VALUES ($1, $2, $3, $4, 2, 500, $5)`,
      [`${orderId}_item`, orderId, listingId, seller.sellerProfileId, now],
    );
    await database.query("COMMIT");
  } catch (error) {
    try {
      await database.query("ROLLBACK");
    } catch {}
    throw error;
  }

  await database.query(
    `INSERT INTO public."StripeWebhookEvent"
      (id, type, "sourceObjectId", "claimGeneration", "processingStartedAt",
       "createdAt", "updatedAt")
     VALUES ($1, 'checkout.session.completed', $2, 1, $3, $3, $3)`,
    [eventId, sessionId, now],
  );

  return { buyerId, chargeId, eventId, listingId, orderId, sessionId };
}

async function claimBlockedRefund(database, fixture) {
  const claim = (await asRuntime(
    database,
    `SELECT public.grainline_blocked_checkout_refund_claim_resume(
       $1, 1, $2, $3, 1325
     ) AS claim`,
    [fixture.eventId, fixture.sessionId, fixture.orderId],
  )).rows[0].claim;
  assert.equal(claim.action, "claimed");
  assert.equal(claim.refundAmountCents, 1325);
  return claim;
}

async function callExisting(database, fixture) {
  return (await asRuntime(
    database,
    `SELECT * FROM public.grainline_stripe_checkout_order_existing($1, 1, $2)`,
    [fixture.eventId, fixture.sessionId],
  )).rows[0];
}

async function applySignedRefundObservation(database, fixture, suffix) {
  const eventId = `evt_fullchain688refund${suffix}`;
  const refundId = `re_fullchain688${suffix}`;
  const eventCreatedSeconds = Math.floor(Date.now() / 1000) - 2;
  await database.query(
    `INSERT INTO public."StripeWebhookEvent"
      (id, type, "sourceObjectId", "claimGeneration", "processingStartedAt",
       "createdAt", "updatedAt")
     VALUES ($1, 'charge.refunded', $2, 1, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [eventId, fixture.chargeId],
  );
  const result = (await asRuntime(
    database,
    `SELECT * FROM public.grainline_order_payment_signed_refund_apply(
       $1, 1, $2, $3::bigint, 1325, 'usd', $4, 1325, 'succeeded',
       $5::bigint, NULL
     )`,
    [
      eventId,
      fixture.chargeId,
      String(eventCreatedSeconds),
      refundId,
      String(eventCreatedSeconds - 1),
    ],
  )).rows[0];
  assert.equal(result.action, "inserted");
  assert.equal(result.orderId, fixture.orderId);
  return { eventId, refundId, result };
}

async function authorizeExistingProviderEffect(database, adminId, claim) {
  const inspectedAtSeconds = Math.floor(Date.now() / 1000);
  return (await asRuntime(
    database,
    `SELECT public.grainline_order_refund_reconcile(
       $1, $2, $3::bigint, 'CONFIRMED_PROVIDER_EFFECT',
       'Verified the exact existing provider refund in Stripe.',
       $4::bigint, 'USABLE_REFUND', $5
     ) AS result`,
    [
      adminId,
      claim.claimId,
      String(claim.claimGeneration),
      String(inspectedAtSeconds),
      "a".repeat(64),
    ],
  )).rows[0].result;
}

async function recordExistingProviderRefund(
  database,
  reconciliation,
  claim,
  refundId,
) {
  return (await asRuntime(
    database,
    `SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
       $1, $2, $3::bigint, $4, 'succeeded',
       'trr_fullchain688repair', 1200
     ) AS result`,
    [
      reconciliation.reconciliationId,
      claim.claimId,
      String(claim.claimGeneration),
      refundId,
    ],
  )).rows[0].result;
}

export async function proveBlockedCheckoutRefundRecovery({
  database,
  repositoryRoot,
  seller,
}) {
  const migrationRoot = path.join(repositoryRoot, "prisma", "migrations");
  const checkoutPredecessor = fs.readFileSync(
    path.join(migrationRoot, CHECKOUT_PREDECESSOR, "migration.sql"),
    "utf8",
  );
  const reconciliationPredecessor = fs.readFileSync(
    path.join(migrationRoot, RECONCILIATION_PREDECESSOR, "migration.sql"),
    "utf8",
  );
  const repairSql = fs.readFileSync(
    path.join(migrationRoot, REPAIR, "migration.sql"),
    "utf8",
  );

  await database.query(replaceFunctionStatement(
    checkoutPredecessor,
    "grainline_stripe_checkout_order_existing",
  ));
  await database.query(replaceFunctionStatement(
    reconciliationPredecessor,
    "grainline_blocked_checkout_refund_reconciliation_record",
  ));

  const adminId = "full_chain_688_admin";
  await seedUser(database, { id: adminId, role: "ADMIN" });

  const stuck = await seedBlockedRefundFixture(database, seller, "stuck");
  await claimBlockedRefund(database, stuck);
  const stuckRefund = await applySignedRefundObservation(database, stuck, "stuck");
  assert.equal(stuckRefund.result.orderUpdated, false);
  assert.equal((await callExisting(database, stuck)).outcome, "processing");

  const alreadyRecorded = await seedBlockedRefundFixture(database, seller, "done");
  const completedRefund = await applySignedRefundObservation(
    database,
    alreadyRecorded,
    "done",
  );
  assert.equal(completedRefund.result.orderUpdated, true);
  assert.equal((await callExisting(database, alreadyRecorded)).outcome, "complete");

  const repair = await seedBlockedRefundFixture(database, seller, "repair");
  const repairClaim = await claimBlockedRefund(database, repair);
  const repairRefund = await applySignedRefundObservation(database, repair, "repair");
  assert.equal(repairRefund.result.orderUpdated, false);
  const reconciliation = await authorizeExistingProviderEffect(
    database,
    adminId,
    repairClaim,
  );
  assert.equal(reconciliation.action, "provider_effect_authorized");
  await database.query(
    `UPDATE public."StripeWebhookEvent"
        SET "claimGeneration" = 2,
            "processingStartedAt" = NULL,
            "processedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [repair.eventId],
  );
  await assert.rejects(
    recordExistingProviderRefund(
      database,
      reconciliation,
      repairClaim,
      repairRefund.refundId,
    ),
    (error) =>
      error?.code === "40001" &&
      /source event is not recoverable/u.test(error.message),
  );

  await database.query(repairSql);

  const resumed = await callExisting(database, stuck);
  assert.equal(resumed.outcome, "retry");
  assert.equal(resumed.order_id, stuck.orderId);
  assert.deepEqual(resumed.seller_user_ids, [seller.userId]);
  assert.equal((await callExisting(database, alreadyRecorded)).outcome, "complete");

  const recorded = await recordExistingProviderRefund(
    database,
    reconciliation,
    repairClaim,
    repairRefund.refundId,
  );
  assert.equal(recorded.action, "recorded");
  assert.equal(recorded.refundId, repairRefund.refundId);
  assert.equal(recorded.refundAmountCents, 1325);
  assert.equal(recorded.restoredActiveListingCount, 1);

  const replay = await recordExistingProviderRefund(
    database,
    reconciliation,
    repairClaim,
    repairRefund.refundId,
  );
  assert.equal(replay.action, "replay");
  assert.equal(replay.paymentEventId, recorded.paymentEventId);

  const after = (await database.query(
    `SELECT orders."sellerRefundId" AS refund_id,
            orders."refundClaimId" AS claim_id,
            orders."blockedCheckoutRefundRecordedAt" IS NOT NULL AS recorded,
            listing."stockQuantity" AS stock_quantity,
            listing.status::text AS listing_status,
            payment_event.metadata->>'refundClaimSourceGeneration'
              AS source_generation,
            (SELECT count(*)::integer
               FROM public."OrderPaymentEvent" AS payment_event
              WHERE payment_event."stripeEventId"
                = 'local:blocked_checkout_refund_recorded:' || $2)
              AS payment_event_count
       FROM public."Order" AS orders
       JOIN public."OrderItem" AS item ON item."orderId" = orders.id
       JOIN public."Listing" AS listing ON listing.id = item."listingId"
       JOIN public."OrderPaymentEvent" AS payment_event
         ON payment_event."stripeEventId"
              = 'local:blocked_checkout_refund_recorded:' || $2
      WHERE orders.id = $1`,
    [repair.orderId, repairRefund.refundId],
  )).rows[0];
  assert.deepEqual(after, {
    refund_id: repairRefund.refundId,
    claim_id: null,
    recorded: true,
    stock_quantity: 2,
    listing_status: "ACTIVE",
    source_generation: "2",
    payment_event_count: 1,
  });
}
