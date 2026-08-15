import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  AUTHORIZED_RESTART_PREDECESSOR,
  CANONICAL_ALIASES,
  CONFIRMATION,
  CURRENT_DEPLOYMENT,
  EVIDENCE_DIRECTORY,
  MAX_REQUEST_SECONDS,
  PREDECESSOR_DEPLOYMENT,
  assertGitState,
  parseConfiguration,
  parseGitHubCiRun,
  sanitizedEvidence,
  validateAliasResolution,
  validateDeploymentInspect,
  validateDeploymentInventory,
  validateHealth,
  validateInspectAbsentResult,
  validateState,
} from "../scripts/checkout-stock-reservation-predecessor-drain.mjs";

const operatorCommit = "f".repeat(40);
const evidencePath = `${EVIDENCE_DIRECTORY}/checkout-stock-reservation-predecessor-drain-${operatorCommit}.json`;

function configuration(overrides = {}) {
  return {
    CHECKOUT_STOCK_DRAIN_CONFIRM: CONFIRMATION,
    CHECKOUT_STOCK_DRAIN_OPERATOR_COMMIT: operatorCommit,
    CHECKOUT_STOCK_DRAIN_MAIN_CI_RUN_ID: "12345",
    CHECKOUT_STOCK_DRAIN_EVIDENCE_PATH: evidencePath,
    ...overrides,
  };
}

function row(deployment, extraMeta = {}) {
  return {
    name: "grainline",
    url: deployment.url,
    state: "READY",
    target: "production",
    createdAt: deployment.createdAt,
    meta: {
      gitCommitSha: deployment.sourceCommit,
      ...extraMeta,
    },
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

test("drain pins exact clean main, CI, evidence path and confirmation", () => {
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
  assert.throws(() => parseConfiguration(configuration({ CHECKOUT_STOCK_DRAIN_CONFIRM: "no" })));
  assert.throws(() => assertGitState({ branch: "feature", head: operatorCommit, status: "" }, operatorCommit));
  assert.throws(() => parseGitHubCiRun({
    databaseId: 12345,
    headSha: operatorCommit,
    conclusion: "failure",
    status: "completed",
    workflowName: "CI",
  }, operatorCommit, 12345));
});

test("inventory accepts exactly one current-credential predecessor after a full request drain", () => {
  const inventory = {
    contextName: "drew-youngs-projects",
    deployments: [
      row(CURRENT_DEPLOYMENT),
      row(PREDECESSOR_DEPLOYMENT, {
        grainlineCredentialRecovery: PREDECESSOR_DEPLOYMENT.credentialRecoveryMarker,
      }),
      {
        ...row({
          createdAt: PREDECESSOR_DEPLOYMENT.createdAt - 1,
          sourceCommit: "a".repeat(40),
          url: "grainline-older.vercel.app",
        }),
      },
    ],
  };
  const result = validateDeploymentInventory(
    inventory,
    CURRENT_DEPLOYMENT.createdAt + (MAX_REQUEST_SECONDS + 1) * 1000,
  );
  assert.equal(result.sharedCredentialPredecessors, 1);
  assert.equal(result.elapsedSeconds, MAX_REQUEST_SECONDS + 1);

  const extra = structuredClone(inventory);
  extra.deployments.splice(1, 0, {
    ...row({
      createdAt: CURRENT_DEPLOYMENT.createdAt - 1,
      sourceCommit: "b".repeat(40),
      url: "grainline-unreviewed.vercel.app",
    }),
  });
  assert.throws(() => validateDeploymentInventory(extra, Date.now()), /row 1 drifted/);
  assert.throws(
    () => validateDeploymentInventory(inventory, CURRENT_DEPLOYMENT.createdAt + 299_000),
    /maximum request drain/,
  );
});

test("deployment, alias, health and absence proofs all fail closed", () => {
  assert.deepEqual(validateDeploymentInspect(inspect(CURRENT_DEPLOYMENT), CURRENT_DEPLOYMENT), {
    maxRequestSeconds: 300,
    ready: true,
  });
  assert.throws(
    () => validateDeploymentInspect(inspect(CURRENT_DEPLOYMENT, 301), CURRENT_DEPLOYMENT),
    /timeout/,
  );
  assert.equal(validateAliasResolution({
    id: CURRENT_DEPLOYMENT.id,
    url: CURRENT_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
  }, CANONICAL_ALIASES[0]), true);
  assert.throws(() => validateAliasResolution({
    id: PREDECESSOR_DEPLOYMENT.id,
    url: PREDECESSOR_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
  }, CANONICAL_ALIASES[0]));
  assert.equal(validateHealth(200, { ok: true }), true);
  assert.throws(() => validateHealth(200, { ok: true, extra: true }));
  assert.equal(validateInspectAbsentResult({ status: 1, stderr: "Error: Could not find Deployment" }), true);
  assert.equal(validateInspectAbsentResult({
    status: 1,
    stderr: "Error: Can't find the deployment under the context",
  }), true);
  assert.equal(validateInspectAbsentResult({
    status: 1,
    stderr: "Error: Cannot find deployment",
  }), true);
  assert.throws(() => validateInspectAbsentResult({ status: 0, stdout: "{}" }));
  assert.throws(() => validateInspectAbsentResult({ status: 1, stderr: "network unavailable" }));
});

test("restart state accepts only the current release or exact failed authorized predecessor", () => {
  const base = {
    schemaVersion: 1,
    stage: "removal-authorized",
    startedAt: "2026-08-15T01:51:38.478Z",
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT.id,
  };
  const current = validateState({
    ...base,
    operatorCommit,
    mainCiRunId: 12345,
  }, { operatorCommit, mainCiRunId: 12345 });
  assert.equal(current.restartedFrom, null);

  const prior = validateState({
    ...base,
    operatorCommit: AUTHORIZED_RESTART_PREDECESSOR.operatorCommit,
    mainCiRunId: AUTHORIZED_RESTART_PREDECESSOR.mainCiRunId,
  }, { operatorCommit, mainCiRunId: 12345 });
  assert.deepEqual(prior.restartedFrom, AUTHORIZED_RESTART_PREDECESSOR);

  assert.throws(() => validateState({
    ...base,
    operatorCommit: AUTHORIZED_RESTART_PREDECESSOR.operatorCommit,
    mainCiRunId: AUTHORIZED_RESTART_PREDECESSOR.mainCiRunId + 1,
  }, { operatorCommit, mainCiRunId: 12345 }), /restart state drifted/);
  assert.throws(() => validateState({
    ...base,
    stage: "predecessor-removed",
    operatorCommit: AUTHORIZED_RESTART_PREDECESSOR.operatorCommit,
    mainCiRunId: AUTHORIZED_RESTART_PREDECESSOR.mainCiRunId,
  }, { operatorCommit, mainCiRunId: 12345 }), /restart state drifted/);
});

test("sanitized evidence records the drain without secrets or database mutations", () => {
  const evidence = sanitizedEvidence({
    config: { operatorCommit, mainCiRunId: 12345 },
    inventory: { elapsedSeconds: 900, sharedCredentialPredecessors: 1 },
    recovery: { sha256: "e".repeat(64) },
    restart: AUTHORIZED_RESTART_PREDECESSOR,
    startedAt: "2026-08-14T00:00:00.000Z",
  });
  assert.equal(evidence.deploymentDrain.predecessorRemoved, true);
  assert.equal(evidence.deploymentDrain.sharedCredentialPredecessorsAfter, 0);
  assert.equal(evidence.checkoutStockReservation.migrationsRun, false);
  assert.equal(evidence.checkoutStockReservation.rlsChanged, false);
  assert.equal(evidence.checkoutStockReservation.grantsChanged, false);
  assert.equal(evidence.secretsRetained, false);
  assert.deepEqual(evidence.restart, AUTHORIZED_RESTART_PREDECESSOR);
});

test("operator can only remove the exact predecessor and cannot mutate the database", () => {
  const source = fs.readFileSync(
    new URL("../scripts/checkout-stock-reservation-predecessor-drain.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /"remove", PREDECESSOR_DEPLOYMENT\.id, "--yes"/);
  assert.doesNotMatch(source, /vercelArgs\("remove", VERCEL_PROJECT/);
  assert.doesNotMatch(source, /prisma migrate|migrate deploy|ALTER TABLE|ROW LEVEL SECURITY|GRANT |REVOKE /i);
  assert.match(source, /database-credential-recovery-20260813\.json/);
  assert.match(source, /priorRejected !== true/);
  assert.match(source, /mode-0600 regular file/);
});
