import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANONICAL_ALIASES,
  CONFIRMATION,
  CREDENTIAL_EPOCH_CUTOFF,
  CURRENT_DEPLOYMENT,
  DEPLOYED_SOURCE_COMMIT,
  DRAIN_EVIDENCE_SHA256,
  EVIDENCE_DIRECTORY,
  MAX_REQUEST_SECONDS,
  assertGitState,
  parseConfiguration,
  parseGitHubCiRun,
  sanitizedEvidence,
  validateAcceptedEvidence,
  validateAliasResolution,
  validateDeploymentInspect,
  validateDeploymentInventory,
  validateDrainEvidence,
  validateHealth,
  validateZeroDirectTree,
} from "../scripts/order-payment-event-zero-direct-access-production-proof.mjs";
import {
  EXPECTED_AUTHORITY_CONSUMERS,
  EXPECTED_FIXED_OPERATIONS,
  EXPECTED_REFERENCE_FILES,
} from "../scripts/verify-order-payment-event-zero-direct-access.mjs";

const operatorCommit = "f".repeat(40);
const evidencePath = `${EVIDENCE_DIRECTORY}/order-payment-event-zero-direct-access-${operatorCommit}.json`;

function configuration(overrides = {}) {
  return {
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_CONFIRM: CONFIRMATION,
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_OPERATOR_COMMIT: operatorCommit,
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_MAIN_CI_RUN_ID: "12345",
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_EVIDENCE_PATH: evidencePath,
    ...overrides,
  };
}

function inventory() {
  return {
    contextName: "drew-youngs-projects",
    deployments: [
      {
        name: "grainline",
        url: CURRENT_DEPLOYMENT.url,
        state: "READY",
        target: "production",
        createdAt: CURRENT_DEPLOYMENT.createdAt,
        meta: { gitCommitSha: DEPLOYED_SOURCE_COMMIT },
      },
      {
        name: "grainline",
        url: "grainline-prior-epoch.vercel.app",
        state: "READY",
        target: "production",
        createdAt: CREDENTIAL_EPOCH_CUTOFF - 1,
        meta: { gitCommitSha: "a".repeat(40) },
      },
    ],
    pagination: { count: 2, next: CREDENTIAL_EPOCH_CUTOFF - 1 },
  };
}

function inspect(timeout = MAX_REQUEST_SECONDS) {
  return {
    id: CURRENT_DEPLOYMENT.id,
    name: "grainline",
    url: CURRENT_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
    createdAt: CURRENT_DEPLOYMENT.createdAt,
    builds: [{ output: [{ lambda: { timeout } }] }],
  };
}

function zeroDirectTree(sourceCommit) {
  return {
    sourceCommit,
    authorityConsumers: EXPECTED_AUTHORITY_CONSUMERS,
    directAccessMatches: 0,
    fixedOperations: EXPECTED_FIXED_OPERATIONS,
    referenceFiles: EXPECTED_REFERENCE_FILES,
    scannedFiles: EXPECTED_REFERENCE_FILES.length + 100,
  };
}

test("production proof pins confirmation, exact clean main, CI and evidence path", () => {
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
  assert.throws(() => parseConfiguration(configuration({
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_CONFIRM: "wrong",
  })));
  assert.throws(() => parseConfiguration(configuration({
    ORDER_PAYMENT_EVENT_ZERO_DIRECT_EVIDENCE_PATH: "/tmp/unreviewed.json",
  })));
  assert.throws(() => assertGitState({
    branch: "feature",
    head: operatorCommit,
    status: "",
  }, operatorCommit));
});

test("deployment inventory permits only the exact drained current credential epoch", () => {
  assert.deepEqual(validateDeploymentInventory(inventory()), {
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    currentSourceCommit: DEPLOYED_SOURCE_COMMIT,
    sharedCredentialPredecessors: 0,
  });

  const extra = inventory();
  extra.deployments.unshift({
    name: "grainline",
    url: "grainline-unreviewed.vercel.app",
    state: "READY",
    target: "production",
    createdAt: CURRENT_DEPLOYMENT.createdAt + 1,
    meta: { gitCommitSha: "b".repeat(40) },
  });
  assert.throws(() => validateDeploymentInventory(extra), /drained deployment epoch drifted/);

  const paged = inventory();
  paged.pagination.next = CREDENTIAL_EPOCH_CUTOFF;
  assert.throws(() => validateDeploymentInventory(paged), /complete credential epoch/);
});

test("deployment inspect, aliases and health fail closed", () => {
  assert.deepEqual(validateDeploymentInspect(inspect()), {
    maxRequestSeconds: MAX_REQUEST_SECONDS,
    ready: true,
  });
  assert.throws(() => validateDeploymentInspect(inspect(MAX_REQUEST_SECONDS + 1)));
  assert.equal(validateAliasResolution({
    id: CURRENT_DEPLOYMENT.id,
    url: CURRENT_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
  }, CANONICAL_ALIASES[0]), true);
  assert.throws(() => validateAliasResolution({
    id: "wrong",
    url: CURRENT_DEPLOYMENT.url,
    target: "production",
    readyState: "READY",
  }, CANONICAL_ALIASES[0]));
  assert.equal(validateHealth(200, { ok: true }), true);
  assert.throws(() => validateHealth(200, { ok: true, extra: true }));
});

test("tree and accepted evidence pin the complete closed authority inventory", () => {
  const deployed = zeroDirectTree(DEPLOYED_SOURCE_COMMIT);
  const operator = zeroDirectTree(operatorCommit);
  assert.deepEqual(validateZeroDirectTree(deployed, DEPLOYED_SOURCE_COMMIT), deployed);
  assert.throws(() => validateZeroDirectTree({
    ...deployed,
    fixedOperations: EXPECTED_FIXED_OPERATIONS.slice(1),
  }, DEPLOYED_SOURCE_COMMIT), /tree.*drifted/);

  const config = { evidencePath, mainCiRunId: 12345, operatorCommit };
  const value = sanitizedEvidence({
    config,
    deployed,
    drain: { removedPredecessors: 11, sha256: DRAIN_EVIDENCE_SHA256 },
    inventory: {
      currentDeploymentId: CURRENT_DEPLOYMENT.id,
      currentSourceCommit: DEPLOYED_SOURCE_COMMIT,
      sharedCredentialPredecessors: 0,
    },
    operator,
  });
  assert.equal(value.orderPaymentEvent.zeroDirectApplicationAccess, true);
  assert.equal(value.orderPaymentEvent.rlsChanged, false);
  assert.equal(value.orderPaymentEvent.grantsChanged, false);
  assert.deepEqual(validateAcceptedEvidence(value, config), value);
  assert.throws(() => validateAcceptedEvidence({
    ...value,
    production: { ...value.production, canonicalHealthPassed: false },
  }, config));
});

test("drain evidence and the production operator reject mutation surfaces", () => {
  assert.throws(
    () => validateDrainEvidence(Buffer.from("{}"), {}),
    /credential-epoch drain evidence drifted/,
  );
  const source = readFileSync(
    "scripts/order-payment-event-zero-direct-access-production-proof.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /vercelArgs\("remove"|prisma migrate|ALTER TABLE|ENABLE ROW LEVEL|FORCE ROW LEVEL|\bREVOKE\b|\bGRANT\b/iu);
  assert.doesNotMatch(source, /DATABASE_URL|DIRECT_URL|PRODUCTION_MIGRATION_DIRECT_URL/u);
  assert.match(source, /verifyOrderPaymentEventZeroDirectAccessAtCommit/);
  assert.match(source, /zeroDirectApplicationAccess: true/);
});

test("CI, package and durable records preserve the separate activation boundary", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const doc = readFileSync("docs/order-payment-event-zero-direct-access.md", "utf8");
  const matrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");
  const architecture = readFileSync("docs/architecture.md", "utf8");
  const strategy = readFileSync("STRATEGY.md", "utf8");

  assert.equal(
    pkg.scripts["audit:order-payment-event-zero-direct-access"],
    "node scripts/verify-order-payment-event-zero-direct-access.mjs",
  );
  assert.equal(
    pkg.scripts["ops:order-payment-event-zero-direct-access-production-proof"],
    "node scripts/order-payment-event-zero-direct-access-production-proof.mjs",
  );
  assert.match(
    ci,
    /Prove OrderPaymentEvent application zero-direct-access[\s\S]*audit:order-payment-event-zero-direct-access/u,
  );
  for (const record of [doc, matrix, architecture, strategy]) {
    assert.match(record, /seven[\s\S]{0,160}12[\s\S]{0,160}five/iu);
    assert.match(record, /policyless[\s\S]{0,160}ENABLE[\s\S]{0,200}FORCE/iu);
  }
  assert.match(doc, /Production acceptance remains pending/);
  assert.match(matrix, /RLS[\s\S]{0,100}still off[\s\S]{0,120}predecessor CRUD remains retained/iu);
});
