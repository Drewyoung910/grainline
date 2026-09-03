import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANONICAL_ALIASES,
  CURRENT_DEPLOYMENT,
  DATABASE_CREDENTIAL_EPOCH_CUTOFF,
  OLD_TOKEN_SHA256,
  PREDECESSOR_DEPLOYMENTS,
  PROJECT,
  SHARED_ENVIRONMENT,
  SOURCE_COMMIT,
  assertExactGitState,
  normalizeAliasPosition,
  normalizeCandidateDeployment,
  normalizeCarrierAccountIdentity,
  normalizeDeploymentInventory,
  normalizeProjectEnvironmentInventory,
  reconcileRemovedDeploymentIds,
  normalizeRejectedTokenStatus,
  normalizeSharedEnvironmentInventory,
  normalizeSharedSecretHash,
  normalizeShippoToken,
  sanitizedEvidence,
  summarizeShippoCredentialQuotes,
  validateAcceptedEvidence,
  validateState,
} from "../scripts/shippo-api-credential-exposure-recovery.mjs";

const OLD_TOKEN = `shippo_test_${"a".repeat(40)}`;
const NEW_TOKEN = `shippo_test_${"b".repeat(40)}`;

function sharedRow(value = {}) {
  return {
    id: SHARED_ENVIRONMENT.id,
    key: SHARED_ENVIRONMENT.key,
    type: SHARED_ENVIRONMENT.type,
    ownerId: SHARED_ENVIRONMENT.ownerId,
    projectId: [...SHARED_ENVIRONMENT.projectId],
    target: [...SHARED_ENVIRONMENT.target],
    gitBranch: null,
    createdAt: SHARED_ENVIRONMENT.createdAt,
    updatedAt: SHARED_ENVIRONMENT.initialUpdatedAt,
    deletedAt: null,
    ...value,
  };
}

function deploymentRow(value) {
  return {
    id: value.id,
    url: value.url,
    createdAt: value.createdAt,
    target: "production",
    readyState: "READY",
    meta: { gitCommitSha: value.sourceCommit },
  };
}

test("pins the exact shared consumer and bounded current database-credential epoch", () => {
  assert.equal(DATABASE_CREDENTIAL_EPOCH_CUTOFF, PREDECESSOR_DEPLOYMENTS[0].createdAt);
  assert.equal(PREDECESSOR_DEPLOYMENTS.length, 8);
  assert.equal(PREDECESSOR_DEPLOYMENTS.at(-1).id, CURRENT_DEPLOYMENT.id);
  assert.equal(new Set(PREDECESSOR_DEPLOYMENTS.map((row) => row.id)).size, 8);
  assert.equal(SHARED_ENVIRONMENT.id, "env_374M3muVPW3jIKBS8X4Q7kqI");
  assert.equal(SHARED_ENVIRONMENT.projectId[0], PROJECT.id);
  assert.equal(OLD_TOKEN_SHA256.length, 64);
});

test("accepts only exact test tokens and rejected authentication status", () => {
  assert.equal(normalizeShippoToken(OLD_TOKEN), OLD_TOKEN);
  assert.throws(() => normalizeShippoToken(`shippo_live_${"a".repeat(40)}`));
  assert.throws(() => normalizeShippoToken(` ${OLD_TOKEN}`));
  assert.throws(() => normalizeShippoToken("shippo_test_short"));
  assert.throws(() => normalizeShippoToken(`${OLD_TOKEN}x`));
  assert.equal(normalizeRejectedTokenStatus(401), true);
  assert.equal(normalizeRejectedTokenStatus(403), true);
  assert.throws(() => normalizeRejectedTokenStatus(429));
  assert.throws(() => normalizeRejectedTokenStatus(500));
});

test("hashes a complete carrier identity without exposing account fields", () => {
  const payload = {
    next: null,
    previous: null,
    results: [
      { object_id: "carrier_account_b", carrier: "UPS", active: true, test: true, is_shippo_account: false },
      { object_id: "carrier_account_a", carrier: "USPS", active: true, test: true, is_shippo_account: true },
    ],
  };
  const forward = normalizeCarrierAccountIdentity(payload);
  const reverse = normalizeCarrierAccountIdentity({ ...payload, results: [...payload.results].reverse() });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.count, 2);
  assert.equal(forward.sha256.length, 64);
  assert.equal(JSON.stringify(forward).includes("carrier_account"), false);
  assert.throws(() => normalizeCarrierAccountIdentity({ ...payload, next: "page=2" }));
  assert.throws(() => normalizeCarrierAccountIdentity({ ...payload, previous: "page=0" }));
  assert.throws(() => normalizeCarrierAccountIdentity({ ...payload, results: [] }));
  assert.throws(() => normalizeCarrierAccountIdentity({ ...payload, results: [payload.results[0], payload.results[0]] }));
});

test("pins the shared row and rejects any project-local shadow", () => {
  assert.deepEqual(normalizeSharedEnvironmentInventory({
    data: [sharedRow()],
    pagination: { count: 1, next: null },
  }), { id: SHARED_ENVIRONMENT.id, updatedAt: SHARED_ENVIRONMENT.initialUpdatedAt });
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [sharedRow({ projectId: [] })],
    pagination: { count: 1, next: null },
  }));
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [sharedRow(), sharedRow({ id: "env_duplicate" })],
    pagination: { count: 2, next: null },
  }));
  assert.equal(normalizeProjectEnvironmentInventory({ envs: [] }), true);
  assert.throws(() => normalizeProjectEnvironmentInventory({
    envs: [{ key: "SHIPPO_API_KEY", target: ["production"] }],
  }));
  assert.throws(() => normalizeProjectEnvironmentInventory({
    envs: [{ key: "SHIPPO_API_KEY_PREVIOUS", target: ["production"] }],
  }));
});

test("hashes decrypted shared values without returning them", () => {
  const result = normalizeSharedSecretHash(sharedRow({ decrypted: true, value: OLD_TOKEN }));
  assert.equal(result.length, 64);
  assert.equal(result.includes("shippo"), false);
  assert.throws(() => normalizeSharedSecretHash(sharedRow({ decrypted: true, value: NEW_TOKEN, target: ["production"] })));
  assert.throws(() => normalizeSharedSecretHash(sharedRow({ decrypted: false, value: OLD_TOKEN })));
});

test("accepts the exact epoch before candidate and rejects unknown or incomplete deployments", () => {
  const rows = [...PREDECESSOR_DEPLOYMENTS].reverse().map(deploymentRow);
  assert.deepEqual(normalizeDeploymentInventory({
    deployments: rows,
    pagination: { count: rows.length, next: null },
  }).count, 8);
  assert.throws(() => normalizeDeploymentInventory({
    deployments: rows.slice(1),
    pagination: { count: rows.length - 1, next: null },
  }));
  assert.throws(() => normalizeDeploymentInventory({
    deployments: [...rows, deploymentRow({ id: "dpl_unknown", url: "unknown.vercel.app", createdAt: Date.now(), sourceCommit: SOURCE_COMMIT })],
    pagination: { count: rows.length + 1, next: null },
  }));
  assert.throws(() => normalizeDeploymentInventory({
    deployments: rows,
    pagination: { count: rows.length, next: 1 },
  }));
});

test("accepts a single exact candidate and restart-safe oldest-first removals", () => {
  const createdAt = new Date().toISOString();
  const candidate = {
    id: "dpl_Candidate123",
    url: "grainline-candidate.vercel.app",
    createdAt: Date.now(),
    sourceCommit: SOURCE_COMMIT,
  };
  assert.deepEqual(normalizeCandidateDeployment({
    ...candidate,
    projectId: PROJECT.id,
    readyState: "READY",
    target: "production",
    source: "cli",
    sourceRef: "main",
    marker: createHash("sha256")
      .update(`grainline-shippo-api-credential-recovery:${createdAt}`)
      .digest("hex")
      .slice(0, 32),
  }, createdAt).id, candidate.id);
  const remaining = PREDECESSOR_DEPLOYMENTS.slice(2);
  const rows = [deploymentRow(candidate), ...remaining.map(deploymentRow)];
  assert.equal(normalizeDeploymentInventory({
    deployments: rows,
    pagination: { count: rows.length, next: null },
  }, candidate, PREDECESSOR_DEPLOYMENTS.slice(0, 2).map((row) => row.id)).count, rows.length);
  assert.throws(() => normalizeDeploymentInventory({
    deployments: rows,
    pagination: { count: rows.length, next: null },
  }, candidate, [PREDECESSOR_DEPLOYMENTS[1].id]));
});

test("reconciles a provider deletion completed immediately before a process crash", () => {
  const candidate = {
    id: "dpl_Candidate123",
    url: "grainline-candidate.vercel.app",
    createdAt: Date.now(),
    sourceCommit: SOURCE_COMMIT,
  };
  const remaining = PREDECESSOR_DEPLOYMENTS.slice(2);
  const rows = [deploymentRow(candidate), ...remaining.map(deploymentRow)];
  const payload = { deployments: rows, pagination: { count: rows.length, next: null } };
  assert.deepEqual(
    reconcileRemovedDeploymentIds(payload, candidate, [PREDECESSOR_DEPLOYMENTS[0].id]),
    PREDECESSOR_DEPLOYMENTS.slice(0, 2).map((row) => row.id),
  );
  assert.throws(() => reconcileRemovedDeploymentIds(
    payload,
    candidate,
    PREDECESSOR_DEPLOYMENTS.slice(0, 3).map((row) => row.id),
  ));
  const outOfOrderRows = [
    deploymentRow(candidate),
    deploymentRow(PREDECESSOR_DEPLOYMENTS[0]),
    ...PREDECESSOR_DEPLOYMENTS.slice(2).map(deploymentRow),
  ];
  assert.throws(() => reconcileRemovedDeploymentIds({
    deployments: outOfOrderRows,
    pagination: { count: outOfOrderRows.length, next: null },
  }, candidate, []));
});

test("requires all four canonical aliases to move atomically between reviewed deployments", () => {
  const current = CANONICAL_ALIASES.map((alias) => ({
    alias,
    deployment: { id: CURRENT_DEPLOYMENT.id, projectId: PROJECT.id, readyState: "READY", target: "production" },
  }));
  assert.equal(normalizeAliasPosition(current, CURRENT_DEPLOYMENT.id), "current");
  const candidateId = "dpl_Candidate123";
  const candidate = current.map((row) => ({ ...row, deployment: { ...row.deployment, id: candidateId } }));
  assert.equal(normalizeAliasPosition(candidate, CURRENT_DEPLOYMENT.id, candidateId), "candidate");
  assert.equal(normalizeAliasPosition([current[0], ...candidate.slice(1)], CURRENT_DEPLOYMENT.id, candidateId), "mixed");
});

test("proves buyer and seller quote semantics without creating a transaction", () => {
  const rate = {
    object_id: "rate_identity_123",
    amount: "8.25",
    currency: "USD",
    estimated_days: 4,
    test: true,
  };
  const summary = summarizeShippoCredentialQuotes(
    { test: true, rates: [rate] },
    { test: true, rates: [rate] },
  );
  assert.equal(summary.buyer.usableRateCount, 1);
  assert.equal(summary.seller.estimatedDaysWitnessCount, 1);
  assert.equal(summary.labelPurchased, false);
  assert.equal(summary.transactionCreated, false);
  assert.throws(() => summarizeShippoCredentialQuotes(
    { test: true, rates: [rate] },
    { test: true, rates: [{ ...rate, estimated_days: null }] },
  ));
});

test("validates private state and never permits a non-prefix removal journal", () => {
  const now = new Date().toISOString();
  const state = {
    schemaVersion: 1,
    operation: "shippo-api-credential-exposure-recovery",
    stage: "provider-create-required",
    operatorCommit: "a".repeat(40),
    operatorCiRunId: 1,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: 33702373864,
    createdAt: now,
    updatedAt: now,
    oldToken: OLD_TOKEN,
    oldTokenSha256: createHash("sha256").update(OLD_TOKEN).digest("hex"),
    newToken: null,
    newTokenSha256: null,
    providerIdentitySha256: "c".repeat(64),
    providerIdentityCount: 2,
    githubUpdatedAtBefore: "2026-04-28T03:14:53.000Z",
    githubUpdatedAt: null,
    candidateDeploymentId: null,
    candidateDeploymentUrl: null,
    promotedAt: null,
    quoteProof: null,
    removedDeploymentIds: [],
  };
  assert.equal(validateState(state, state.oldTokenSha256).stage, "provider-create-required");
  assert.throws(() => validateState({
    ...state,
    removedDeploymentIds: [PREDECESSOR_DEPLOYMENTS[1].id],
  }, state.oldTokenSha256));
  assert.throws(() => validateState(state));
  const source = readFileSync("scripts/shippo-api-credential-exposure-recovery.mjs", "utf8");
  assert.match(source, /value\.oldTokenSha256 !== expectedOldTokenSha256/);
  assert.match(source, /value\.removedDeploymentIds\.some\(\(id, index\) => id !== PREDECESSOR_DEPLOYMENTS\[index\]\?\.id\)/);
});

test("sanitized evidence contains no credential or provider object identity", () => {
  const state = {
    oldTokenSha256: OLD_TOKEN_SHA256,
    newTokenSha256: "b".repeat(64),
    providerIdentitySha256: "c".repeat(64),
    providerIdentityCount: 2,
    candidateDeploymentId: "dpl_Candidate123",
    promotedAt: new Date(Date.now() - 36 * 60_000).toISOString(),
    removedDeploymentIds: PREDECESSOR_DEPLOYMENTS.map((row) => row.id),
  };
  const quote = {
    buyer: { usableRateCount: 2, minimumAmountCents: 700, maximumAmountCents: 900 },
    seller: { usableRateCount: 2, estimatedDaysWitnessCount: 1, minimumAmountCents: 700, maximumAmountCents: 900 },
    labelPurchased: false,
    transactionCreated: false,
  };
  const result = sanitizedEvidence(
    { operatorCommit: "d".repeat(40), operatorCiRunId: 9 },
    state,
    { sha256: state.providerIdentitySha256, count: 2 },
    quote,
    200,
  );
  const text = JSON.stringify(result);
  assert.equal(/shippo_(?:test|live)_/.test(text), false);
  assert.equal(text.includes("carrier_account"), false);
  assert.equal(result.labelPurchased, false);
  assert.equal(result.transactionCreated, false);
  assert.equal(result.rlsChanged, false);
  assert.equal(validateAcceptedEvidence(result, {
    operatorCommit: "d".repeat(40),
    operatorCiRunId: 9,
  }).status, "passed");
  assert.throws(() => validateAcceptedEvidence({
    ...result,
    deployment: { ...result.deployment, removedPredecessorIds: [] },
  }, { operatorCommit: "d".repeat(40), operatorCiRunId: 9 }));
  assert.throws(() => validateAcceptedEvidence({
    ...result,
    unreviewed: true,
  }, { operatorCommit: "d".repeat(40), operatorCiRunId: 9 }));
  assert.throws(() => validateAcceptedEvidence({
    ...result,
    quoteProof: {
      ...result.quoteProof,
      seller: { ...result.quoteProof.seller, estimatedDaysWitnessCount: 3 },
    },
  }, { operatorCommit: "d".repeat(40), operatorCiRunId: 9 }));
});

test("script captures the clipboard privately and never calls a Shippo transaction endpoint", () => {
  const source = readFileSync("scripts/shippo-api-credential-exposure-recovery.mjs", "utf8");
  assert.match(source, /spawnSync\("\/usr\/bin\/pbpaste"/);
  assert.match(source, /spawnSync\("\/usr\/bin\/pbcopy"/);
  assert.match(source, /writePrivate\(JOURNAL/);
  assert.match(source, /accepted Shippo evidence does not match its retained journal/);
  assert.match(source, /removePrivate\(JOURNAL\)/);
  assert.match(source, /Math\.min\(remaining, 30_000\)/);
  assert.match(source, /source\.match\(\/\^SHIPPO_API_KEY=/);
  assert.match(source, /\/carrier_accounts\?results=100/);
  assert.match(source, /shippoFetch\(token, "\/shipments\/"/);
  assert.doesNotMatch(source, /shippoFetch\([^\n]*"\/transactions\//);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:oldToken|newToken)/);
});

test("exact Git state refuses dirty or wrong commits", () => {
  const expected = "a".repeat(40);
  assert.equal(assertExactGitState({ head: expected, status: "" }, expected), true);
  assert.throws(() => assertExactGitState({ head: "b".repeat(40), status: "" }, expected));
  assert.throws(() => assertExactGitState({ head: expected, status: " M file" }, expected));
});
