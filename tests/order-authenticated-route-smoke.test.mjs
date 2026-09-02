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
  buildFixtureIds,
  parseDatabaseUrls,
  parseGitHubCiRun,
  parseVercelDeployment,
  sanitizedEvidence,
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
    evidencePath,
    operatorCiRunId: operator.ciRunId,
    operatorCommit: operator.commit,
    release: binding,
  });
});

test("Vercel binding proves project, source, READY production and every alias", () => {
  const deployment = {
    id: binding.deploymentId,
    target: "production",
    readyState: "READY",
    aliases: [...REQUIRED_ALIASES],
    meta: { gitCommitSha: binding.commit },
    project: { id: REVIEWED_PROJECT.projectId },
    team: { id: REVIEWED_PROJECT.orgId },
  };
  assert.equal(parseVercelDeployment(deployment, binding).sourceCommit, binding.commit);
  assert.throws(() => parseVercelDeployment({
    ...deployment,
    aliases: REQUIRED_ALIASES.slice(1),
  }, binding));
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
    operatorCommit: operator.commit,
    operatorCiRunId: operator.ciRunId,
    deployedCommit: binding.commit,
    deployedCiRunId: binding.ciRunId,
    deploymentId: binding.deploymentId,
    marker,
    stage: "seller-label",
    fixtureIds,
  }, operatorConfig, binding);
  assert.equal(state.stageIndex, 2);
  assert.throws(() => validateRestartState({ ...state, stage: "unknown" }, operatorConfig, binding));
  assert.throws(() => validateRestartState({ ...state, fixtureIds: { ...fixtureIds, listingId: "drift" } }, operatorConfig, binding));
});

test("route-result contracts bind the exact noncharging buyer quote and retry", () => {
  const subjectHash = "S".repeat(32);
  const rate = assertBuyerQuote({ rates: [{
    objectId: "quote-only:test-rate",
    amountCents: 1234,
    currency: "usd",
    subjectHash,
    token: "a".repeat(64),
    expiresAt: 2_000_000_000,
  }] }, subjectHash);
  assert.equal(rate.amountCents, 1234);
  assert.throws(() => assertBuyerQuote({ rates: [{ ...rate, subjectHash: "X".repeat(32) }] }, subjectHash));
  const sessionId = "cs_test_exact";
  assert.equal(assertCheckoutRouteResult({
    body: { reused: true, sessionId },
    expectedSessionId: sessionId,
    status: 200,
  }), sessionId);
  assert.throws(() => assertCheckoutRouteResult({
    body: { reused: false, sessionId },
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
});

test("sanitized evidence retains only aggregate proof and cleanup posture", () => {
  const evidence = sanitizedEvidence({
    binding,
    operator,
    cleanup: {
      canaryRestored: true,
      clerkSessionsRevoked: true,
      databaseFixturesDeleted: true,
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
  assert.equal(evidence.productionChangedByProof, false);
  assert.equal(evidence.result.providerModes.shippo, "test");
  assert.equal(evidence.cleanup.databaseFixturesDeleted, true);
  assert.doesNotMatch(JSON.stringify(evidence), /ord-smoke-|postgresql:|sk_test_|shippo_test_/);
});

test("release binding is installed while route mutations remain deployment-disabled", () => {
  const source = readFileSync(
    new URL("../scripts/order-authenticated-route-smoke.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /b22fa138d84bad792ba206ee00dacb48d475d4a4/);
  assert.match(source, /route phases are not installed yet/);
  assert.doesNotMatch(source, /new Client\(/);
  assert.doesNotMatch(source, /new Stripe\(/);
  assert.doesNotMatch(source, /createClerkClient\(/);
  assert.doesNotMatch(source, /ALTER TABLE|ROW LEVEL SECURITY|prisma migrate|migrate deploy/i);
});
