import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CANONICAL_ALIASES,
  CONFIRMATION,
  CREDENTIAL_EPOCH_CUTOFF,
  CURRENT_DEPLOYMENT,
  DELETION_ORDER,
  EVIDENCE_DIRECTORY,
  MAX_REQUEST_SECONDS,
  RECOVERY_EVIDENCE_SHA256,
  SUPERSEDED_DEPLOYMENTS,
  assertGitState,
  parseConfiguration,
  parseGitHubCiRun,
  reconcileStateWithInventory,
  sanitizedEvidence,
  validateAcceptedEvidence,
  validateAliasResolution,
  validateDeploymentInspect,
  validateDeploymentInventory,
  validateHealth,
  validateInspectAbsentResult,
  validateState,
} from "../scripts/order-payment-event-credential-epoch-drain.mjs";

const operatorCommit = "f".repeat(40);
const evidencePath = `${EVIDENCE_DIRECTORY}/order-payment-event-credential-epoch-drain-${operatorCommit}.json`;

function configuration(overrides = {}) {
  return {
    ORDER_PAYMENT_EVENT_DRAIN_CONFIRM: CONFIRMATION,
    ORDER_PAYMENT_EVENT_DRAIN_OPERATOR_COMMIT: operatorCommit,
    ORDER_PAYMENT_EVENT_DRAIN_MAIN_CI_RUN_ID: "12345",
    ORDER_PAYMENT_EVENT_DRAIN_EVIDENCE_PATH: evidencePath,
    ...overrides,
  };
}

function row(deployment) {
  return {
    name: "grainline",
    url: deployment.url,
    state: "READY",
    target: "production",
    createdAt: deployment.createdAt,
    meta: { gitCommitSha: deployment.sourceCommit },
  };
}

function inventory(remaining = SUPERSEDED_DEPLOYMENTS) {
  return {
    contextName: "drew-youngs-projects",
    deployments: [
      row(CURRENT_DEPLOYMENT),
      ...remaining.map(row),
      row({
        createdAt: CREDENTIAL_EPOCH_CUTOFF - 1,
        sourceCommit: "a".repeat(40),
        url: "grainline-old-credential.vercel.app",
      }),
    ],
    pagination: { count: remaining.length + 2, next: CREDENTIAL_EPOCH_CUTOFF - 1 },
  };
}

function inspect(deployment, timeout = 300) {
  return {
    id: deployment.id,
    name: "grainline",
    url: deployment.url,
    target: "production",
    readyState: "READY",
    createdAt: deployment.createdAt,
    builds: [{ output: [{ lambda: { timeout } }] }],
  };
}

function restartState(removedDeploymentIds = []) {
  return {
    schemaVersion: 1,
    stage: removedDeploymentIds.length === DELETION_ORDER.length
      ? "removal-complete"
      : "removal-authorized",
    startedAt: "2026-08-30T20:00:00.000Z",
    operatorCommit,
    mainCiRunId: 12345,
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    targetDeploymentIds: DELETION_ORDER.map((item) => item.id),
    removedDeploymentIds,
  };
}

test("drain pins exact clean main, CI, confirmation and evidence path", () => {
  assert.deepEqual(parseConfiguration(configuration()), {
    evidencePath,
    mainCiRunId: 12345,
    operatorCommit,
  });
  assert.deepEqual(
    assertGitState({ branch: "main", head: operatorCommit, status: "" }, operatorCommit),
    { branch: "main", clean: true, head: operatorCommit },
  );
  assert.deepEqual(parseGitHubCiRun({
    databaseId: 12345,
    headSha: operatorCommit,
    conclusion: "success",
    status: "completed",
    workflowName: "CI",
  }, operatorCommit, 12345), { exactCommit: true, passed: true, runId: 12345 });
  assert.throws(() => parseConfiguration(configuration({ ORDER_PAYMENT_EVENT_DRAIN_CONFIRM: "no" })));
  assert.throws(() => assertGitState({ branch: "feature", head: operatorCommit, status: "" }, operatorCommit));
});

test("inventory pins the complete 12-deployment current credential epoch", () => {
  const result = validateDeploymentInventory(inventory(), {
    now: CURRENT_DEPLOYMENT.createdAt + (MAX_REQUEST_SECONDS + 1) * 1000,
  });
  assert.equal(result.currentDeploymentId, CURRENT_DEPLOYMENT.id);
  assert.equal(result.sharedCredentialPredecessors, 11);
  assert.deepEqual(result.observedPredecessorIds, SUPERSEDED_DEPLOYMENTS.map((item) => item.id));
});

test("inventory rejects new deployments, incomplete pagination and unexplained missing rows", () => {
  const extra = inventory();
  extra.deployments.unshift(row({
    createdAt: CURRENT_DEPLOYMENT.createdAt + 1,
    sourceCommit: "b".repeat(40),
    url: "grainline-unreviewed.vercel.app",
  }));
  assert.throws(() => validateDeploymentInventory(extra), /current credential-epoch/);

  const paged = inventory();
  paged.pagination.next = CREDENTIAL_EPOCH_CUTOFF;
  assert.throws(() => validateDeploymentInventory(paged), /complete credential epoch/);

  assert.throws(
    () => validateDeploymentInventory(inventory(SUPERSEDED_DEPLOYMENTS.slice(0, -1))),
    /inventory is incomplete/,
  );
});

test("restart inventory permits only an oldest-first missing prefix", () => {
  const oldest = DELETION_ORDER[0];
  const remaining = SUPERSEDED_DEPLOYMENTS.filter((item) => item.id !== oldest.id);
  const observed = validateDeploymentInventory(inventory(remaining), {
    allowReviewedMissing: true,
    now: Date.now(),
  });
  const reconciled = reconcileStateWithInventory(restartState(), observed);
  assert.deepEqual(reconciled.removedDeploymentIds, [oldest.id]);

  const middle = DELETION_ORDER[4];
  const hole = SUPERSEDED_DEPLOYMENTS.filter((item) => item.id !== middle.id);
  const holeInventory = validateDeploymentInventory(inventory(hole), {
    allowReviewedMissing: true,
    now: Date.now(),
  });
  assert.throws(
    () => reconcileStateWithInventory(restartState(), holeInventory),
    /removal order/,
  );
});

test("restart state pins the exact target set and removed prefix", () => {
  const first = DELETION_ORDER[0].id;
  assert.deepEqual(validateState(restartState([first]), {
    operatorCommit,
    mainCiRunId: 12345,
  }), restartState([first]));
  assert.throws(() => validateState({
    ...restartState(),
    targetDeploymentIds: DELETION_ORDER.slice(1).map((item) => item.id),
  }, { operatorCommit, mainCiRunId: 12345 }));
  assert.throws(() => validateState({
    ...restartState(),
    removedDeploymentIds: [DELETION_ORDER[1].id],
  }, { operatorCommit, mainCiRunId: 12345 }));
});

test("deployment, alias, health and absence checks fail closed", () => {
  assert.deepEqual(validateDeploymentInspect(inspect(CURRENT_DEPLOYMENT), CURRENT_DEPLOYMENT), {
    maxRequestSeconds: 300,
    ready: true,
  });
  assert.throws(() => validateDeploymentInspect(inspect(CURRENT_DEPLOYMENT, 301), CURRENT_DEPLOYMENT));
  assert.equal(validateAliasResolution({
    id: CURRENT_DEPLOYMENT.id,
    url: CURRENT_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
  }, CANONICAL_ALIASES[0]), true);
  assert.equal(validateHealth(200, { ok: true }), true);
  assert.throws(() => validateHealth(200, { ok: true, extra: true }));
  assert.equal(validateInspectAbsentResult({ status: 1, stderr: "Deployment not found" }), true);
  assert.throws(() => validateInspectAbsentResult({ status: 1, stderr: "network unavailable" }));
});

test("sanitized evidence records all 11 exact removals and no RLS claim", () => {
  const config = { evidencePath, mainCiRunId: 12345, operatorCommit };
  const value = sanitizedEvidence({
    config,
    inventoryBefore: { elapsedSeconds: 999, sharedCredentialPredecessors: 11 },
    recovery: { sha256: RECOVERY_EVIDENCE_SHA256 },
    startedAt: "2026-08-30T20:00:00.000Z",
  });
  assert.equal(value.deploymentDrain.removedDeployments.length, 11);
  assert.equal(value.deploymentDrain.sharedCredentialPredecessorsAfter, 0);
  assert.equal(value.orderPaymentEvent.zeroDirectAccessClaimed, false);
  assert.deepEqual(validateAcceptedEvidence(value, config), value);
  assert.throws(() => validateAcceptedEvidence({
    ...value,
    orderPaymentEvent: { ...value.orderPaymentEvent, zeroDirectAccessClaimed: true },
  }, config));
});

test("operator contains only exact-ID Vercel removal and no database mutation surface", () => {
  const source = fs.readFileSync("scripts/order-payment-event-credential-epoch-drain.mjs", "utf8");
  assert.match(source, /command\(vercelArgs\("remove", deployment\.id, "--yes"\)/);
  assert.doesNotMatch(source, /vercelArgs\("remove", VERCEL_PROJECT/);
  assert.doesNotMatch(source, /DATABASE_URL|DIRECT_URL|PRODUCTION_MIGRATION_DIRECT_URL|prisma migrate|ALTER TABLE|REVOKE|GRANT/);
  assert.match(source, /writePrivateJson\(STATE_PATH, state\)[\s\S]*for \(const deployment of DELETION_ORDER\)/);
});

test("documentation and package script preserve the separate activation gates", () => {
  const doc = fs.readFileSync("docs/order-payment-event-credential-epoch-drain.md", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.match(doc, /11\s+superseded READY Production\s+deployments/);
  assert.match(doc, /zero-direct-access gate remains separate/);
  assert.match(doc, /policyless `ENABLE`[\s\S]*separate\s+`FORCE`/i);
  assert.equal(
    pkg.scripts["ops:order-payment-event-credential-epoch-drain"],
    "node scripts/order-payment-event-credential-epoch-drain.mjs",
  );
});
