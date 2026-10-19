import assert from "node:assert/strict";

let fixtureSequence = 0;

function scenarioSuffix(namespace, label) {
  assert.match(namespace, /^[a-z0-9_]{1,32}$/u);
  fixtureSequence += 1;
  return `${namespace}_${label}_${fixtureSequence}`
    .replace(/[^a-z0-9_]/giu, "_")
    .toLowerCase();
}

function providerToken(value) {
  return value.replace(/[^a-z0-9]/giu, "").slice(0, 80);
}

async function asRuntime(database, sql, params = []) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

async function callJson(database, name, args, casts = []) {
  const placeholders = args.map((_, index) => `$${index + 1}${casts[index] ?? ""}`);
  const result = await asRuntime(
    database,
    `SELECT public.${name}(${placeholders.join(", ")}) AS result`,
    args,
  );
  return result.rows[0].result;
}

async function seedOrder(database, seller, { namespace, label }) {
  const suffix = scenarioSuffix(namespace, label);
  const token = providerToken(suffix);
  const now = new Date();
  const buyerId = `full_chain_dispute_buyer_${suffix}`;
  const listingId = `full_chain_dispute_listing_${suffix}`;
  const orderId = `full_chain_dispute_order_${suffix}`;
  const itemId = `full_chain_dispute_item_${suffix}`;

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Full Chain Dispute Buyer', $4, $4, $4,
       '2026-01-01', $4)`,
    [
      buyerId,
      `user_full_chain_dispute_${suffix}`,
      `full-chain-dispute-${suffix}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "processingTimeMinDays",
       "processingTimeMaxDays", "shipsWithinDays", category, tags,
       "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
       "packagedHeightCm", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full-chain dispute fixture',
       'Disposable dispute fixture', 1000, 'usd', 'ACTIVE', 'MADE_TO_ORDER',
       NULL, 7, 14, NULL, 'KITCHEN', ARRAY['fixture'], 1000, 30, 20, 10,
       $3, $3)`,
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
         "fulfillmentMethod", "fulfillmentStatus", "estimatedDeliveryDate")
       VALUES ($1, $2, $3, $4, $4, $5, 'usd', 1300, 1000, 200, 100, 0,
         $6, $7, $8, 'SHIPPING', 'PENDING', $9)`,
      [
        orderId,
        buyerId,
        seller.sellerProfileId,
        now,
        `cs_fullchaindispute${token}`,
        `pi_fullchaindispute${token}`,
        `ch_fullchaindispute${token}`,
        `tr_fullchaindispute${token}`,
        new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      ],
    );
    await database.query(
      `INSERT INTO public."OrderItem"
        (id, "orderId", "listingId", "sellerProfileId", quantity,
         "priceCents", "listingSnapshot", "createdAt")
       VALUES ($1, $2, $3, $4, 1, 1000,
         pg_catalog.jsonb_build_object(
           'title', 'Full-chain dispute fixture',
           'imageUrls', pg_catalog.jsonb_build_array(
             'https://cdn.example.test/dispute-fixture.jpg'
           )
         ), $5)`,
      [itemId, orderId, listingId, seller.sellerProfileId, now],
    );
    await database.query("COMMIT");
  } catch (error) {
    try {
      await database.query("ROLLBACK");
    } catch {}
    throw error;
  }

  return Object.freeze({
    buyerId,
    orderId,
    stripeChargeId: `ch_fullchaindispute${token}`,
    token,
  });
}

async function beginWebhook(database, eventId, type, disputeId) {
  const result = await asRuntime(
    database,
    `SELECT action, claim_generation
       FROM public.grainline_stripe_webhook_begin($1, $2, $3)`,
    [eventId, type, disputeId],
  );
  assert.equal(result.rows[0].action, "process");
  return result.rows[0].claim_generation;
}

async function applyDispute(
  database,
  fixture,
  { eventId, type, disputeId, createdSeconds, status = "needs_response" },
) {
  const generation = await beginWebhook(database, eventId, type, disputeId);
  const result = (await asRuntime(
    database,
    `SELECT * FROM public.grainline_order_payment_signed_dispute_apply(
       $1, $2::bigint, $3, $4, $5::bigint, 1300, 'usd',
       'fraudulent', $6
     )`,
    [
      eventId,
      String(generation),
      fixture.stripeChargeId,
      disputeId,
      createdSeconds,
      status,
    ],
  )).rows[0];
  await callJson(
    database,
    "grainline_stripe_webhook_complete",
    [eventId, String(generation)],
    ["", "::bigint"],
  );
  return result;
}

async function countRows(database, sql, params = []) {
  return Number((await database.query(sql, params)).rows[0]?.count ?? 0);
}

async function createNotification(database, seller, fixture, eventId) {
  return (await database.query(
    `SELECT public.grainline_notification_create_core(
       pg_catalog.gen_random_uuid()::text,
       $1,
       'PAYMENT_DISPUTE'::public."NotificationType",
       'order_payment',
       $2,
       $3
     ) AS id`,
    [seller.userId, eventId, fixture.buyerId],
  )).rows[0]?.id ?? null;
}

export async function seedDisputeFirstEventPredecessorGap({
  database,
  seller,
  scenarioNamespace,
}) {
  const fixture = await seedOrder(database, seller, {
    namespace: scenarioNamespace,
    label: "historical",
  });
  const disputeId = `du_fullchain662${fixture.token}`;
  const createdSeconds = Math.floor(Date.now() / 1000) - 5;
  const fundsEventId = `evt_fullchain662funds${fixture.token}`;
  const createdEventId = `evt_fullchain662created${fixture.token}`;

  const funds = await applyDispute(database, fixture, {
    eventId: fundsEventId,
    type: "charge.dispute.funds_withdrawn",
    disputeId,
    createdSeconds,
  });
  assert.equal(funds.action, "applied");
  assert.equal(funds.caseId, null);
  assert.equal(funds.notificationAuthorized, false);

  const created = await applyDispute(database, fixture, {
    eventId: createdEventId,
    type: "charge.dispute.created",
    disputeId,
    createdSeconds,
  });
  assert.equal(created.action, "conflict_recorded");
  assert.equal(created.caseId, null);
  assert.equal(created.notificationAuthorized, false);
  assert.equal(
    await countRows(
      database,
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."CaseStripeDisputeApplication" AS application
         JOIN public."OrderPaymentEvent" AS payment
           ON payment.id = application."paymentEventId"
        WHERE payment."orderId" = $1
          AND payment."stripeObjectId" = $2`,
      [fixture.orderId, disputeId],
    ),
    0,
  );

  return Object.freeze({ ...fixture, disputeId, fundsEventId });
}

export async function proveDisputeFirstEventCaseCorrection({
  database,
  seller,
  historicalGap,
  scenarioNamespace,
}) {
  if (historicalGap) {
    const historical = (await database.query(
      `SELECT application.action,
              payment."stripeEventId" AS stripe_event_id,
              case_row.status::text AS case_status
         FROM public."CaseStripeDisputeApplication" AS application
         JOIN public."OrderPaymentEvent" AS payment
           ON payment.id = application."paymentEventId"
         JOIN public."Case" AS case_row ON case_row.id = application."caseId"
        WHERE application."orderId" = $1
          AND payment."stripeObjectId" = $2`,
      [historicalGap.orderId, historicalGap.disputeId],
    )).rows;
    assert.deepEqual(historical, [{
      action: "create",
      stripe_event_id: historicalGap.fundsEventId,
      case_status: "UNDER_REVIEW",
    }]);
    assert.equal(
      await countRows(
        database,
        `SELECT pg_catalog.count(*)::integer AS count
           FROM public."Notification"
          WHERE "userId" = $1
            AND type = 'PAYMENT_DISPUTE'
            AND "sourceType" = 'order_payment'
            AND "sourceId" = $2`,
        [seller.userId, historicalGap.fundsEventId],
      ),
      1,
    );
  }

  const fixture = await seedOrder(database, seller, {
    namespace: scenarioNamespace,
    label: "current",
  });
  const disputeId = `du_fullchain662${fixture.token}`;
  const createdSeconds = Math.floor(Date.now() / 1000) - 5;
  const fundsEventId = `evt_fullchain662funds${fixture.token}`;
  const createdEventId = `evt_fullchain662created${fixture.token}`;

  const funds = await applyDispute(database, fixture, {
    eventId: fundsEventId,
    type: "charge.dispute.funds_withdrawn",
    disputeId,
    createdSeconds,
  });
  assert.equal(funds.action, "applied");
  assert.equal(funds.caseAction, "create");
  assert.equal(funds.notificationAuthorized, true);
  assert.match(funds.caseId ?? "", /^[0-9a-f-]{36}$/iu);
  assert.ok(await createNotification(database, seller, fixture, fundsEventId));

  const created = await applyDispute(database, fixture, {
    eventId: createdEventId,
    type: "charge.dispute.created",
    disputeId,
    createdSeconds,
  });
  assert.equal(created.action, "same_second_recorded");
  assert.equal(created.caseId, null);
  assert.equal(created.notificationAuthorized, false);

  assert.equal(
    await countRows(
      database,
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."CaseStripeDisputeApplication" AS application
         JOIN public."OrderPaymentEvent" AS payment
           ON payment.id = application."paymentEventId"
        WHERE payment."orderId" = $1
          AND payment."stripeObjectId" = $2`,
      [fixture.orderId, disputeId],
    ),
    1,
  );
  assert.equal(
    await countRows(
      database,
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE "userId" = $1
          AND type = 'PAYMENT_DISPUTE'
          AND "sourceType" = 'order_payment'
          AND "sourceId" IN ($2, $3)`,
      [seller.userId, fundsEventId, createdEventId],
    ),
    1,
  );
}
