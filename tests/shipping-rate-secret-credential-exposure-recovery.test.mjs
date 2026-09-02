import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const recovery = await import("../scripts/shipping-rate-secret-credential-exposure-recovery.mjs");

const {
  CANONICAL_ALIASES,
  COMPATIBILITY_DEPLOYMENT,
  CURRENT_ENVIRONMENTS,
  MAX_REQUEST_DRAIN_MS,
  OLD_SECRET_SHA256,
  PREDECESSOR_DEPLOYMENT,
  PREVIOUS_KEY,
  PROJECT,
  SOURCE_CI_RUN_ID,
  SOURCE_COMMIT,
  assertExactGitState,
  classifyStoredHashes,
  normalizeAliasPosition,
  normalizeAliasTargets,
  normalizeCompatibilityDeployment,
  normalizeEnvironmentInventory,
  normalizeEnvironmentValue,
  normalizeMarkedDeploymentInventory,
  normalizeProjectProtection,
  normalizeRecoveryDeployment,
  parseArguments,
  proveLocalVerifier,
  validateAcceptedEvidence,
  validateCompletedRestart,
  validateState,
} = recovery;

const OLD = "o".repeat(64);
const REPLACEMENT = "r".repeat(64);
const OLD_HASH = createHash("sha256").update(OLD).digest("hex");
const REPLACEMENT_HASH = createHash("sha256").update(REPLACEMENT).digest("hex");
const PREVIOUS_ID = "PreviousShipping123";
const OPERATOR_COMMIT = "a".repeat(40);

function environmentRow(expected, patch = {}) {
  return {
    id: expected.id,
    key: expected.key,
    type: expected.type,
    target: [...expected.target],
    gitBranch: null,
    configurationId: null,
    customEnvironmentIds: [],
    ...patch,
  };
}

function previousRow(patch = {}) {
  return environmentRow({
    id: PREVIOUS_ID,
    key: PREVIOUS_KEY,
    type: "encrypted",
    target: ["production"],
  }, patch);
}

function inventory(extra = []) {
  return {
    envs: [
      ...CURRENT_ENVIRONMENTS.map((row) => environmentRow(row)),
      ...extra,
      environmentRow({ id: "Unrelated123", key: "UNRELATED", type: "encrypted", target: ["production"] }),
    ],
  };
}

function deployment(id, patch = {}) {
  return {
    id,
    url: `${id.toLowerCase()}.vercel.app`,
    projectId: PROJECT.id,
    readyState: "READY",
    target: "production",
    sourceCommit: SOURCE_COMMIT,
    sourceRef: "main",
    marker: "b".repeat(32),
    phase: "dual",
    ...patch,
  };
}

function aliasTargets(id) {
  return CANONICAL_ALIASES.map((alias) => ({ alias, deployment: deployment(id) }));
}

function baseState(patch = {}) {
  return {
    schemaVersion: 1,
    operation: "shipping-rate-secret-credential-exposure-recovery",
    stage: "preflight",
    operatorCommit: OPERATOR_COMMIT,
    operatorCiRunId: 123,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    compatibilityDeploymentId: COMPATIBILITY_DEPLOYMENT,
    previousEnvironmentId: null,
    dualDeploymentId: null,
    dualDeploymentUrl: null,
    dualPromotedAt: null,
    finalDeploymentId: null,
    finalDeploymentUrl: null,
    oldSecret: OLD,
    oldSecretSha256: OLD_HASH,
    replacementSecret: REPLACEMENT,
    replacementSecretSha256: REPLACEMENT_HASH,
    createdAt: "2026-09-02T21:00:00.000Z",
    updatedAt: "2026-09-02T21:00:00.000Z",
    ...patch,
  };
}

function acceptedEvidence(patch = {}) {
  return {
    schemaVersion: 1,
    operation: "shipping-rate-secret-credential-exposure-recovery",
    accepted: true,
    generatedAt: "2026-09-02T22:00:00.000Z",
    recoveryCreatedAt: "2026-09-02T21:00:00.000Z",
    operatorCommit: OPERATOR_COMMIT,
    operatorCiRunId: 123,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    compatibilityDeploymentId: COMPATIBILITY_DEPLOYMENT,
    dualDeploymentId: "dpl_Dual123",
    finalDeploymentId: "dpl_Final123",
    previousEnvironmentId: PREVIOUS_ID,
    currentEnvironmentIds: CURRENT_ENVIRONMENTS.map((row) => row.id),
    githubCurrentUpdatedAt: "2026-09-02T21:15:00.000Z",
    oldSecretSha256: OLD_SECRET_SHA256,
    replacementSecretSha256: REPLACEMENT_HASH,
    dualPromotedAt: "2026-09-02T21:20:00.000Z",
    drainSeconds: MAX_REQUEST_DRAIN_MS / 1_000,
    previousEnvironmentPresent: false,
    replacementSecretAccepted: true,
    oldSecretAcceptedAfterDrain: false,
    productionHealth: 200,
    canonicalAliases: [...CANONICAL_ALIASES],
    providerMutations: [],
    ...patch,
  };
}

test("pins the exact compatibility source, CI, deployments, row IDs, and drain", () => {
  assert.equal(SOURCE_COMMIT, "a4c74bbaeded1e347ec582289a226eae24763faf");
  assert.equal(SOURCE_CI_RUN_ID, 33683844324);
  assert.equal(PREDECESSOR_DEPLOYMENT, "dpl_GfJdUoqm6gCMGi8CMEExWVEN5xRC");
  assert.equal(COMPATIBILITY_DEPLOYMENT, "dpl_Ec5mLGwhv3jXWEa88z2BeUs5N3j7");
  assert.equal(OLD_SECRET_SHA256, "8522a90d56d50b66d35a58d6bf2d7486f17b884fbbd58a649e38c796ce8b9975");
  assert.deepEqual(CURRENT_ENVIRONMENTS.map((row) => row.id), [
    "QtdQdIWG7kRGIfU4",
    "Qr10JAPww1OXr8JX",
    "Sux1asRFN0hfoiok",
  ]);
  assert.deepEqual(CURRENT_ENVIRONMENTS.map((row) => row.target), [
    ["preview"],
    ["development"],
    ["production"],
  ]);
  assert.equal(MAX_REQUEST_DRAIN_MS, 35 * 60 * 1_000);
});

test("accepts only the exact three current rows and one exact Production previous row", () => {
  assert.deepEqual(normalizeEnvironmentInventory(inventory()), {
    currentIds: CURRENT_ENVIRONMENTS.map((row) => row.id),
    previousId: null,
  });
  assert.deepEqual(normalizeEnvironmentInventory(inventory([previousRow()]), PREVIOUS_ID), {
    currentIds: CURRENT_ENVIRONMENTS.map((row) => row.id),
    previousId: PREVIOUS_ID,
  });
  assert.deepEqual(
    normalizeEnvironmentInventory(inventory([previousRow()]), null, { allowAnyPrevious: true }),
    { currentIds: CURRENT_ENVIRONMENTS.map((row) => row.id), previousId: PREVIOUS_ID },
  );

  assert.throws(() => normalizeEnvironmentInventory({ envs: inventory().envs.slice(1) }));
  assert.throws(() => normalizeEnvironmentInventory(inventory([
    environmentRow(CURRENT_ENVIRONMENTS[0], { id: "DuplicateCurrent" }),
  ])));
  assert.throws(() => normalizeEnvironmentInventory(inventory([
    previousRow({ target: ["preview"] }),
  ]), PREVIOUS_ID));
  assert.throws(() => normalizeEnvironmentInventory(inventory([
    previousRow(),
    previousRow({ id: "SecondPrevious" }),
  ]), null, { allowAnyPrevious: true }));
  assert.throws(() => normalizeEnvironmentInventory(inventory([previousRow()])));
});

test("hashes only exact decrypted environment value responses", () => {
  const expected = CURRENT_ENVIRONMENTS[2];
  const payload = environmentRow(expected, { decrypted: true, value: OLD });
  assert.equal(normalizeEnvironmentValue(payload, expected), OLD);
  assert.throws(() => normalizeEnvironmentValue({ ...payload, decrypted: false }, expected));
  assert.throws(() => normalizeEnvironmentValue({ ...payload, value: "short" }, expected));
  assert.throws(() => normalizeEnvironmentValue({ ...payload, id: "Wrong" }, expected));
  assert.throws(() => normalizeEnvironmentValue({ ...payload, target: ["preview"] }, expected));
});

test("classifies only the reviewed old/replacement provider pair", () => {
  const ids = CURRENT_ENVIRONMENTS.map((row) => row.id);
  const snapshot = (values, previous) => ({
    current: Object.fromEntries(ids.map((id, index) => [id, values[index]])),
    previous,
  });
  const hashes = { old: OLD_HASH, replacement: REPLACEMENT_HASH };
  assert.equal(classifyStoredHashes(snapshot(ids.map(() => OLD_HASH), "absent"), hashes, false), "old");
  assert.equal(
    classifyStoredHashes(snapshot(ids.map(() => REPLACEMENT_HASH), OLD_HASH), hashes, true),
    "replacement",
  );
  assert.equal(
    classifyStoredHashes(snapshot([OLD_HASH, REPLACEMENT_HASH, OLD_HASH], OLD_HASH), hashes, true),
    "partial",
  );
  assert.throws(() => classifyStoredHashes(snapshot(ids.map(() => "f".repeat(64)), OLD_HASH), hashes, true));
  assert.throws(() => classifyStoredHashes(snapshot(ids.map(() => REPLACEMENT_HASH), "absent"), hashes, true));
  assert.throws(() => classifyStoredHashes(snapshot(ids.map(() => REPLACEMENT_HASH), OLD_HASH), hashes, false));
});

test("requires exact clean Git bindings and exact operator arguments", () => {
  assert.equal(assertExactGitState({ head: OPERATOR_COMMIT, status: "" }, OPERATOR_COMMIT), true);
  assert.throws(() => assertExactGitState({ head: OPERATOR_COMMIT, status: " M file" }, OPERATOR_COMMIT));
  assert.throws(() => assertExactGitState({ head: "b".repeat(40), status: "" }, OPERATOR_COMMIT));
  assert.deepEqual(
    parseArguments(["--operator-commit", OPERATOR_COMMIT, "--operator-ci-run", "123"]),
    { operatorCommit: OPERATOR_COMMIT, operatorCiRunId: 123 },
  );
  assert.throws(() => parseArguments(["--operator-commit", OPERATOR_COMMIT]));
  assert.throws(() => parseArguments([
    "--operator-commit", OPERATOR_COMMIT,
    "--operator-commit", OPERATOR_COMMIT,
  ]));
  assert.throws(() => parseArguments([
    "--operator-commit", OPERATOR_COMMIT,
    "--operator-ci-run", "0",
  ]));
});

test("accepts only the reviewed deployment protection and compatibility deployment", () => {
  assert.deepEqual(normalizeProjectProtection({
    id: PROJECT.id,
    name: PROJECT.name,
    ssoProtection: { deploymentType: "all_except_custom_domains" },
  }), { deploymentType: "all_except_custom_domains" });
  assert.throws(() => normalizeProjectProtection({
    id: PROJECT.id,
    name: PROJECT.name,
    ssoProtection: { deploymentType: "none" },
  }));

  const compatibility = deployment(COMPATIBILITY_DEPLOYMENT, {
    sourceRef: undefined,
    marker: undefined,
    phase: undefined,
  });
  assert.equal(normalizeCompatibilityDeployment(compatibility).id, COMPATIBILITY_DEPLOYMENT);
  assert.throws(() => normalizeCompatibilityDeployment({ ...compatibility, sourceCommit: "b".repeat(40) }));
  assert.throws(() => normalizeCompatibilityDeployment({ ...compatibility, readyState: "ERROR" }));
});

test("accepts only marker-bound recovery deployments and rejects ambiguity", () => {
  const marker = "b".repeat(32);
  const dual = deployment("dpl_Dual123");
  assert.equal(
    normalizeRecoveryDeployment(dual, marker, "dual", COMPATIBILITY_DEPLOYMENT).id,
    "dpl_Dual123",
  );
  assert.throws(() => normalizeRecoveryDeployment({ ...dual, sourceCommit: "c".repeat(40) }, marker, "dual", COMPATIBILITY_DEPLOYMENT));
  assert.throws(() => normalizeRecoveryDeployment({ ...dual, phase: "final" }, marker, "dual", COMPATIBILITY_DEPLOYMENT));
  assert.throws(() => normalizeRecoveryDeployment({ ...dual, id: COMPATIBILITY_DEPLOYMENT }, marker, "dual", COMPATIBILITY_DEPLOYMENT));

  const createdAt = "2026-09-02T21:00:00.000Z";
  const row = {
    uid: "dpl_Dual123",
    url: dual.url,
    projectId: PROJECT.id,
    readyState: "READY",
    target: "production",
    createdAt: Date.parse(createdAt),
    meta: {
      gitCommitSha: SOURCE_COMMIT,
      gitCommitRef: "main",
      grainlineShippingRateCredentialRecovery: marker,
      grainlineShippingRateCredentialRecoveryPhase: "dual",
    },
  };
  assert.equal(
    normalizeMarkedDeploymentInventory({ deployments: [row] }, createdAt, marker, "dual", COMPATIBILITY_DEPLOYMENT).id,
    "dpl_Dual123",
  );
  assert.equal(
    normalizeMarkedDeploymentInventory({ deployments: [] }, createdAt, marker, "dual", COMPATIBILITY_DEPLOYMENT),
    null,
  );
  assert.throws(() => normalizeMarkedDeploymentInventory(
    { deployments: [row, { ...row, uid: "dpl_Second" }] },
    createdAt,
    marker,
    "dual",
    COMPATIBILITY_DEPLOYMENT,
  ));
});

test("requires atomic movement of all four canonical aliases", () => {
  const from = COMPATIBILITY_DEPLOYMENT;
  const to = "dpl_Dual123";
  assert.equal(normalizeAliasTargets(aliasTargets(from), from), true);
  assert.equal(normalizeAliasPosition(aliasTargets(from), from, to), "from");
  assert.equal(normalizeAliasPosition(aliasTargets(to), from, to), "to");
  const partial = aliasTargets(from);
  partial[3] = { ...partial[3], deployment: deployment(to) };
  assert.throws(() => normalizeAliasPosition(partial, from, to));
  assert.throws(() => normalizeAliasTargets(aliasTargets("dpl_Unknown"), from));
});

test("proves dual acceptance and final old-secret rejection through the real verifier", () => {
  assert.deepEqual(proveLocalVerifier(OLD, REPLACEMENT, "dual"), {
    replacementAccepted: true,
    oldAccepted: true,
  });
  assert.deepEqual(proveLocalVerifier(OLD, REPLACEMENT, "final"), {
    replacementAccepted: true,
    oldAccepted: false,
  });
  assert.throws(() => proveLocalVerifier(OLD, OLD, "dual"));
  assert.throws(() => proveLocalVerifier(OLD, REPLACEMENT, "wrong"));
});

test("validates secret-bearing private state without permitting incomplete later stages", () => {
  assert.equal(validateState(baseState(), OLD_HASH).stage, "preflight");
  assert.equal(validateState(baseState({
    stage: "previous-created",
    previousEnvironmentId: PREVIOUS_ID,
  }), OLD_HASH).stage, "previous-created");
  assert.equal(validateState(baseState({
    stage: "final-ready",
    previousEnvironmentId: PREVIOUS_ID,
    dualDeploymentId: "dpl_Dual123",
    dualDeploymentUrl: "dual.vercel.app",
    dualPromotedAt: "2026-09-02T22:00:00.000Z",
    finalDeploymentId: "dpl_Final123",
    finalDeploymentUrl: "final.vercel.app",
  }), OLD_HASH).stage, "final-ready");

  assert.throws(() => validateState(baseState({ oldSecret: "wrong" }), OLD_HASH));
  assert.throws(() => validateState(baseState({ replacementSecret: OLD, replacementSecretSha256: OLD_HASH }), OLD_HASH));
  assert.throws(() => validateState(baseState({ stage: "previous-created" }), OLD_HASH));
  assert.throws(() => validateState(baseState({
    stage: "dual-ready",
    previousEnvironmentId: PREVIOUS_ID,
  }), OLD_HASH));
  assert.throws(() => validateState(baseState({
    stage: "dual-promoted",
    previousEnvironmentId: PREVIOUS_ID,
    dualDeploymentId: "dpl_Dual123",
    dualDeploymentUrl: "dual.vercel.app",
  }), OLD_HASH));
});

test("accepts only complete sanitized evidence and removes only an exactly bound completed journal", () => {
  const evidence = acceptedEvidence();
  assert.equal(validateAcceptedEvidence(evidence).accepted, true);
  assert.equal(validateCompletedRestart(evidence, null, {
    operatorCommit: OPERATOR_COMMIT,
    operatorCiRunId: 123,
  }), true);
  const finalState = baseState({
    stage: "final-promoted",
    oldSecretSha256: OLD_SECRET_SHA256,
    previousEnvironmentId: PREVIOUS_ID,
    dualDeploymentId: "dpl_Dual123",
    dualDeploymentUrl: "dual.vercel.app",
    dualPromotedAt: "2026-09-02T21:20:00.000Z",
    finalDeploymentId: "dpl_Final123",
    finalDeploymentUrl: "final.vercel.app",
  });
  assert.equal(validateCompletedRestart(evidence, finalState, {
    operatorCommit: OPERATOR_COMMIT,
    operatorCiRunId: 123,
  }), true);

  assert.throws(() => validateAcceptedEvidence(acceptedEvidence({ drainSeconds: 1 })));
  assert.throws(() => validateAcceptedEvidence(acceptedEvidence({ currentEnvironmentIds: [] })));
  assert.throws(() => validateCompletedRestart(evidence, {
    ...finalState,
    stage: "final-ready",
  }, {
    operatorCommit: OPERATOR_COMMIT,
    operatorCiRunId: 123,
  }));
  assert.throws(() => validateCompletedRestart(evidence, finalState, {
    operatorCommit: "b".repeat(40),
    operatorCiRunId: 123,
  }));
});

test("keeps the live operator narrow, secret-free on stdout, and non-destructive to deployments", () => {
  const source = readFileSync("scripts/shipping-rate-secret-credential-exposure-recovery.mjs", "utf8");
  assert.match(source, /CURRENT_ENVIRONMENTS = Object\.freeze\(\[/);
  assert.match(source, /target: \["production"\]/);
  assert.match(source, /SHIPPING_RATE_SECRET_PREVIOUS/);
  assert.match(source, /"secret", "set", "SHIPPING_RATE_SECRET"/);
  assert.match(source, /"--prod", "--skip-domain", "--force", "--yes"/);
  assert.match(source, /await waitForDrain\(state\.dualPromotedAt\)/);
  assert.match(source, /proveLocalVerifier\(state\.oldSecret, state\.replacementSecret, "final"\)/);
  assert.match(source, /if \(state !== null\) rmSync\(JOURNAL\)/);
  assert.match(source, /Shipping-rate credential recovery failed closed\./);
  assert.doesNotMatch(source, /error\.message/);
  assert.doesNotMatch(source, /console\.(?:log|error)\(/);
  assert.doesNotMatch(source, /"deployments"[^\n]*"DELETE"/);
  assert.doesNotMatch(source, /vercel[^\n]*(?:remove|rm)/i);
  assert.doesNotMatch(source, /gh[^\n]*secret[^\n]*(?:remove|delete)/i);
});
