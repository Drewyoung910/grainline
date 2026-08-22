import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
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
  validateAcceptedEvidence,
  validateAliasResolution,
  validateDeploymentInspect,
  validateDeploymentInventory,
  validateHealth,
  validateInspectAbsentResult,
  validatePostRemovalInventory,
  validateState,
} from "../scripts/seller-payout-event-predecessor-drain.mjs";

const operatorCommit = "f".repeat(40);
const evidencePath = `${EVIDENCE_DIRECTORY}/seller-payout-event-predecessor-drain-${operatorCommit}.json`;

function configuration(overrides = {}) {
  return {
    SELLER_PAYOUT_DRAIN_CONFIRM: CONFIRMATION,
    SELLER_PAYOUT_DRAIN_OPERATOR_COMMIT: operatorCommit,
    SELLER_PAYOUT_DRAIN_MAIN_CI_RUN_ID: "12345",
    SELLER_PAYOUT_DRAIN_EVIDENCE_PATH: evidencePath,
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

function inventory() {
  return {
    contextName: "drew-youngs-projects",
    deployments: [
      row(CURRENT_DEPLOYMENT),
      row(PREDECESSOR_DEPLOYMENT),
      row({
        createdAt: PREDECESSOR_DEPLOYMENT.createdAt - 1,
        sourceCommit: "a".repeat(40),
        url: "grainline-older.vercel.app",
      }),
    ],
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
  assert.throws(() => parseConfiguration(configuration({ SELLER_PAYOUT_DRAIN_CONFIRM: "no" })));
  assert.throws(() => assertGitState({ branch: "feature", head: operatorCommit, status: "" }, operatorCommit));
  assert.throws(() => parseGitHubCiRun({
    databaseId: 12345,
    headSha: operatorCommit,
    conclusion: "failure",
    status: "completed",
    workflowName: "CI",
  }, operatorCommit, 12345));
});

test("inventory accepts exactly one current-credential predecessor after the request drain", () => {
  const result = validateDeploymentInventory(
    inventory(),
    CURRENT_DEPLOYMENT.createdAt + (MAX_REQUEST_SECONDS + 1) * 1000,
  );
  assert.equal(result.sharedCredentialPredecessors, 1);
  assert.equal(result.elapsedSeconds, MAX_REQUEST_SECONDS + 1);

  const extra = structuredClone(inventory());
  extra.deployments.splice(1, 0, row({
    createdAt: CURRENT_DEPLOYMENT.createdAt - 1,
    sourceCommit: "b".repeat(40),
    url: "grainline-unreviewed.vercel.app",
  }));
  assert.throws(() => validateDeploymentInventory(extra, Date.now()), /row 1 drifted/);
  assert.throws(
    () => validateDeploymentInventory(inventory(), CURRENT_DEPLOYMENT.createdAt + 299_000),
    /maximum request drain/,
  );
});

test("post-removal inventory rejects a surviving predecessor or newer pending deployment", () => {
  const after = inventory();
  after.deployments.splice(1, 1);
  assert.deepEqual(validatePostRemovalInventory(after), {
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    predecessorAbsent: true,
  });
  assert.throws(() => validatePostRemovalInventory(inventory()), /post-removal/);

  const pending = structuredClone(after);
  pending.deployments.unshift({
    name: "grainline",
    url: "grainline-new-building.vercel.app",
    state: "BUILDING",
    target: "production",
    createdAt: CURRENT_DEPLOYMENT.createdAt + 1,
    meta: { gitCommitSha: "b".repeat(40) },
  });
  assert.throws(() => validatePostRemovalInventory(pending), /post-removal/);
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
  assert.equal(validateInspectAbsentResult({ status: 1, stderr: "Error: Can't find the deployment" }), true);
  assert.equal(validateInspectAbsentResult({ status: 1, stderr: "Error: Cannot find deployment" }), true);
  assert.throws(() => validateInspectAbsentResult({ status: 0, stdout: "{}" }));
  assert.throws(() => validateInspectAbsentResult({ status: 1, stderr: "network unavailable" }));
});

test("restart state accepts only the exact current release", () => {
  const base = {
    schemaVersion: 1,
    stage: "removal-authorized",
    startedAt: "2026-08-22T00:00:00.000Z",
    operatorCommit,
    mainCiRunId: 12345,
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT.id,
  };
  assert.deepEqual(validateState(base, { operatorCommit, mainCiRunId: 12345 }), base);
  assert.deepEqual(
    validateState({ ...base, stage: "predecessor-removed" }, { operatorCommit, mainCiRunId: 12345 }),
    { ...base, stage: "predecessor-removed" },
  );
  assert.throws(
    () => validateState({ ...base, mainCiRunId: 12346 }, { operatorCommit, mainCiRunId: 12345 }),
    /restart state drifted/,
  );
  assert.throws(
    () => validateState({ ...base, stage: "unexpected" }, { operatorCommit, mainCiRunId: 12345 }),
    /restart state drifted/,
  );
});

test("sanitized evidence records deployment and source closure without secrets", () => {
  const authorityConsumers = [
    "src/app/api/account/export/route.ts",
    "src/app/dashboard/seller/page.tsx",
    "src/lib/stripePayoutWebhook.ts",
  ];
  const referenceFiles = [
    "src/app/api/account/export/route.ts",
    "src/app/dashboard/seller/page.tsx",
    "src/lib/accountExportPayload.ts",
    "src/lib/sellerPayoutEventAuthority.ts",
    "src/lib/sellerPayoutEventState.ts",
    "src/lib/stripePayoutWebhook.ts",
  ];
  const evidence = sanitizedEvidence({
    config: { operatorCommit, mainCiRunId: 12345 },
    deployedSourceAccess: {
      authorityConsumers,
      directAccessMatches: 0,
      referenceFiles,
      scannedFiles: 700,
      sourceCommit: CURRENT_DEPLOYMENT.sourceCommit,
    },
    inventory: { elapsedSeconds: 900, sharedCredentialPredecessors: 1 },
    recovery: { sha256: "ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943" },
    sourceAccess: {
      authorityConsumers,
      directAccessMatches: 0,
      referenceFiles,
      scannedFiles: 700,
    },
    startedAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(evidence.deploymentDrain.predecessorRemoved, true);
  assert.equal(evidence.deploymentDrain.sharedCredentialPredecessorsAfter, 0);
  assert.equal(evidence.applicationAuthority.zeroDirectAccess, true);
  assert.equal(evidence.applicationAuthority.operatorTree.directAccessMatches, 0);
  assert.equal(evidence.applicationAuthority.deployedTree.directAccessMatches, 0);
  assert.equal(evidence.sellerPayoutEvent.migrationsRun, false);
  assert.equal(evidence.sellerPayoutEvent.rlsChanged, false);
  assert.equal(evidence.sellerPayoutEvent.grantsChanged, false);
  assert.equal(evidence.secretsRetained, false);
  assert.deepEqual(
    validateAcceptedEvidence(evidence, { operatorCommit, mainCiRunId: 12345 }),
    evidence,
  );
  assert.throws(
    () => validateAcceptedEvidence({
      ...evidence,
      applicationAuthority: {
        ...evidence.applicationAuthority,
        operatorTree: {
          ...evidence.applicationAuthority.operatorTree,
          directAccessMatches: 1,
        },
      },
    }, { operatorCommit, mainCiRunId: 12345 }),
    /evidence drifted/,
  );
  assert.throws(
    () => sanitizedEvidence({
      config: { operatorCommit, mainCiRunId: 12345 },
      deployedSourceAccess: {
        authorityConsumers,
        directAccessMatches: 0,
        referenceFiles,
        scannedFiles: 700,
        sourceCommit: CURRENT_DEPLOYMENT.sourceCommit,
      },
      inventory: { elapsedSeconds: 900, sharedCredentialPredecessors: 1 },
      recovery: { sha256: "e".repeat(64) },
      sourceAccess: { authorityConsumers, directAccessMatches: 1, referenceFiles, scannedFiles: 700 },
      startedAt: "2026-08-22T00:00:00.000Z",
    }),
    /input drifted/,
  );
});

test("operator can remove only the exact predecessor and cannot mutate database or provider config", () => {
  const source = fs.readFileSync(
    new URL("../scripts/seller-payout-event-predecessor-drain.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /"remove", PREDECESSOR_DEPLOYMENT\.id, "--yes"/);
  assert.doesNotMatch(source, /vercelArgs\("remove", VERCEL_PROJECT/);
  assert.doesNotMatch(source, /prisma migrate|migrate deploy|ALTER TABLE|ROW LEVEL SECURITY|GRANT |REVOKE /i);
  assert.doesNotMatch(source, /vercelArgs\("env"|vercelArgs\("deploy"|vercelArgs\("alias"/);
  assert.match(source, /READY,BUILDING,QUEUED,INITIALIZING/);
  assert.match(source, /database-credential-recovery-20260813\.json/);
  assert.match(source, /priorRejected !== true/);
  assert.match(source, /mode-0600 regular file/);
});

test("documentation and CI preserve the non-mutating predecessor boundary", () => {
  const doc = fs.readFileSync("docs/seller-payout-event-predecessor-drain.md", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const strategy = fs.readFileSync("STRATEGY.md", "utf8");
  const architecture = fs.readFileSync("docs/architecture.md", "utf8");
  const matrix = fs.readFileSync("docs/rls-coverage-matrix.md", "utf8");

  assert.match(doc, /Status: prepared and locally proven only/);
  assert.match(doc, /No deployment has been removed/);
  assert.match(doc, /READY, BUILDING, QUEUED and\s+INITIALIZING/);
  assert.match(doc, /tracked source files/);
  assert.match(doc, /exact deployment removal is destructive/i);
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-zero-direct-access"],
    "node scripts/verify-seller-payout-event-zero-direct-access.mjs",
  );
  assert.equal(
    pkg.scripts["ops:seller-payout-event-predecessor-drain"],
    "node scripts/seller-payout-event-predecessor-drain.mjs",
  );
  assert.match(workflow, /Prove zero direct SellerPayoutEvent application access/);
  assert.match(strategy, /non-mutating predecessor boundary is now prepared/);
  assert.match(architecture, /No predecessor removal is yet claimed/);
  assert.match(matrix, /Exact-ID restart-safe drain execution remains outstanding/);
});
