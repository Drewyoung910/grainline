import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLERK_FRONTEND_API,
  CONFIRMATION,
  EVIDENCE_DIRECTORY,
  PRODUCTION_ORIGIN,
  REQUIRED_ALIASES,
  REVIEWED_PROJECT,
  RELEASE_BINDING,
  assertBuyerQuote,
  assertCheckoutRouteResult,
  assertFulfillmentRedirect,
  assertGitState,
  assertLabelPurchase,
  assertLabelRequote,
  assertPrivateLabelRedirect,
  assertReceiptRedirect,
  assertReleaseBinding,
  assertSeededOrderFixtureSnapshot,
  assertStableConflict,
  buildFixtureIds,
  parseDatabaseUrls,
  parseGitHubCiRun,
  parseVercelAliasInspection,
  parseVercelDeployment,
  sanitizedEvidence,
  shippingRateSubjectHash,
  validateConfiguration,
  validateProviderCredentials,
  validateRestartState,
} from "../scripts/order-authenticated-route-smoke.mjs";

const binding = Object.freeze({
  commit: "a".repeat(40),
  ciRunId: 12345,
  deploymentId: `dpl_${"B".repeat(24)}`,
  origin: PRODUCTION_ORIGIN,
});
const operator = Object.freeze({ commit: "c".repeat(40), ciRunId: 67890 });
const operatorConfig = Object.freeze({
  operatorCommit: operator.commit,
  operatorCiRunId: operator.ciRunId,
});
const evidencePath = `${EVIDENCE_DIRECTORY}/order-authenticated-route-smoke-${operator.commit}.json`;
const runtimeUrl = "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";
const ownerUrl = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";

test("operator pins the exact corrected application release separately from itself", () => {
  assert.deepEqual(assertReleaseBinding(), RELEASE_BINDING);
  assert.deepEqual(assertReleaseBinding(binding), binding);
  assert.notEqual(RELEASE_BINDING.commit, operator.commit);
});

test("configuration pins exact clean main, CI, deployment and fresh evidence", () => {
  assert.deepEqual(assertGitState({ branch: "main", head: operator.commit, status: "" }, operator.commit), {
    branch: "main",
    clean: true,
    head: operator.commit,
  });
  assert.throws(() => assertGitState({ branch: "feature", head: operator.commit, status: "" }, operator.commit));
  assert.deepEqual(parseGitHubCiRun({
    databaseId: operator.ciRunId,
    headSha: operator.commit,
    conclusion: "success",
    status: "completed",
    workflowName: "CI",
    headBranch: "main",
    event: "push",
  }, operator.commit, operator.ciRunId), { exactCommit: true, passed: true, runId: operator.ciRunId });
  assert.deepEqual(validateConfiguration({
    ORDER_AUTH_ROUTE_SMOKE_CONFIRM: CONFIRMATION,
    ORDER_AUTH_ROUTE_SMOKE_OPERATOR_COMMIT: operator.commit,
    ORDER_AUTH_ROUTE_SMOKE_OPERATOR_CI_RUN_ID: String(operator.ciRunId),
    ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH: evidencePath,
  }, binding), {
    cleanupOnly: false,
    evidencePath,
    operatorCiRunId: operator.ciRunId,
    operatorCommit: operator.commit,
    release: binding,
  });
  assert.throws(() => validateConfiguration({
    ORDER_AUTH_ROUTE_SMOKE_CONFIRM: CONFIRMATION,
    ORDER_AUTH_ROUTE_SMOKE_OPERATOR_COMMIT: operator.commit,
    ORDER_AUTH_ROUTE_SMOKE_OPERATOR_CI_RUN_ID: String(operator.ciRunId),
    ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH: evidencePath,
    ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY: "true",
  }, binding));
});

test("Vercel binding proves project, source and each independently resolved alias", () => {
  const deployment = {
    id: binding.deploymentId,
    target: "production",
    readyState: "READY",
    aliases: ["grainline-drew-youngs-projects.vercel.app"],
    meta: { gitCommitSha: binding.commit },
    project: { id: REVIEWED_PROJECT.projectId },
    team: { id: REVIEWED_PROJECT.orgId },
  };
  assert.equal(parseVercelDeployment(deployment, binding).sourceCommit, binding.commit);
  assert.throws(() => parseVercelDeployment({
    ...deployment,
    aliases: [],
  }, binding));
  for (const alias of REQUIRED_ALIASES) {
    assert.deepEqual(parseVercelAliasInspection({
      id: binding.deploymentId,
      target: "production",
      readyState: "READY",
    }, alias, binding), { alias, deploymentId: binding.deploymentId, ready: true });
  }
  assert.throws(() => parseVercelAliasInspection({
    id: `dpl_${"X".repeat(24)}`,
    target: "production",
    readyState: "READY",
  }, REQUIRED_ALIASES[0], binding));
});

test("database and provider identities refuse owner-runtime or live-mode drift", () => {
  assert.deepEqual(parseDatabaseUrls(
    { DATABASE_URL: runtimeUrl },
    { DIRECT_URL: ownerUrl },
  ), { ownerDatabaseUrl: ownerUrl, runtimeDatabaseUrl: runtimeUrl });
  assert.throws(() => parseDatabaseUrls({ DATABASE_URL: ownerUrl }, { DIRECT_URL: ownerUrl }));

  const provider = validateProviderCredentials({
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    SHIPPO_API_KEY: "shippo_test_placeholder",
    CLERK_SECRET_KEY: "sk_live_placeholder",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudGhlZ3JhaW5saW5lLmNvbSQ",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "x".repeat(32),
  });
  assert.equal(provider.shippoApiKey, "shippo_test_placeholder");
  assert.equal(CLERK_FRONTEND_API, "clerk.thegrainline.com");
  assert.throws(() => validateProviderCredentials({
    ...provider,
    STRIPE_SECRET_KEY: "sk_live_forbidden",
  }));
});

test("restart state is marker-bound, exact-release-bound and monotonic", () => {
  const marker = "f".repeat(32);
  const fixtureIds = buildFixtureIds(marker);
  const state = validateRestartState({
    version: 1,
    status: "running",
    operatorCommit: operator.commit,
    operatorCiRunId: operator.ciRunId,
    deployedCommit: binding.commit,
    deployedCiRunId: binding.ciRunId,
    deploymentId: binding.deploymentId,
    marker,
    stage: "seller-label",
    fixtureIds,
    routePhasesPassed: false,
    startedAt: "2026-01-01T12:00:00.000Z",
    canary: {
      userId: "canary-user",
      clerkUserId: "user_canary",
      originalTermsAcceptedAt: null,
      originalTermsVersion: null,
      originalAgeAttestedAt: null,
      originalNotificationPreferences: {},
      originalEmailPreferenceOptInAt: null,
      originalRole: "USER",
      sessionIds: ["sess_canary"],
    },
    checkoutSeller: {
      sellerProfileId: "seller-profile",
      userId: "seller-user",
      stripeAccountId: "acct_testSeller",
    },
    checkout: {
      reservationIds: ["reservation-id"],
      redisKeys: [
        "account-state:vercel-production:clerk:user_canary",
        `checkout:single:canary-user:listing:${fixtureIds.checkoutListingId}`,
      ],
      stripeSessionId: "cs_test_exact",
      signedExpiryObserved: true,
    },
    provider: { shippoTransactionId: null },
  }, operatorConfig, binding);
  assert.equal(state.stageIndex, undefined);
  state.stage = "cleanup";
  assert.equal(state.stage, "cleanup");
  assert.throws(() => validateRestartState({ ...state, stage: "unknown" }, operatorConfig, binding));
  assert.throws(() => validateRestartState({ ...state, startedAt: null }, operatorConfig, binding));
  assert.throws(() => validateRestartState({
    ...state,
    routePhasesPassed: true,
    stage: "seller-label",
  }, operatorConfig, binding));
  assert.throws(() => validateRestartState({ ...state, fixtureIds: { ...fixtureIds, listingId: "drift" } }, operatorConfig, binding));
  assert.throws(() => validateRestartState({
    ...state,
    checkout: { ...state.checkout, redisKeys: ["foreign:key"] },
  }, operatorConfig, binding));
});

test("restart seeding adopts only exact marker-bound Order fixture rows", () => {
  const marker = "e".repeat(32);
  const fixtureIds = buildFixtureIds(marker);
  const state = {
    marker,
    fixtureIds,
    canary: { userId: "canary-user" },
  };
  const immutableOrder = (id, buyerId, sellerProfileId, fulfillmentStatus, shipped) => ({
    id,
    buyerId,
    sellerProfileId,
    paid: true,
    currency: "usd",
    chargedTotalCents: 500,
    itemsSubtotalCents: 500,
    shippingAmountCents: 0,
    taxAmountCents: 0,
    buyerName: "Grainline Route Canary",
    shipToLine1: "123 Main St",
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    fulfillmentMethod: "SHIPPING",
    fulfillmentStatus,
    shipped,
    delivered: false,
    labelStatus: null,
    trackingCarrier: null,
    trackingNumber: null,
    sellerNotes: null,
  });
  const listingSnapshot = (listingId) => ({
    title: listingId,
    description: `Disposable authenticated Order fixture ${marker}`,
    priceCents: 500,
    imageUrls: [],
    category: "OTHER",
    tags: ["operator-canary"],
    sellerName: "Grainline Route Canary",
    capturedAt: "2026-09-02T12:00:00.000Z",
    listingType: "IN_STOCK",
    processingTimeMinDays: null,
    processingTimeMaxDays: null,
    shipsWithinDays: 2,
    shippingPackageComplete: true,
    shippingWeightGrams: 500,
    shippingLengthCm: 10,
    shippingWidthCm: 10,
    shippingHeightCm: 10,
  });
  const snapshot = {
    users: [
      {
        id: fixtureIds.syntheticBuyerUserId,
        clerkId: `order-route-buyer:${marker}`,
        email: `order-route-${marker}@example.invalid`,
        name: "Disposable Order Buyer",
        role: "USER",
        notificationPreferences: {},
        banned: false,
        deleted: false,
      },
      {
        id: fixtureIds.receiptSellerUserId,
        clerkId: `order-route-receipt-seller:${marker}`,
        email: `order-route-seller-${marker}@example.invalid`,
        name: "Disposable Receipt Seller",
        role: "USER",
        notificationPreferences: {},
        banned: false,
        deleted: false,
      },
    ],
    sellers: [
      {
        id: fixtureIds.canarySellerProfileId,
        userId: "canary-user",
        displayName: "Grainline Route Canary Shop",
        displayNameNormalized: "grainline route canary shop",
        vacationMode: true,
        acceptingNewOrders: false,
        onboardingComplete: false,
        chargesEnabled: false,
        stripeAccountId: null,
        useCalculatedShipping: false,
      },
      {
        id: fixtureIds.receiptSellerProfileId,
        userId: fixtureIds.receiptSellerUserId,
        displayName: "Disposable Receipt Shop",
        displayNameNormalized: "disposable receipt shop",
        vacationMode: true,
        acceptingNewOrders: false,
        onboardingComplete: false,
        chargesEnabled: false,
        stripeAccountId: null,
        useCalculatedShipping: false,
      },
    ],
    listings: [
      [fixtureIds.labelListingId, fixtureIds.canarySellerProfileId, 0],
      [fixtureIds.fulfillmentListingId, fixtureIds.canarySellerProfileId, 1],
      [fixtureIds.receiptListingId, fixtureIds.receiptSellerProfileId, 2],
    ].map(([id, sellerId, index]) => ({
      id,
      sellerId,
      title: `order-auth-route-${index}-${marker}`,
      priceCents: 500,
      priceVersion: 1,
      currency: "usd",
      status: "HIDDEN",
      listingType: "IN_STOCK",
      stockQuantity: 1,
      shipsWithinDays: 2,
      isPrivate: true,
      reservedForUserId: null,
      packagedWeightGrams: 500,
      packagedLengthCm: 10,
      packagedWidthCm: 10,
      packagedHeightCm: 10,
    })),
    orders: [
      immutableOrder(fixtureIds.labelOrderId, fixtureIds.syntheticBuyerUserId,
        fixtureIds.canarySellerProfileId, "PENDING", false),
      immutableOrder(fixtureIds.fulfillmentOrderId, fixtureIds.syntheticBuyerUserId,
        fixtureIds.canarySellerProfileId, "PENDING", false),
      immutableOrder(fixtureIds.receiptOrderId, "canary-user",
        fixtureIds.receiptSellerProfileId, "SHIPPED", true),
    ],
    items: [
      [fixtureIds.labelOrderItemId, fixtureIds.labelOrderId, fixtureIds.labelListingId,
        fixtureIds.canarySellerProfileId],
      [fixtureIds.fulfillmentOrderItemId, fixtureIds.fulfillmentOrderId,
        fixtureIds.fulfillmentListingId, fixtureIds.canarySellerProfileId],
      [fixtureIds.receiptOrderItemId, fixtureIds.receiptOrderId, fixtureIds.receiptListingId,
        fixtureIds.receiptSellerProfileId],
    ].map(([id, orderId, listingId, sellerProfileId]) => ({
      id,
      orderId,
      listingId,
      sellerProfileId,
      quantity: 1,
      priceCents: 500,
      listingSnapshot: listingSnapshot(listingId),
    })),
    suppressions: [{
      id: fixtureIds.syntheticBuyerSuppressionId,
      email: `order-route-${marker}@example.invalid`,
      reason: "BOUNCE",
      source: "order-authenticated-route-smoke",
      details: { markerBound: true },
    }],
  };
  assert.deepEqual(assertSeededOrderFixtureSnapshot(snapshot, state), { exact: true });
  const drifted = structuredClone(snapshot);
  drifted.listings[0].title = "foreign fixture";
  assert.throws(() => assertSeededOrderFixtureSnapshot(drifted, state));
});

test("route-result contracts bind the exact noncharging buyer quote and retry", () => {
  const subjectHash = "S".repeat(32);
  const rate = assertBuyerQuote({ rates: [{
    objectId: "quote-only:test-rate",
    amountCents: 1234,
    currency: "usd",
    label: "UPS Ground",
    carrier: "UPS",
    estDays: 3,
    subjectHash,
    token: "a".repeat(64),
    expiresAt: 2_000_000_000,
  }] }, subjectHash);
  assert.equal(rate.amountCents, 1234);
  assert.throws(() => assertBuyerQuote({ rates: [{ ...rate, subjectHash: "X".repeat(32) }] }, subjectHash));
  const sessionId = "cs_test_exact";
  assert.equal(assertCheckoutRouteResult({
    body: { clientSecret: `${sessionId}_secret_test`, reused: true, sessionId },
    expectedSessionId: sessionId,
    status: 200,
  }), sessionId);
  assert.throws(() => assertCheckoutRouteResult({
    body: { clientSecret: `${sessionId}_secret_test`, reused: false, sessionId },
    expectedSessionId: sessionId,
    status: 200,
  }));
});

test("seller label contracts reject synthetic rates and require private fresh download proof", () => {
  const fixedRate = assertLabelRequote({
    body: {
      requiresRateSelection: true,
      rates: [{ objectId: "shippo-fixed-rate", amountCents: 999, currency: "usd" }],
    },
    status: 202,
  });
  assert.equal(fixedRate.objectId, "shippo-fixed-rate");
  assert.throws(() => assertLabelRequote({
    body: {
      requiresRateSelection: true,
      rates: [{ objectId: "quote-only:bad", amountCents: 999, currency: "usd" }],
    },
    status: 202,
  }));
  assert.deepEqual(assertLabelPurchase({
    body: {
      ok: true,
      order: {
        id: "order",
        labelCarrier: "USPS",
        labelStatus: "PURCHASED",
        fulfillmentStatus: "SHIPPED",
      },
    },
    expectedOrderId: "order",
    status: 200,
  }), { fulfillmentStatus: "SHIPPED", labelStatus: "PURCHASED" });
  assert.deepEqual(assertPrivateLabelRedirect({
    cacheControl: "private, no-store, max-age=0",
    location: "https://provider.example/private-label",
    pragma: "no-cache",
    status: 302,
  }), { privateNoStore: true, status: 302 });
  assert.throws(() => assertPrivateLabelRedirect({
    cacheControl: "public",
    location: "https://provider.example/private-label",
    pragma: "no-cache",
    status: 302,
  }));
});

test("seller fulfillment and buyer receipt redirect only to their exact actor surfaces", () => {
  assert.deepEqual(assertFulfillmentRedirect({
    location: `${PRODUCTION_ORIGIN}/dashboard/sales/order-1`,
    orderId: "order-1",
    status: 303,
  }), { orderId: "order-1", status: 303 });
  assert.deepEqual(assertReceiptRedirect({
    location: `${PRODUCTION_ORIGIN}/dashboard/orders/order-2`,
    orderId: "order-2",
    status: 303,
  }), { orderId: "order-2", status: 303 });
  assert.throws(() => assertReceiptRedirect({
    location: `${PRODUCTION_ORIGIN}/dashboard/sales/order-2`,
    orderId: "order-2",
    status: 303,
  }));
  assert.deepEqual(assertStableConflict({
    body: { error: "stable" },
    status: 409,
  }, "stable"), { stableConflict: true, status: 409 });
  assert.throws(() => assertStableConflict({
    body: { error: "different" },
    status: 409,
  }, "stable"));
});

test("quantity package subjects are deterministic and quantity-bound", () => {
  const base = {
    mode: "single",
    listingId: "listing",
    variantKey: "",
    unitPriceCents: 500,
    priceVersion: 1,
    weight: 500,
    length: 10,
    width: 10,
    height: 10,
  };
  const one = shippingRateSubjectHash({ ...base, quantity: 1 });
  const two = shippingRateSubjectHash({ ...base, quantity: 2 });
  assert.match(one, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(one, shippingRateSubjectHash({ ...base, quantity: 1 }));
  assert.notEqual(one, two);
});

test("sanitized evidence retains only aggregate proof and cleanup posture", () => {
  const evidence = sanitizedEvidence({
    binding,
    operator,
    cleanup: {
      canaryRestored: true,
      checkoutSellerUnchanged: true,
      clerkSessionsRevoked: true,
      databaseFixturesDeleted: true,
      processedWebhookLeaseCount: 1,
      redisKeysDeleted: true,
    },
    result: {
      buyerQuantityTwoCheckoutPassed: true,
      sellerLabelPassed: true,
      sellerFulfillmentPassed: true,
      buyerReceiptPassed: true,
      stripeTestCheckoutSessions: 1,
      shippoTestTransactions: 1,
    },
    status: "passed",
  });
  assert.equal(evidence.productionChangedByProof, true);
  assert.equal(evidence.persistentMutableFixtureResidue, false);
  assert.equal(evidence.providerConfigurationChanged, false);
  assert.equal(evidence.result.providerModes.shippo, "test");
  assert.equal(evidence.cleanup.databaseFixturesDeleted, true);
  assert.equal(evidence.expectedRetainedDatabaseEvidence.processedStripeWebhookLeases, 1);
  assert.doesNotMatch(JSON.stringify(evidence), /ord-smoke-|postgresql:|sk_test_|shippo_test_/);
});

test("finished operator retains exact route, restart, cleanup and mutation boundaries", () => {
  const source = readFileSync(
    new URL("../scripts/order-authenticated-route-smoke.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /b22fa138d84bad792ba206ee00dacb48d475d4a4/);
  assert.match(source, /runBuyerPhase/);
  assert.match(source, /runSellerLabelPhase/);
  assert.match(source, /runSellerFulfillmentPhase/);
  assert.match(source, /runBuyerReceiptPhase/);
  assert.match(source, /cleanupFixtures/);
  assert.match(source, /new Client\(/);
  assert.match(source, /new Stripe\(/);
  assert.match(source, /createClerkClient\(/);
  assert.match(source, /status = "failed"/);
  assert.match(source, /unlinkSync\(STATE_PATH\)/);
  assert.doesNotMatch(source, /ALTER TABLE|ROW LEVEL SECURITY|prisma migrate|migrate deploy/i);
});
