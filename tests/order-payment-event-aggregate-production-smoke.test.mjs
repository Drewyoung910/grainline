import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CONFIRMATION,
  DEPLOYED_SOURCE_CI_RUN_ID,
  DEPLOYED_SOURCE_COMMIT,
  DEPLOYMENT_ID,
  EVIDENCE_DIRECTORY,
  PREDECESSOR_DEPLOYMENT_ID,
  PREDECESSOR_SOURCE_COMMIT,
  REQUIRED_ALIASES,
  REVIEWED_PROJECT,
  assertGitState,
  parseGitHubCiRun,
  parseVercelDeployment,
  sanitizedEvidence,
  validateConfiguration,
  validateLocalCredentials,
  validateRestartState,
} from "../scripts/order-payment-event-aggregate-production-smoke.mjs";

const commit = (character) => character.repeat(40);
const operatorCommit = commit("f");
const evidencePath = `${EVIDENCE_DIRECTORY}/order-payment-event-aggregate-production-smoke-${operatorCommit}.json`;
const config = { evidencePath, mainCiRunId: 33309999999, operatorCommit };

function ci(overrides = {}) {
  return {
    conclusion: "success",
    databaseId: config.mainCiRunId,
    event: "push",
    headBranch: "main",
    headSha: operatorCommit,
    status: "completed",
    workflowName: "CI",
    ...overrides,
  };
}

function deployment({ predecessor = false, overrides = {} } = {}) {
  return {
    alias: predecessor ? [] : [...REQUIRED_ALIASES],
    id: predecessor ? PREDECESSOR_DEPLOYMENT_ID : DEPLOYMENT_ID,
    meta: {
      gitCommitSha: predecessor ? PREDECESSOR_SOURCE_COMMIT : DEPLOYED_SOURCE_COMMIT,
    },
    project: { id: REVIEWED_PROJECT.projectId },
    readyState: "READY",
    target: "production",
    team: { id: REVIEWED_PROJECT.orgId },
    ...overrides,
  };
}

test("aggregate smoke pins exact clean main, CI, deployment, and evidence", () => {
  assert.equal(DEPLOYED_SOURCE_COMMIT, "4908bc7f377f5950da8de6b3398049d65a5fdfcb");
  assert.equal(DEPLOYED_SOURCE_CI_RUN_ID, 33307107247);
  assert.equal(DEPLOYMENT_ID, "dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj");
  assert.deepEqual(
    assertGitState(
      { branch: "main", head: operatorCommit, originMain: operatorCommit, status: "" },
      operatorCommit,
    ),
    { clean: true, exactMain: true, head: operatorCommit },
  );
  assert.deepEqual(
    assertGitState(
      { branch: "", head: operatorCommit, originMain: operatorCommit, status: "" },
      operatorCommit,
    ),
    { clean: true, exactMain: true, head: operatorCommit },
  );
  for (const state of [
    { branch: "feature", head: operatorCommit, originMain: operatorCommit, status: "" },
    { branch: "main", head: commit("e"), originMain: operatorCommit, status: "" },
    { branch: "main", head: operatorCommit, originMain: commit("e"), status: "" },
    { branch: "main", head: operatorCommit, originMain: operatorCommit, status: " M package.json" },
  ]) {
    assert.throws(() => assertGitState(state, operatorCommit));
  }

  assert.deepEqual(
    validateConfiguration({
      ORDER_PAYMENT_AGGREGATE_SMOKE_CONFIRM: CONFIRMATION,
      ORDER_PAYMENT_AGGREGATE_SMOKE_EVIDENCE_PATH: evidencePath,
      ORDER_PAYMENT_AGGREGATE_SMOKE_MAIN_CI_RUN_ID: String(config.mainCiRunId),
      ORDER_PAYMENT_AGGREGATE_SMOKE_OPERATOR_COMMIT: operatorCommit,
    }),
    config,
  );
  assert.throws(() => validateConfiguration({
    ORDER_PAYMENT_AGGREGATE_SMOKE_CONFIRM: "wrong",
    ORDER_PAYMENT_AGGREGATE_SMOKE_EVIDENCE_PATH: evidencePath,
    ORDER_PAYMENT_AGGREGATE_SMOKE_MAIN_CI_RUN_ID: String(config.mainCiRunId),
    ORDER_PAYMENT_AGGREGATE_SMOKE_OPERATOR_COMMIT: operatorCommit,
  }));
});

test("aggregate smoke rejects CI and deployment identity drift", () => {
  assert.deepEqual(
    parseGitHubCiRun(ci(), operatorCommit, config.mainCiRunId),
    { passed: true, runId: config.mainCiRunId },
  );
  for (const value of [
    ci({ conclusion: "failure" }),
    ci({ headSha: commit("e") }),
    ci({ headBranch: "feature" }),
    ci({ event: "pull_request" }),
  ]) {
    assert.throws(() => parseGitHubCiRun(value, operatorCommit, config.mainCiRunId));
  }

  const current = parseVercelDeployment(deployment(), {
    deploymentId: DEPLOYMENT_ID,
    requireAliases: true,
    sourceCommit: DEPLOYED_SOURCE_COMMIT,
  });
  assert.equal(current.sourceCommit, DEPLOYED_SOURCE_COMMIT);
  assert.equal(current.aliases.length, REQUIRED_ALIASES.length);
  assert.equal(
    parseVercelDeployment(deployment({ predecessor: true }), {
      deploymentId: PREDECESSOR_DEPLOYMENT_ID,
      requireAliases: false,
      sourceCommit: PREDECESSOR_SOURCE_COMMIT,
    }).ready,
    true,
  );
  for (const value of [
    deployment({ overrides: { readyState: "ERROR" } }),
    deployment({ overrides: { target: "preview" } }),
    deployment({ overrides: { meta: { gitCommitSha: commit("a") } } }),
    deployment({ overrides: { alias: REQUIRED_ALIASES.slice(1) } }),
    deployment({ overrides: { project: { id: "wrong" } } }),
  ]) {
    assert.throws(() => parseVercelDeployment(value, {
      deploymentId: DEPLOYMENT_ID,
      requireAliases: true,
      sourceCommit: DEPLOYED_SOURCE_COMMIT,
    }));
  }
});

test("aggregate smoke accepts only the reviewed Clerk and Redis identities", () => {
  const credentials = validateLocalCredentials({
    CLERK_SECRET_KEY: "sk_live_placeholder",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      "pk_live_Y2xlcmsudGhlZ3JhaW5saW5lLmNvbSQ",
    UPSTASH_REDIS_REST_TOKEN: "x".repeat(32),
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  });
  assert.equal(credentials.clerkFrontendApi, "clerk.thegrainline.com");
  assert.throws(() => validateLocalCredentials({
    CLERK_SECRET_KEY: "sk_test_forbidden",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      "pk_live_Y2xlcmsudGhlZ3JhaW5saW5lLmNvbSQ",
    UPSTASH_REDIS_REST_TOKEN: "x".repeat(32),
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  }));
});

test("aggregate smoke restart journal is exact and identifier-bounded", () => {
  const state = {
    version: 1,
    stage: "session-created",
    operatorCommit,
    mainCiRunId: config.mainCiRunId,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    signInTokenId: "sit_abc123",
    sessionId: "sess_abc123",
    startedAt: new Date().toISOString(),
  };
  assert.equal(validateRestartState(state, config), state);
  for (const changed of [
    { ...state, operatorCommit: commit("e") },
    { ...state, deploymentId: "dpl_wrong" },
    { ...state, sessionId: "wrong" },
    { ...state, signInTokenId: "wrong" },
  ]) {
    assert.throws(() => validateRestartState(changed, config));
  }
});

test("aggregate smoke is route-only, non-paying, non-migrating, and exercises the locked projection", () => {
  const source = fs.readFileSync(
    new URL("../scripts/order-payment-event-aggregate-production-smoke.mjs", import.meta.url),
    "utf8",
  );
  const reviewRoute = fs.readFileSync(
    new URL("../src/app/api/reviews/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /NOTIFICATION_CANARY_EXTERNAL_ID/);
  assert.match(source, /\/api\/reviews/);
  assert.match(source, /\/account/);
  assert.match(source, /resetUsedTokens\(userId\)/);
  assert.match(source, /revokeSession/);
  assert.match(source, /databaseFixturesCreated: 0/);
  assert.match(source, /paymentOrProviderObjectsCreated: 0/);
  assert.doesNotMatch(source, /from "stripe"|new Stripe|stripe\./);
  assert.doesNotMatch(source, /ALTER TABLE|prisma migrate|migrate deploy/i);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM/i);
  assert.match(reviewRoute, /o\."paymentRefundBlocked" = false/);
  assert.match(reviewRoute, /FOR UPDATE OF o/);
  assert.match(
    reviewRoute,
    /You can leave a review after your order has been delivered\./,
  );
});

test("sanitized smoke evidence retains only counts, boundaries, and release bindings", () => {
  const evidence = sanitizedEvidence({
    cleanup: {
      accountStateCacheDeleted: true,
      rateLimitTokensReset: true,
      revokedSessions: 1,
      unconsumedSignInTokenRevoked: true,
    },
    config,
    deployment: {
      current: { ready: true },
      health: true,
      predecessor: { ready: true },
    },
    result: {
      accountPageStatus: 200,
      authenticatedReviewDenialStatus: 403,
      authoritativeEligibilityReached: true,
      unauthenticatedReviewStatus: 401,
    },
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.result.reviewsCreated, 0);
  assert.equal(evidence.boundaries.productionDatabaseMutated, false);
  assert.equal(evidence.cleanup.clerkSessionsRevoked, true);
  assert.doesNotMatch(serialized, /user_|sess_|sit_|listingId|redis/i);
});
