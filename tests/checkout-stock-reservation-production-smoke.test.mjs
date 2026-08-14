import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  COMPATIBLE_APP_CI_RUN_ID,
  COMPATIBLE_APP_COMMIT,
  CONFIRMATION,
  EVIDENCE_DIRECTORY,
  PRODUCTION_DEPLOYMENT_ID,
  assertGitState,
  parseDatabaseUrls,
  parseGitHubCiRun,
  sanitizedEvidence,
  validateConfiguration,
  validateProviderCredentials,
} from "../scripts/checkout-stock-reservation-production-smoke.mjs";

const operatorCommit = "f".repeat(40);
const evidencePath = `${EVIDENCE_DIRECTORY}/checkout-stock-reservation-production-smoke-${operatorCommit}.json`;
const runtimeUrl = "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";
const ownerUrl = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";

test("production smoke pins exact application, CI, deployment, clean main and evidence", () => {
  assert.equal(COMPATIBLE_APP_COMMIT, "84a58f0fc818b502564ef6bcd974ff4af3cc4395");
  assert.equal(COMPATIBLE_APP_CI_RUN_ID, 31822968848);
  assert.equal(PRODUCTION_DEPLOYMENT_ID, "dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw");
  assert.deepEqual(assertGitState({ branch: "main", head: operatorCommit, status: "" }, operatorCommit), {
    branch: "main",
    clean: true,
    head: operatorCommit,
  });
  for (const state of [
    { branch: "feature", head: operatorCommit, status: "" },
    { branch: "main", head: "e".repeat(40), status: "" },
    { branch: "main", head: operatorCommit, status: " M package.json" },
  ]) assert.throws(() => assertGitState(state, operatorCommit));

  assert.deepEqual(validateConfiguration({
    CHECKOUT_STOCK_SMOKE_CONFIRM: CONFIRMATION,
    CHECKOUT_STOCK_SMOKE_OPERATOR_COMMIT: operatorCommit,
    CHECKOUT_STOCK_SMOKE_MAIN_CI_RUN_ID: "12345",
    CHECKOUT_STOCK_SMOKE_EVIDENCE_PATH: evidencePath,
  }), { evidencePath, mainCiRunId: 12345, operatorCommit });
});

test("production smoke rejects CI, database and provider identity drift", () => {
  assert.deepEqual(parseGitHubCiRun({
    databaseId: 12345,
    headSha: operatorCommit,
    conclusion: "success",
    status: "completed",
    workflowName: "CI",
  }, operatorCommit, 12345), { exactCommit: true, passed: true, runId: 12345 });
  assert.throws(() => parseGitHubCiRun({
    databaseId: 12345,
    headSha: operatorCommit,
    conclusion: "failure",
    status: "completed",
    workflowName: "CI",
  }, operatorCommit, 12345));

  assert.deepEqual(parseDatabaseUrls(
    { DATABASE_URL: runtimeUrl },
    { DIRECT_URL: ownerUrl },
  ), { ownerDatabaseUrl: ownerUrl, runtimeDatabaseUrl: runtimeUrl });
  assert.throws(() => parseDatabaseUrls(
    { DATABASE_URL: ownerUrl },
    { DIRECT_URL: ownerUrl },
  ));

  const provider = {
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    CLERK_SECRET_KEY: "sk_live_placeholder",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudGhlZ3JhaW5saW5lLmNvbSQ",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "x".repeat(32),
  };
  assert.equal(validateProviderCredentials(provider).stripeSecret, "sk_test_placeholder");
  assert.throws(() => validateProviderCredentials({
    ...provider,
    STRIPE_SECRET_KEY: "sk_live_forbidden",
  }));
});

test("operator is exact-fixture, test-mode, restart-cleanable and non-activating", () => {
  const source = fs.readFileSync(
    new URL("../scripts/checkout-stock-reservation-production-smoke.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /NOTIFICATION_CANARY_EXTERNAL_ID/);
  assert.match(source, /sk_test_/);
  assert.match(source, /isPrivate[\s\S]{0,200}reservedForUserId/);
  assert.match(source, /grainline_checkout_reservation_buyer_expired_restore/);
  assert.match(source, /grainline_checkout_reservation_checkout_abort/);
  assert.match(source, /checkout\.session\.expired/);
  assert.match(source, /expectedRetainedProviderEvidence/);
  assert.match(source, /paidCompletionExercised: false/);
  assert.doesNotMatch(source, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY/i);
  assert.doesNotMatch(source, /prisma migrate|migrate deploy/i);
  assert.doesNotMatch(source, /DELETE FROM public\."StripeWebhookEvent"/);
});

test("sanitized evidence retains counts and boundaries but no fixture identifiers", () => {
  const evidence = sanitizedEvidence({
    cleanup: {
      sessionsExpired: true,
      signedExpiryProcessed: true,
      reservationsRestored: true,
      redisLocksDeleted: true,
      databaseFixturesDeleted: true,
      termsRestored: true,
      clerkSessionsRevoked: true,
      accountStateCacheDeleted: true,
    },
    config: { operatorCommit, mainCiRunId: 12345 },
    result: {
      checkoutSessionsCreated: 3,
      signedExpiryDeliveries: 3,
      paidCompletionExercised: false,
    },
    stage: "cleanup",
    status: "passed",
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.expectedRetainedProviderEvidence.expiredStripeTestCheckoutSessions, 3);
  assert.equal(evidence.result.paidCompletionExercised, false);
  assert.doesNotMatch(serialized, /buyer-|seller-|listing-|cart-|cs_test_/);
});
