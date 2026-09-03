import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANONICAL_ALIASES,
  CURRENT_DEPLOYMENT,
  EXPECTED_INSTANCE,
  MAX_REQUEST_DRAIN_MS,
  OLD_KEY_SHA256,
  OPERATIONS_KEY_NAME,
  PROJECT,
  RUNTIME_KEY_NAME,
  SHARED_ENVIRONMENT,
  SOURCE_COMMIT,
  assertExactGitState,
  classifyDeploymentInventory,
  createCanarySession,
  normalizeAliasPosition,
  normalizeCandidateDeployment,
  normalizeClerkInstance,
  normalizeClerkSecretKey,
  normalizeDeploymentInventory,
  normalizeOperatorBinding,
  normalizeProjectEnvironmentInventory,
  normalizeRejectedKeyStatus,
  normalizeRevokedSignInToken,
  normalizeSharedEnvironmentInventory,
  normalizeSharedSecretHash,
  sanitizedEvidence,
  validateAcceptedEvidence,
  validateState,
} from "../scripts/clerk-server-key-credential-exposure-recovery.mjs";

const OLD_KEY = `sk_live_${"a".repeat(42)}`;
const RUNTIME_KEY = `sk_live_${"b".repeat(42)}`;
const OPERATIONS_KEY = `sk_live_${"c".repeat(42)}`;

function sharedRow(value = {}) {
  return {
    id: SHARED_ENVIRONMENT.id,
    key: SHARED_ENVIRONMENT.key,
    type: SHARED_ENVIRONMENT.type,
    ownerId: SHARED_ENVIRONMENT.ownerId,
    projectId: [...SHARED_ENVIRONMENT.projectId],
    target: [...SHARED_ENVIRONMENT.target],
    gitBranch: null,
    deletedAt: null,
    updatedAt: Date.now(),
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

function completeState() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    operation: "clerk-server-key-credential-exposure-recovery",
    stage: "provider-revocation-required",
    operatorCommit: "d".repeat(40),
    operatorCiRunId: 9,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: 33702373864,
    createdAt: now,
    updatedAt: now,
    oldKey: OLD_KEY,
    oldKeySha256: createHash("sha256").update(OLD_KEY).digest("hex"),
    runtimeKey: RUNTIME_KEY,
    runtimeKeySha256: createHash("sha256").update(RUNTIME_KEY).digest("hex"),
    operationsKey: OPERATIONS_KEY,
    operationsKeySha256: createHash("sha256").update(OPERATIONS_KEY).digest("hex"),
    providerInstanceId: EXPECTED_INSTANCE.id,
    githubUpdatedAtBefore: now,
    githubUpdatedAt: now,
    projectEnvironmentId: "AbCdEfGhIjKlMnOp",
    candidateDeploymentId: "dpl_Candidate123",
    candidateDeploymentUrl: "grainline-candidate.vercel.app",
    promotedAt: new Date(Date.now() - MAX_REQUEST_DRAIN_MS - 2_000).toISOString(),
    runtimeProofCount: 2,
    predecessorRemoved: true,
    sharedEnvironmentDeleted: true,
  };
}

test("pins the exposed key, exact instance, split target topology, and current deployment", () => {
  assert.equal(OLD_KEY_SHA256.length, 64);
  assert.equal(EXPECTED_INSTANCE.environmentType, "production");
  assert.equal(RUNTIME_KEY_NAME, "grainline-production-runtime-20260903");
  assert.equal(OPERATIONS_KEY_NAME, "grainline-production-operations-20260903");
  assert.equal(SHARED_ENVIRONMENT.projectId[0], PROJECT.id);
  assert.deepEqual(SHARED_ENVIRONMENT.target, ["development", "preview", "production"]);
  assert.equal(CURRENT_DEPLOYMENT.sourceCommit, SOURCE_COMMIT);
});

test("accepts only production Clerk keys and the exact production instance", () => {
  assert.equal(normalizeClerkSecretKey(OLD_KEY), OLD_KEY);
  assert.throws(() => normalizeClerkSecretKey(`sk_test_${"a".repeat(42)}`));
  assert.throws(() => normalizeClerkSecretKey(` ${OLD_KEY}`));
  assert.throws(() => normalizeClerkSecretKey("sk_live_short"));
  assert.deepEqual(normalizeClerkInstance({
    id: EXPECTED_INSTANCE.id,
    environment_type: "production",
  }), EXPECTED_INSTANCE);
  assert.throws(() => normalizeClerkInstance({ id: "ins_other", environment_type: "production" }));
  assert.throws(() => normalizeClerkInstance({ id: EXPECTED_INSTANCE.id, environment_type: "development" }));
  assert.equal(normalizeRejectedKeyStatus(401), true);
  assert.equal(normalizeRejectedKeyStatus(403), true);
  assert.throws(() => normalizeRejectedKeyStatus(429));
});

test("binds a corrected operator only to an existing original recovery journal", () => {
  const original = { operatorCommit: "a".repeat(40), operatorCiRunId: 101 };
  assert.deepEqual(normalizeOperatorBinding(original), {
    commit: original.operatorCommit,
    ciRunId: original.operatorCiRunId,
    originalCommit: original.operatorCommit,
    originalCiRunId: original.operatorCiRunId,
    corrected: false,
  });
  const corrected = {
    ...original,
    correctedOperatorCommit: "b".repeat(40),
    correctedOperatorCiRunId: 202,
  };
  assert.deepEqual(normalizeOperatorBinding(corrected, { hasPriorState: true }), {
    commit: corrected.correctedOperatorCommit,
    ciRunId: corrected.correctedOperatorCiRunId,
    originalCommit: original.operatorCommit,
    originalCiRunId: original.operatorCiRunId,
    corrected: true,
  });
  assert.throws(() => normalizeOperatorBinding(corrected));
  assert.throws(() => normalizeOperatorBinding({ ...original, correctedOperatorCommit: "b".repeat(40) }, {
    hasPriorState: true,
  }));
  assert.throws(() => normalizeOperatorBinding({
    ...original,
    correctedOperatorCommit: original.operatorCommit,
    correctedOperatorCiRunId: 202,
  }, { hasPriorState: true }));
});

test("accepts only exact revocation of the bounded sign-in token", () => {
  const id = "sit_CanaryToken123";
  assert.equal(normalizeRevokedSignInToken({ id, status: "revoked" }, id), true);
  assert.throws(() => normalizeRevokedSignInToken({ id, status: "pending" }, id));
  assert.throws(() => normalizeRevokedSignInToken({ id: "sit_OtherToken123", status: "revoked" }, id));
  assert.throws(() => normalizeRevokedSignInToken({ id, status: "revoked" }, "not-a-token"));
});

test("revokes an unconsumed sign-in token when the ticket handshake fails", async () => {
  const id = "sit_CanaryToken123";
  let revokedId = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    headers: { getSetCookie: () => ["__client=test-client"] },
    status: 500,
    text: async () => JSON.stringify({ response: { object: "error" } }),
  });
  try {
    await assert.rejects(() => createCanarySession({
      signInTokens: {
        createSignInToken: async () => ({
          id,
          status: "pending",
          token: "t".repeat(64),
          userId: "user_canary",
        }),
        revokeSignInToken: async (value) => {
          revokedId = value;
          return { id: value, status: "revoked" };
        },
      },
    }, "user_canary"), /Clerk client handshake failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(revokedId, id);
});

test("pins the shared predecessor and only accepts one Production-sensitive project row", () => {
  assert.deepEqual(normalizeSharedEnvironmentInventory({
    data: [sharedRow()],
    pagination: { count: 1, next: null },
  }).id, SHARED_ENVIRONMENT.id);
  assert.deepEqual(normalizeSharedEnvironmentInventory({
    data: [],
    pagination: { count: 0, next: null },
  }, { deleted: true }), { deleted: true });
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [sharedRow({ target: ["production"] })],
    pagination: { count: 1, next: null },
  }));
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [sharedRow(), sharedRow({ id: "env_duplicate" })],
    pagination: { count: 2, next: null },
  }));

  assert.deepEqual(normalizeProjectEnvironmentInventory({ envs: [] }), { state: "absent" });
  const row = {
    id: "ObHdF2xpBZGpxKg3",
    key: "CLERK_SECRET_KEY",
    type: "sensitive",
    target: ["production"],
    gitBranch: null,
    comment: "Grainline production runtime Clerk key",
    value: "",
  };
  assert.deepEqual(
    normalizeProjectEnvironmentInventory({ envs: [row] }, row.id),
    { state: "runtime-only", id: row.id },
  );
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, type: "encrypted" }] }, row.id));
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, target: ["preview"] }] }, row.id));
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, id: "env_Runtime123" }] }, "env_Runtime123"));
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, value: undefined }] }, row.id));
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, value: "[redacted]" }] }, row.id));
  assert.throws(() => normalizeProjectEnvironmentInventory({ envs: [{ ...row, value: RUNTIME_KEY }] }, row.id));
  assert.throws(() => normalizeProjectEnvironmentInventory({
    envs: [row, { ...row, id: "DupeRuntime12345" }],
  }, row.id));
});

test("hashes the decrypted shared value without returning it", () => {
  const hash = normalizeSharedSecretHash(sharedRow({ decrypted: true, value: OLD_KEY }));
  assert.equal(hash, createHash("sha256").update(OLD_KEY).digest("hex"));
  assert.equal(hash.includes("sk_live"), false);
  assert.throws(() => normalizeSharedSecretHash(sharedRow({ decrypted: false, value: OLD_KEY })));
});

test("accepts only the current-plus-candidate credential epoch and exact aliases", () => {
  assert.equal(normalizeDeploymentInventory({
    deployments: [deploymentRow(CURRENT_DEPLOYMENT)],
    pagination: { count: 1, next: null },
  }).count, 1);
  const createdAt = new Date().toISOString();
  const candidate = {
    id: "dpl_Candidate123",
    url: "grainline-candidate.vercel.app",
    createdAt: Date.now(),
    sourceCommit: SOURCE_COMMIT,
  };
  const marker = createHash("sha256")
    .update(`grainline-clerk-server-key-recovery:${createdAt}`)
    .digest("hex")
    .slice(0, 32);
  assert.equal(normalizeCandidateDeployment({
    ...candidate,
    projectId: PROJECT.id,
    readyState: "READY",
    target: "production",
    source: "cli",
    sourceRef: "main",
    marker,
  }, createdAt).id, candidate.id);
  assert.equal(normalizeDeploymentInventory({
    deployments: [deploymentRow(CURRENT_DEPLOYMENT), deploymentRow(candidate)],
    pagination: { count: 2, next: null },
  }, candidate).count, 2);
  assert.equal(normalizeDeploymentInventory({
    deployments: [deploymentRow(candidate)],
    pagination: { count: 1, next: null },
  }, candidate, true).count, 1);
  assert.equal(classifyDeploymentInventory({
    deployments: [deploymentRow(CURRENT_DEPLOYMENT), deploymentRow(candidate)],
    pagination: { count: 2, next: null },
  }, candidate), "current-and-candidate");
  assert.equal(classifyDeploymentInventory({
    deployments: [deploymentRow(candidate)],
    pagination: { count: 1, next: null },
  }, candidate), "candidate-only");
  assert.throws(() => normalizeDeploymentInventory({
    deployments: [],
    pagination: { count: 0, next: null },
  }));

  const currentAliases = CANONICAL_ALIASES.map((alias) => ({
    alias,
    deployment: { id: CURRENT_DEPLOYMENT.id, projectId: PROJECT.id, readyState: "READY", target: "production" },
  }));
  assert.equal(normalizeAliasPosition(currentAliases, CURRENT_DEPLOYMENT.id), "current");
  const candidateAliases = currentAliases.map((row) => ({
    ...row,
    deployment: { ...row.deployment, id: candidate.id },
  }));
  assert.equal(normalizeAliasPosition(candidateAliases, CURRENT_DEPLOYMENT.id, candidate.id), "candidate");
  assert.equal(normalizeAliasPosition([currentAliases[0], ...candidateAliases.slice(1)], CURRENT_DEPLOYMENT.id, candidate.id), "mixed");
});

test("private state requires three distinct valid keys and exact restart fields", () => {
  const state = completeState();
  assert.equal(validateState(state, state.oldKeySha256).stage, "provider-revocation-required");
  assert.throws(() => validateState({
    ...state,
    operationsKey: state.runtimeKey,
    operationsKeySha256: state.runtimeKeySha256,
  }, state.oldKeySha256));
  assert.throws(() => validateState({ ...state, runtimeProofCount: 3 }, state.oldKeySha256));
  assert.throws(() => validateState({ ...state, sharedEnvironmentDeleted: "yes" }, state.oldKeySha256));
});

test("private state preserves each replacement before provider validation", () => {
  const complete = completeState();
  const capturedRuntime = {
    ...complete,
    stage: "provider-runtime-captured",
    operationsKey: null,
    operationsKeySha256: null,
    githubUpdatedAt: null,
    projectEnvironmentId: null,
    candidateDeploymentId: null,
    candidateDeploymentUrl: null,
    promotedAt: null,
    runtimeProofCount: 0,
    predecessorRemoved: false,
    sharedEnvironmentDeleted: false,
  };
  assert.equal(
    validateState(capturedRuntime, capturedRuntime.oldKeySha256).stage,
    "provider-runtime-captured",
  );
  const capturedOperations = {
    ...capturedRuntime,
    stage: "provider-operations-captured",
    operationsKey: complete.operationsKey,
    operationsKeySha256: complete.operationsKeySha256,
  };
  assert.equal(
    validateState(capturedOperations, capturedOperations.oldKeySha256).stage,
    "provider-operations-captured",
  );
  assert.throws(() => validateState({
    ...capturedRuntime,
    runtimeKey: null,
    runtimeKeySha256: null,
  }, capturedRuntime.oldKeySha256));
  assert.throws(() => validateState({
    ...capturedOperations,
    operationsKey: null,
    operationsKeySha256: null,
  }, capturedOperations.oldKeySha256));
});

test("sanitized evidence proves split consumers, two runtime witnesses, and no raw identities", () => {
  const state = completeState();
  const config = { operatorCommit: state.operatorCommit, operatorCiRunId: state.operatorCiRunId };
  const value = sanitizedEvidence(config, state, {
    accountStatus: 200,
  }, 331);
  const serialized = JSON.stringify(value);
  assert.equal(/sk_live_|user_|sess_|sit_|__session/.test(serialized), false);
  assert.equal(value.consumers.runtimeSensitive, true);
  assert.equal(value.consumers.previewCredentialPresent, false);
  assert.equal(value.runtimeProof.count, 2);
  assert.equal(value.operator.originalCommit, state.operatorCommit);
  assert.equal(value.operator.originalCiRunId, state.operatorCiRunId);
  const accepted = {
    ...value,
    provider: { ...value.provider, predecessorKeySha256: OLD_KEY_SHA256 },
  };
  assert.equal(validateAcceptedEvidence(accepted, config).status, "passed");
  const correctedConfig = {
    ...config,
    correctedOperatorCommit: "e".repeat(40),
    correctedOperatorCiRunId: 10,
  };
  const corrected = sanitizedEvidence(correctedConfig, state, {
    accountStatus: 200,
  }, 331);
  const correctedAccepted = {
    ...corrected,
    provider: { ...corrected.provider, predecessorKeySha256: OLD_KEY_SHA256 },
  };
  assert.equal(corrected.operator.commit, correctedConfig.correctedOperatorCommit);
  assert.equal(corrected.operator.ciRunId, correctedConfig.correctedOperatorCiRunId);
  assert.equal(corrected.operator.originalCommit, config.operatorCommit);
  assert.equal(corrected.operator.originalCiRunId, config.operatorCiRunId);
  assert.equal(validateAcceptedEvidence(correctedAccepted, correctedConfig).status, "passed");
  assert.throws(() => validateAcceptedEvidence(correctedAccepted, config));
  assert.throws(() => validateAcceptedEvidence({
    ...accepted,
    consumers: { ...accepted.consumers, previewCredentialPresent: true },
  }, config));
  assert.throws(() => validateAcceptedEvidence({
    ...accepted,
    provider: { ...accepted.provider, operationsKeySha256: accepted.provider.runtimeKeySha256 },
  }, config));
  assert.throws(() => sanitizedEvidence(config, { ...state, runtimeProofCount: 1 }, {
    accountStatus: 200,
  }, 331));
});

test("operator statically protects clipboard, key split, canary cleanup, and production boundaries", () => {
  const source = readFileSync("scripts/clerk-server-key-credential-exposure-recovery.mjs", "utf8");
  assert.match(source, /spawnSync\("\/usr\/bin\/pbpaste"/);
  assert.match(source, /spawnSync\("\/usr\/bin\/pbcopy"/);
  assert.match(source, /"provider-runtime-captured"/);
  assert.match(source, /"provider-operations-captured"/);
  assert.match(source, /--corrected-operator-commit/);
  assert.match(source, /--corrected-operator-ci-run/);
  assert.match(source, /if \(durablyCaptured\) clearClipboard\(\)/);
  assert.match(source, /type: "sensitive"/);
  assert.match(source, /target: \["production"\]/);
  assert.match(source, /await runtimeWitness\(state\.operationsKey\)/);
  assert.match(source, /revokeActiveCanarySessions/);
  assert.match(source, /signInTokens\.revokeSignInToken/);
  assert.match(source, /expiresInSeconds: 60/);
  assert.match(source, /provider-predecessor-key-deletion-required/);
  assert.match(source, /deleteSharedEnvironment\(\)/);
  assert.match(source, /Math\.min\(remaining, 30_000\)/);
  assert.doesNotMatch(source, /banUser|unbanUser|deleteUser/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:oldKey|runtimeKey|operationsKey|jwt)/);
});

test("exact Git state refuses dirty or wrong commits", () => {
  const expected = "a".repeat(40);
  assert.equal(assertExactGitState({ head: expected, status: "" }, expected), true);
  assert.throws(() => assertExactGitState({ head: "b".repeat(40), status: "" }, expected));
  assert.throws(() => assertExactGitState({ head: expected, status: " M file" }, expected));
});
