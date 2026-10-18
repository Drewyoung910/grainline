import assert from "node:assert/strict";

let fixtureSequence = 0;

function fixtureSuffix(label) {
  fixtureSequence += 1;
  return `${label}_${fixtureSequence}`.replace(/[^a-z0-9_]/giu, "_").toLowerCase();
}

function scenarioId(base, namespace) {
  assert.match(namespace, /^[a-z0-9_]{1,32}$/u);
  return `${base}${namespace.replaceAll("_", "")}`;
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

async function ensureStaff(database) {
  const now = new Date("2026-10-16T12:00:00.000Z");
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
      ('full_chain_case_admin', 'user_full_chain_case_admin',
       'full-chain-case-admin@example.test', 'Full Chain Case Admin', 'ADMIN',
       $1, $1, $1, '2026-01-01', $1)
     ON CONFLICT (id) DO NOTHING`,
    [now],
  );
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
      ('full_chain_case_admin_2', 'user_full_chain_case_admin_2',
       'full-chain-case-admin-2@example.test', 'Second Full Chain Case Admin',
       'ADMIN', $1, $1, $1, '2026-01-01', $1)
     ON CONFLICT (id) DO NOTHING`,
    [now],
  );
  return "full_chain_case_admin";
}

async function seedCaseOrder(
  database,
  seller,
  {
    label,
    listingType = "MADE_TO_ORDER",
    fulfillmentStatus = "SHIPPED",
    openCase = true,
  },
) {
  const suffix = fixtureSuffix(label);
  const now = new Date();
  const buyerId = `full_chain_case_buyer_${suffix}`;
  const listingId = `full_chain_case_listing_${suffix}`;
  const orderId = `full_chain_case_order_${suffix}`;
  const orderItemId = `full_chain_case_item_${suffix}`;
  const stripeToken = suffix.replace(/[^a-z0-9]/giu, "");
  const stripeChargeId = `ch_fullchaincase${stripeToken}`;
  const stripePaymentIntentId = `pi_fullchaincase${stripeToken}`;
  const stripeTransferId = `tr_fullchaincase${stripeToken}`;
  const isInStock = listingType === "IN_STOCK";

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Full Chain Case Buyer', $4, $4, $4,
       '2026-01-01', $4)`,
    [
      buyerId,
      `user_full_chain_case_${suffix}`,
      `full-chain-case-${suffix}@example.test`,
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
     VALUES ($1, $2, 'Full-chain Case fixture', 'Disposable Case fixture',
       1000, 'usd', $3::public."ListingStatus", $4::public."ListingType", $5,
       $6, $7, $8, 'KITCHEN', ARRAY['fixture'], 1000, 30, 20, 10, $9, $9)`,
    [
      listingId,
      seller.sellerProfileId,
      isInStock ? "SOLD_OUT" : "ACTIVE",
      listingType,
      isInStock ? 0 : null,
      isInStock ? null : 7,
      isInStock ? null : 14,
      isInStock ? 2 : null,
      now,
    ],
  );

  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO public."Order"
        (id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
         "stripeSessionId", currency, "chargedTotalCents", "itemsSubtotalCents",
         "shippingAmountCents", "taxAmountCents", "giftWrappingPriceCents",
         "stripePaymentIntentId", "stripeChargeId", "stripeTransferId",
         "fulfillmentMethod", "fulfillmentStatus", "estimatedDeliveryDate",
         "shippedAt", "pickupReadyAt")
       VALUES ($1, $2, $3, $4, $4, $5, 'usd', 1300, 1000, 200, 100, 0,
         $6, $7, $8, $9::public."FulfillmentMethod",
         $10::public."FulfillmentStatus", $11, $12, $13)`,
      [
        orderId,
        buyerId,
        seller.sellerProfileId,
        now,
        `cs_fullchaincase${suffix}`,
        stripePaymentIntentId,
        stripeChargeId,
        stripeTransferId,
        fulfillmentStatus === "READY_FOR_PICKUP" ? "PICKUP" : "SHIPPING",
        fulfillmentStatus,
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
        fulfillmentStatus === "SHIPPED" ? now : null,
        fulfillmentStatus === "READY_FOR_PICKUP" ? now : null,
      ],
    );
    await database.query(
      `INSERT INTO public."OrderItem"
        (id, "orderId", "listingId", "sellerProfileId", quantity,
         "priceCents", "listingSnapshot", "createdAt")
       VALUES ($1, $2, $3, $4, 1, 1000,
         pg_catalog.jsonb_build_object(
           'title', 'Full-chain Case fixture',
           'imageUrls', pg_catalog.jsonb_build_array(
             'https://cdn.example.test/case-fixture.jpg'
           )
         ), $5)`,
      [orderItemId, orderId, listingId, seller.sellerProfileId, now],
    );
    await database.query("COMMIT");
  } catch (error) {
    try {
      await database.query("ROLLBACK");
    } catch {}
    throw error;
  }

  const opened = openCase
    ? await callJson(
      database,
      "grainline_case_open",
      [
        buyerId,
        orderId,
        "DAMAGED",
        "The piece arrived with a visible crack across the top.",
      ],
    )
    : null;
  if (opened) assert.equal(opened.action, "created");

  return Object.freeze({
    buyerId,
    caseId: opened?.caseId ?? null,
    listingId,
    orderId,
    stripeChargeId,
  });
}

async function prepareCaseRefund(database, fixture, adminId) {
  const prepared = await callJson(
    database,
    "grainline_case_staff_resolution_prepare",
    [adminId, fixture.caseId, "REFUND_FULL", null, JSON.stringify([])],
    ["", "", "", "", "::jsonb"],
  );
  assert.equal(prepared.action, "prepared");
  assert.equal(prepared.status, "PROVIDER_PENDING");
  await asRuntime(
    database,
    `SELECT * FROM public.grainline_case_staff_resolution_provider_clock(
       $1, $2, $3, $4, $5
     )`,
    [
      adminId,
      prepared.claimId,
      prepared.caseId,
      prepared.orderId,
      prepared.idempotencyScope,
    ],
  );
  return prepared;
}

async function recordAmbiguous(database, prepared, adminId) {
  return callJson(
    database,
    "grainline_case_staff_resolution_provider_record",
    [
      adminId,
      prepared.claimId,
      "AMBIGUOUS",
      null,
      [],
      [],
      null,
      null,
      false,
      false,
    ],
    ["", "", "", "", "::text[]", "::text[]"],
  );
}

async function recordRefund(database, prepared, adminId, refundId) {
  return callJson(
    database,
    "grainline_case_staff_resolution_provider_record",
    [
      adminId,
      prepared.claimId,
      "RECORDED",
      refundId,
      [refundId],
      ["succeeded"],
      `trr_${refundId.slice(3)}`,
      1150,
      false,
      false,
    ],
    ["", "", "", "", "::text[]", "::text[]"],
  );
}

async function beginWebhook(database, eventId, type, sourceObjectId) {
  const result = await asRuntime(
    database,
    `SELECT action, claim_generation
       FROM public.grainline_stripe_webhook_begin($1, $2, $3)`,
    [eventId, type, sourceObjectId],
  );
  const lease = result.rows[0];
  assert.equal(lease.action, "process");
  return lease.claim_generation;
}

async function applySignedRefund(
  database,
  fixture,
  { eventId, refundId, createdSeconds },
) {
  const generation = await beginWebhook(
    database,
    eventId,
    "charge.refunded",
    fixture.stripeChargeId,
  );
  const result = await asRuntime(
    database,
    `SELECT * FROM public.grainline_order_payment_signed_refund_apply(
       $1, $2::bigint, $3, $4::bigint, 1300, 'usd', $5, 1300,
       'succeeded', $4::bigint, 'requested_by_customer'
     )`,
    [eventId, String(generation), fixture.stripeChargeId, createdSeconds, refundId],
  );
  await callJson(
    database,
    "grainline_stripe_webhook_complete",
    [eventId, String(generation)],
    ["", "::bigint"],
  );
  return result.rows[0];
}

async function applySignedDispute(
  database,
  fixture,
  { eventId, type, disputeId, status, createdSeconds },
) {
  const generation = await beginWebhook(database, eventId, type, disputeId);
  const result = await asRuntime(
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
  );
  await callJson(
    database,
    "grainline_stripe_webhook_complete",
    [eventId, String(generation)],
    ["", "::bigint"],
  );
  return result.rows[0];
}

async function proveAmbiguousCaseRefundWebhook(
  database,
  seller,
  adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_710", namespace),
  });
  const prepared = await prepareCaseRefund(database, fixture, adminId);
  const ambiguous = await recordAmbiguous(database, prepared, adminId);
  assert.equal(ambiguous.status, "RECONCILIATION_REQUIRED");

  const createdSeconds = Math.floor(Date.now() / 1000);
  const eventId = scenarioId("evt_fullchaincase710", namespace);
  const refundId = scenarioId("re_fullchaincase710", namespace);
  const applied = await applySignedRefund(database, fixture, {
    eventId,
    refundId,
    createdSeconds,
  });
  assert.equal(applied.orderUpdated, false);

  const state = (await database.query(
    `SELECT orders."sellerRefundId" AS seller_refund_id,
            claim.status::text AS claim_status,
            payment.metadata->>'pendingLocalRefundLock' AS pending_local_lock,
            payment.metadata->>'caseResolutionClaimId' AS event_claim_id
       FROM public."Order" AS orders
       JOIN public."CaseResolutionClaim" AS claim
         ON claim.id = orders."caseResolutionClaimId"
       JOIN public."OrderPaymentEvent" AS payment
         ON payment."stripeEventId" = $2
      WHERE orders.id = $1`,
    [fixture.orderId, eventId],
  )).rows[0];
  assert.equal(
    state.seller_refund_id,
    "ambiguous_refund_pending_reconciliation",
  );
  assert.equal(state.claim_status, "RECONCILIATION_REQUIRED");
  assert.equal(state.pending_local_lock, "true");
  assert.equal(state.event_claim_id, prepared.claimId);
}

async function proveProviderPendingWebhookRetry(
  database,
  seller,
  adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_712", namespace),
  });
  const prepared = await prepareCaseRefund(database, fixture, adminId);
  await applySignedRefund(database, fixture, {
    eventId: scenarioId("evt_fullchaincase712", namespace),
    refundId: scenarioId("re_fullchaincase712", namespace),
    createdSeconds: Math.floor(Date.now() / 1000),
  });

  const replay = await callJson(
    database,
    "grainline_case_staff_resolution_prepare",
    [adminId, fixture.caseId, "REFUND_FULL", null, JSON.stringify([])],
    ["", "", "", "", "::jsonb"],
  );
  assert.equal(replay.action, "replay");
  assert.equal(replay.claimId, prepared.claimId);
  assert.equal(replay.status, "PROVIDER_PENDING");
}

export async function seedHistoricalAmbiguousMarkerDamage({
  database,
  seller,
  scenarioNamespace,
}) {
  const namespace = scenarioNamespace;
  assert.match(namespace, /^[a-z0-9_]{1,32}$/u);
  const adminId = await ensureStaff(database);
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_710_history", namespace),
  });
  const prepared = await prepareCaseRefund(database, fixture, adminId);
  const ambiguous = await recordAmbiguous(database, prepared, adminId);
  assert.equal(ambiguous.status, "RECONCILIATION_REQUIRED");
  const refundId = scenarioId("re_fullchaincase710history", namespace);
  const eventId = scenarioId("evt_fullchaincase710history", namespace);
  await applySignedRefund(database, fixture, {
    eventId,
    refundId,
    createdSeconds: Math.floor(Date.now() / 1000),
  });

  const damaged = (await database.query(
    `SELECT orders."sellerRefundId" AS seller_refund_id,
            claim.status::text AS claim_status,
            payment.metadata->>'pendingLocalRefundLock' AS pending_local_lock,
            payment.metadata->>'caseResolutionClaimId' AS event_claim_id
       FROM public."Order" AS orders
       JOIN public."CaseResolutionClaim" AS claim
         ON claim.id = orders."caseResolutionClaimId"
       JOIN public."OrderPaymentEvent" AS payment
         ON payment."stripeEventId" = $2
      WHERE orders.id = $1`,
    [fixture.orderId, eventId],
  )).rows[0];
  assert.deepEqual(damaged, {
    seller_refund_id: refundId,
    claim_status: "RECONCILIATION_REQUIRED",
    pending_local_lock: "false",
    event_claim_id: null,
  });

  await database.query("SET session_replication_role = replica");
  try {
    await database.query(
      `UPDATE public."CaseResolutionClaim"
          SET "createdAt" =
                pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
                - INTERVAL '2 hours'
        WHERE id = $1`,
      [prepared.claimId],
    );
  } finally {
    await database.query("SET session_replication_role = origin");
  }

  return Object.freeze({
    adminId,
    eventId,
    fixture,
    prepared,
    refundId,
  });
}

async function proveHistoricalAmbiguousMarkerRepair(database, damage) {
  const { adminId, fixture, prepared, refundId } = damage;

  const replay = await callJson(
    database,
    "grainline_case_staff_resolution_prepare",
    [adminId, fixture.caseId, "REFUND_FULL", null, JSON.stringify([])],
    ["", "", "", "", "::jsonb"],
  );
  assert.equal(replay.action, "replay");
  assert.equal(replay.status, "RECONCILIATION_REQUIRED");

  let state = (await database.query(
    `SELECT "sellerRefundId" AS seller_refund_id
       FROM public."Order"
      WHERE id = $1`,
    [fixture.orderId],
  )).rows[0];
  assert.equal(
    state.seller_refund_id,
    "ambiguous_refund_pending_reconciliation",
  );

  await database.query(
    `UPDATE public."Order"
        SET "sellerRefundId" = $2
      WHERE id = $1`,
    [fixture.orderId, refundId],
  );
  const successor = await callJson(
    database,
    "grainline_case_staff_resolution_provider_recovery_load",
    ["full_chain_case_admin_2", fixture.caseId, "REFUND_FULL", null],
  );
  assert.equal(successor.action, "recovery_required");
  assert.equal(successor.status, "RECONCILIATION_REQUIRED");

  state = (await database.query(
    `SELECT orders."sellerRefundId" AS seller_refund_id,
            (
              SELECT pg_catalog.count(*)::integer
                FROM public."AdminAuditLog" AS audit
               WHERE audit.action =
                     'REPAIR_CASE_REFUND_RECONCILIATION_MARKER'
                 AND audit."targetId" = $2
            ) AS repair_audit_count
       FROM public."Order" AS orders
      WHERE orders.id = $1`,
    [fixture.orderId, prepared.claimId],
  )).rows[0];
  assert.deepEqual(state, {
    seller_refund_id: "ambiguous_refund_pending_reconciliation",
    repair_audit_count: 2,
  });

  const health = await asRuntime(
    database,
    "SELECT * FROM public.grainline_order_ops_health_summary()",
  );
  assert.ok(Number(health.rows[0].stale_refund_claim_count) >= 1);
  assert.ok(Number(health.rows[0].issue_count) >= 1);
}

async function proveDisputePreservesCaseRefundLock(
  database,
  seller,
  adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_711", namespace),
  });
  const prepared = await prepareCaseRefund(database, fixture, adminId);
  await database.query(
    `UPDATE public."Order"
        SET "sellerRefundLockedAt" = "sellerRefundLockedAt" - INTERVAL '20 days'
      WHERE id = $1`,
    [fixture.orderId],
  );
  const disputeId = scenarioId("du_fullchaincase711", namespace);
  const nowSeconds = Math.floor(Date.now() / 1000);
  await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase711open", namespace),
    type: "charge.dispute.created",
    disputeId,
    status: "warning_needs_response",
    createdSeconds: nowSeconds - 60,
  });
  await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase711closed", namespace),
    type: "charge.dispute.closed",
    disputeId,
    status: "warning_closed",
    createdSeconds: nowSeconds - 30,
  });

  const state = (await database.query(
    `SELECT "sellerRefundLockedAt" IS NOT NULL AS refund_locked,
            "caseResolutionClaimId" AS claim_id
       FROM public."Order"
      WHERE id = $1`,
    [fixture.orderId],
  )).rows[0];
  assert.equal(state.claim_id, prepared.claimId);
  assert.equal(state.refund_locked, true);
}

async function proveStockPlanDoesNotStrandRefund(
  database,
  seller,
  adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_713", namespace),
    listingType: "IN_STOCK",
    fulfillmentStatus: "READY_FOR_PICKUP",
  });
  const prepared = await prepareCaseRefund(database, fixture, adminId);
  assert.deepEqual(prepared.stockRestorePlan, [
    { listingId: fixture.listingId, quantity: 1 },
  ]);
  await database.query(
    `UPDATE public."Listing"
        SET "listingType" = 'MADE_TO_ORDER',
            "stockQuantity" = NULL,
            "processingTimeMinDays" = 7,
            "processingTimeMaxDays" = 14,
            "shipsWithinDays" = NULL,
            status = 'ACTIVE',
            "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      WHERE id = $1`,
    [fixture.listingId],
  );
  const recorded = await recordRefund(
    database,
    prepared,
    adminId,
    scenarioId("re_fullchaincase713", namespace),
  );
  assert.equal(recorded.status, "PROVIDER_RECORDED");

  const finalized = await callJson(
    database,
    "grainline_case_staff_resolution_finalize",
    [adminId, prepared.claimId],
  );
  assert.equal(finalized.status, "FINALIZED");
  assert.equal(finalized.skippedStockRestoreCount, 1);

  const listing = (await database.query(
    `SELECT "listingType"::text AS listing_type,
            "stockQuantity" AS stock_quantity
       FROM public."Listing"
      WHERE id = $1`,
    [fixture.listingId],
  )).rows[0];
  assert.deepEqual(listing, {
    listing_type: "MADE_TO_ORDER",
    stock_quantity: null,
  });
}

async function proveSameSecondWonDispute(
  database,
  seller,
  _adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_714", namespace),
  });
  const disputeId = scenarioId("du_fullchaincase714", namespace);
  const nowSeconds = Math.floor(Date.now() / 1000);
  await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase714open", namespace),
    type: "charge.dispute.created",
    disputeId,
    status: "needs_response",
    createdSeconds: nowSeconds - 600,
  });
  const closed = await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase714closed", namespace),
    type: "charge.dispute.closed",
    disputeId,
    status: "won",
    createdSeconds: nowSeconds - 60,
  });
  assert.equal(closed.action, "applied");
  const reinstated = await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase714reinstated", namespace),
    type: "charge.dispute.funds_reinstated",
    disputeId,
    status: "won",
    createdSeconds: nowSeconds - 60,
  });
  assert.equal(reinstated.action, "same_second_recorded");

  const state = (await database.query(
    `SELECT "paymentOpenDisputeBlocked" AS open_dispute_blocked,
            "paymentConversionDisputeBlocked" AS conversion_dispute_blocked
       FROM public."Order"
      WHERE id = $1`,
    [fixture.orderId],
  )).rows[0];
  assert.deepEqual(state, {
    open_dispute_blocked: false,
    conversion_dispute_blocked: false,
  });
}

async function proveSameSecondCreatedDisputeRemainsVisible(
  database,
  seller,
  _adminId,
  namespace,
) {
  const fixture = await seedCaseOrder(database, seller, {
    label: scenarioId("audit_662_visibility", namespace),
    openCase: false,
  });
  const disputeId = scenarioId("du_fullchaincase662visibility", namespace);
  const createdSeconds = Math.floor(Date.now() / 1000) - 60;
  const withdrawn = await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase662withdrawn", namespace),
    type: "charge.dispute.funds_withdrawn",
    disputeId,
    status: "needs_response",
    createdSeconds,
  });
  assert.equal(withdrawn.action, "applied");

  const created = await applySignedDispute(database, fixture, {
    eventId: scenarioId("evt_fullchaincase662created", namespace),
    type: "charge.dispute.created",
    disputeId,
    status: "needs_response",
    createdSeconds,
  });
  assert.equal(created.action, "conflict_recorded");

  const state = (await database.query(
    `SELECT orders."reviewNeeded" AS review_needed,
            orders."reviewNote" AS review_note,
            (
              SELECT pg_catalog.count(*)::integer
                FROM public."Case" AS case_row
               WHERE case_row."orderId" = orders.id
            ) AS case_count
       FROM public."Order" AS orders
      WHERE orders.id = $1`,
    [fixture.orderId],
  )).rows[0];
  assert.equal(state.review_needed, true);
  assert.match(state.review_note, /conflicting dispute states/u);
  assert.equal(state.case_count, 0);
}

export async function proveCaseRefundRecoveryFindings({
  database,
  seller,
  historicalDamage,
  requireHistoricalDamage = false,
  scenarioNamespace,
}) {
  const namespace = scenarioNamespace;
  assert.match(namespace, /^[a-z0-9_]{1,32}$/u);
  if (requireHistoricalDamage) {
    assert.ok(
      historicalDamage,
      "the #710 predecessor must create historical damage before migration",
    );
  }
  const adminId = await ensureStaff(database);
  const scenarios = [
    ["#710 ambiguous Case refund webhook", proveAmbiguousCaseRefundWebhook],
    ["#712 provider-pending webhook retry", proveProviderPendingWebhookRetry],
    ["#711 terminal dispute lock preservation", proveDisputePreservesCaseRefundLock],
    ["#713 stale stock plan finalization", proveStockPlanDoesNotStrandRefund],
    ["#714 same-second won dispute", proveSameSecondWonDispute],
    [
      "#662 same-second dispute creation remains visible",
      proveSameSecondCreatedDisputeRemainsVisible,
    ],
  ];
  if (historicalDamage) {
    scenarios.splice(1, 0, [
      "#710 historical ambiguous marker repair",
      (sourceDatabase) =>
        proveHistoricalAmbiguousMarkerRepair(sourceDatabase, historicalDamage),
    ]);
  }
  const failures = [];
  for (const [name, scenario] of scenarios) {
    try {
      await scenario(database, seller, adminId, namespace);
    } catch (error) {
      failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `Case/refund recovery findings remain reproducible:\n${failures
        .map((failure) => failure.message)
        .join("\n")}`,
    );
  }
}
