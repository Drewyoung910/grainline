import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLERK_FRONTEND_API,
  CONFIRMATION,
  EVIDENCE_DIRECTORY,
  PRODUCTION_ORIGIN,
  RELEASE_BINDING,
  assertGitState,
  assertReleaseBinding,
  buildFixtureIds,
  parseDatabaseUrls,
  parseGitHubCiRun,
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
const evidencePath = `${EVIDENCE_DIRECTORY}/order-authenticated-route-smoke-${binding.commit}.json`;
const runtimeUrl = "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";
const ownerUrl = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech/neondb?sslmode=verify-full&channel_binding=require";

test("operator remains deployment-disabled until the exact corrected release exists", () => {
  assert.equal(RELEASE_BINDING, null);
  assert.throws(() => assertReleaseBinding(), /deployment-disabled/);
  assert.deepEqual(assertReleaseBinding(binding), binding);
});

test("configuration pins exact clean main, CI, deployment and fresh evidence", () => {
  assert.deepEqual(assertGitState({ branch: "main", head: binding.commit, status: "" }, binding), {
    branch: "main",
    clean: true,
    head: binding.commit,
  });
  assert.throws(() => assertGitState({ branch: "feature", head: binding.commit, status: "" }, binding));
  assert.deepEqual(parseGitHubCiRun({
    databaseId: binding.ciRunId,
    headSha: binding.commit,
    conclusion: "success",
    status: "completed",
    workflowName: "CI",
  }, binding), { exactCommit: true, passed: true, runId: binding.ciRunId });
  assert.deepEqual(validateConfiguration({
    ORDER_AUTH_ROUTE_SMOKE_CONFIRM: CONFIRMATION,
    ORDER_AUTH_ROUTE_SMOKE_COMMIT: binding.commit,
    ORDER_AUTH_ROUTE_SMOKE_CI_RUN_ID: String(binding.ciRunId),
    ORDER_AUTH_ROUTE_SMOKE_DEPLOYMENT_ID: binding.deploymentId,
    ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH: evidencePath,
  }, binding), { ...binding, evidencePath });
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
    commit: binding.commit,
    ciRunId: binding.ciRunId,
    deploymentId: binding.deploymentId,
    marker,
    stage: "seller-label",
    fixtureIds,
  }, binding);
  assert.equal(state.stageIndex, 2);
  assert.throws(() => validateRestartState({ ...state, stage: "unknown" }, binding));
  assert.throws(() => validateRestartState({ ...state, fixtureIds: { ...fixtureIds, listingId: "drift" } }, binding));
});

test("sanitized evidence retains only aggregate proof and cleanup posture", () => {
  const evidence = sanitizedEvidence({
    binding,
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

test("scaffold has no reachable provider, database mutation or RLS surface", () => {
  const source = readFileSync(
    new URL("../scripts/order-authenticated-route-smoke.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /export const RELEASE_BINDING = null/);
  assert.match(source, /route phases are not installed yet/);
  assert.doesNotMatch(source, /new Client\(/);
  assert.doesNotMatch(source, /new Stripe\(/);
  assert.doesNotMatch(source, /createClerkClient\(/);
  assert.doesNotMatch(source, /ALTER TABLE|ROW LEVEL SECURITY|prisma migrate|migrate deploy/i);
});
