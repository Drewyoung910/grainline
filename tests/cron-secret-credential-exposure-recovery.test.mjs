import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  assertExactGitState,
  normalizeAliasPosition,
  normalizeAliasTargets,
  normalizeDeployment,
  normalizeMarkedDeploymentInventory,
  normalizeProbeResults,
  normalizeProjectProtection,
  normalizeProjectEnvironmentInventory,
  normalizeResolvedCronHashes,
  normalizeSharedEnvironmentInventory,
  sanitizedEvidence,
  validateAcceptedEvidence,
  validateState,
} from "../scripts/cron-secret-credential-exposure-recovery.mjs";

const COMMIT = "a".repeat(40);
const OLD = "o".repeat(48);
const REPLACEMENT = "n".repeat(96);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const CURRENT = {
  id: "env_Z5Adun6D9lSNFwiy53ucs4GK",
  key: "CRON_SECRET",
  type: "encrypted",
  ownerId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: ["prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp"],
  target: ["development", "preview", "production"],
};
const PREVIOUS = { ...CURRENT, id: "env_Previous123", key: "CRON_SECRET_PREVIOUS" };

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: "cron-secret-credential-exposure-recovery",
    stage: "dual-promoted",
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
    predecessorDeploymentId: "dpl_7DA9fNtQZV27smqAvSEJ6RrjtnC9",
    oldSecret: OLD,
    newSecret: REPLACEMENT,
    oldSecretSha256: hash(OLD),
    newSecretSha256: hash(REPLACEMENT),
    previousEnvironmentId: PREVIOUS.id,
    bridgeDeploymentId: "dpl_Bridge123",
    bridgeDeploymentUrl: "grainline-bridge.vercel.app",
    dualDeploymentId: "dpl_Dual123",
    dualDeploymentUrl: "grainline-dual.vercel.app",
    dualPromotedAt: "2026-09-02T12:00:00.000Z",
    finalDeploymentId: null,
    finalDeploymentUrl: null,
    createdAt: "2026-09-02T11:00:00.000Z",
    updatedAt: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

test("requires exact clean operator and exact deployment source Git state", () => {
  assert.equal(assertExactGitState({ head: COMMIT, status: "" }, COMMIT), true);
  assert.throws(() => assertExactGitState({ head: "b".repeat(40), status: "" }, COMMIT));
  assert.throws(() => assertExactGitState({ head: COMMIT, status: " M file" }, COMMIT));
});

test("pins the current shared cron variable and exact temporary previous variable", () => {
  const withoutPrevious = { data: [CURRENT], pagination: { next: null } };
  assert.deepEqual(normalizeSharedEnvironmentInventory(withoutPrevious), {
    currentId: CURRENT.id,
    previousId: null,
  });
  assert.deepEqual(normalizeSharedEnvironmentInventory({
    data: [CURRENT, PREVIOUS],
    pagination: { next: null },
  }, PREVIOUS.id), {
    currentId: CURRENT.id,
    previousId: PREVIOUS.id,
  });
  assert.deepEqual(normalizeSharedEnvironmentInventory({
    data: [CURRENT, PREVIOUS],
    pagination: { next: null },
  }, null, { allowAnyPrevious: true }), {
    currentId: CURRENT.id,
    previousId: PREVIOUS.id,
  });
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [{ ...CURRENT, projectId: [CURRENT.projectId[0], "another-project"] }],
    pagination: { next: null },
  }));
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [CURRENT],
    pagination: { next: 123 },
  }));
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [CURRENT, PREVIOUS, { ...PREVIOUS, id: "env_Duplicate" }],
    pagination: { next: null },
  }, PREVIOUS.id));
  assert.throws(() => normalizeSharedEnvironmentInventory({
    data: [CURRENT, { ...PREVIOUS, id: "not-a-shared-environment-id" }],
    pagination: { next: null },
  }, null, { allowAnyPrevious: true }));
});

test("pins the linked current record and rejects every project-local previous shadow", () => {
  const projectCurrent = {
    id: "LRWsHUt7PHsP3rRg",
    key: "CRON_SECRET",
    type: "encrypted",
    target: ["development", "preview", "production"],
    gitBranch: null,
    configurationId: null,
    customEnvironmentIds: [],
  };
  const projectPrevious = {
    ...projectCurrent,
    id: "PreviousProject123",
    key: "CRON_SECRET_PREVIOUS",
  };
  assert.deepEqual(normalizeProjectEnvironmentInventory({ envs: [projectCurrent] }), {
    currentId: projectCurrent.id,
    previousId: null,
  });
  assert.throws(() => normalizeProjectEnvironmentInventory({
    envs: [projectCurrent, projectPrevious],
  }));
  assert.throws(() => normalizeProjectEnvironmentInventory({
    envs: [{ ...projectCurrent, id: "project-shadow" }],
  }));
});

test("extracts exactly one current and previous digest without accepting malformed CLI output", () => {
  const current = "a".repeat(64);
  const previous = "b".repeat(64);
  const output = [
    "Vercel CLI 58.11.0",
    `GRAINLINE_CRON_CURRENT_SHA256:${current}`,
    `GRAINLINE_CRON_PREVIOUS_SHA256:${previous}`,
  ].join("\n");
  assert.deepEqual(normalizeResolvedCronHashes(output), { current, previous });
  assert.deepEqual(normalizeResolvedCronHashes(output.replace(previous, "absent")), {
    current,
    previous: "absent",
  });
  assert.throws(() => normalizeResolvedCronHashes(`${output}\nGRAINLINE_CRON_CURRENT_SHA256:${current}`));
  assert.throws(() => normalizeResolvedCronHashes(output.replace(previous, "wrong")));
});

test("requires Vercel SSO protection for every generated deployment URL", () => {
  assert.deepEqual(normalizeProjectProtection({
    id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    name: "grainline",
    ssoProtection: { deploymentType: "all_except_custom_domains" },
  }), { deploymentType: "all_except_custom_domains" });
  assert.throws(() => normalizeProjectProtection({
    id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    name: "grainline",
    ssoProtection: { deploymentType: "preview" },
  }));
});

test("replacement deployment and all canonical aliases are exact", () => {
  const replacement = normalizeDeployment({
    id: "dpl_Dual123",
    url: "grainline-dual.vercel.app",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
    marker: "marker",
    phase: "dual",
  }, "marker", "dual", "dpl_Predecessor");
  const aliases = ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"]
    .map((alias) => ({ alias, deployment: replacement }));
  assert.equal(normalizeAliasTargets(aliases, replacement.id), true);
  assert.equal(normalizeAliasPosition(aliases, "dpl_Predecessor", replacement.id), "to");
  const fromAliases = aliases.map((entry) => ({
    ...entry,
    deployment: { ...entry.deployment, id: "dpl_Predecessor" },
  }));
  assert.equal(normalizeAliasPosition(fromAliases, "dpl_Predecessor", replacement.id), "from");
  assert.throws(() => normalizeAliasPosition([
    fromAliases[0],
    aliases[1],
    aliases[2],
  ], "dpl_Predecessor", replacement.id));
  assert.throws(() => normalizeDeployment({ ...replacement, phase: "final" }, "marker", "dual", "dpl_Predecessor"));
  assert.throws(() => normalizeAliasTargets(aliases.slice(1), replacement.id));
});

test("marked deployment recovery accepts one exact result and rejects ambiguous or uncovered state", () => {
  const row = {
    uid: "dpl_Dual123",
    url: "grainline-dual.vercel.app",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    meta: {
      gitCommitSha: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
      grainlineCronCredentialRecovery: "marker",
      grainlineCronCredentialRecoveryPhase: "dual",
    },
  };
  assert.equal(normalizeMarkedDeploymentInventory({
    deployments: [row],
    pagination: { next: null },
  }, "2026-09-02T12:00:00.000Z", "marker", "dual", "dpl_Predecessor").id, row.uid);
  assert.equal(normalizeMarkedDeploymentInventory({
    deployments: [],
    pagination: { next: null },
  }, "2026-09-02T12:00:00.000Z", "marker", "dual", "dpl_Predecessor"), null);
  assert.throws(() => normalizeMarkedDeploymentInventory({
    deployments: [row, { ...row, uid: "dpl_Duplicate" }],
    pagination: { next: null },
  }, "2026-09-02T12:00:00.000Z", "marker", "dual", "dpl_Predecessor"));
  assert.throws(() => normalizeMarkedDeploymentInventory({
    deployments: [],
    pagination: { next: Date.parse("2026-09-02T12:01:00.000Z") },
  }, "2026-09-02T12:00:00.000Z", "marker", "dual", "dpl_Predecessor"));
});

test("dual and final probes preserve only their intended authentication behavior", () => {
  assert.deepEqual(normalizeProbeResults({ current: 404, previous: 404, wrong: 401 }, "dual"), {
    current: 404,
    previous: 404,
    wrong: 401,
  });
  assert.deepEqual(normalizeProbeResults({ current: 404, previous: 401, wrong: 401 }, "final"), {
    current: 404,
    previous: 401,
    wrong: 401,
  });
  assert.throws(() => normalizeProbeResults({ current: 404, previous: 404, wrong: 404 }, "dual"));
  assert.throws(() => normalizeProbeResults({ current: 404, previous: 404, wrong: 401 }, "final"));
});

test("private restart state binds secret digests, deployment phases and drain time", () => {
  assert.deepEqual(validateState(state(), { operatorCommit: COMMIT, operatorCiRunId: 123 }), state());
  assert.throws(() => validateState(state({ newSecretSha256: "0".repeat(64) }), {
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
  }));
  assert.throws(() => validateState(state({ dualPromotedAt: null }), {
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
  }));
  assert.throws(() => validateState(state({ bridgeDeploymentUrl: "https://attacker.example" }), {
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
  }));
  const final = state({
    stage: "final-ready",
    finalDeploymentId: "dpl_Final123",
    finalDeploymentUrl: "grainline-final.vercel.app",
  });
  assert.equal(validateState(final, { operatorCommit: COMMIT, operatorCiRunId: 123 }).stage, "final-ready");
});

test("sanitized evidence excludes credential values and records the protected-artifact boundary", () => {
  const final = state({
    stage: "final-promoted",
    finalDeploymentId: "dpl_Final123",
    finalDeploymentUrl: "grainline-final.vercel.app",
  });
  const evidence = sanitizedEvidence(
    { operatorCommit: COMMIT, operatorCiRunId: 123 },
    final,
    [{ route: "/", status: 200 }, { route: "/api/health", status: 200 }],
    { currentUpdatedAt: "2026-09-02T12:30:00.000Z" },
  );
  const encoded = JSON.stringify(evidence);
  assert.equal(evidence.credentials.oldCredentialRejectedOnCanonicalProduction, true);
  assert.equal(evidence.deployment.historicalGeneratedArtifactsPubliclyCallable, false);
  assert.equal(evidence.deployment.rollbackRequiresRebuildWithCurrentCredentials, true);
  assert.doesNotMatch(encoded, new RegExp(OLD));
  assert.doesNotMatch(encoded, new RegExp(REPLACEMENT));
  assert.deepEqual(evidence.migrationsApplied, []);
  assert.deepEqual(validateAcceptedEvidence(evidence, {
    operatorCommit: COMMIT,
    operatorCiRunId: 123,
  }), evidence);
  assert.throws(() => validateAcceptedEvidence({
    ...evidence,
    credentials: { ...evidence.credentials, oldCredentialRejectedOnCanonicalProduction: false },
  }, { operatorCommit: COMMIT, operatorCiRunId: 123 }));
  assert.throws(() => validateAcceptedEvidence({
    ...evidence,
    deployment: {
      ...evidence.deployment,
      canonicalRoutes: [{ route: "/", status: 200 }],
    },
  }, { operatorCommit: COMMIT, operatorCiRunId: 123 }));
  assert.throws(() => validateAcceptedEvidence({
    ...evidence,
    consumers: { ...evidence.consumers, githubRepositorySecretUpdatedAt: "invalid" },
  }, { operatorCommit: COMMIT, operatorCiRunId: 123 }));
});

test("operator has no migration, RLS, raw-secret output, or broad deployment deletion surface", () => {
  const source = fs.readFileSync("scripts/cron-secret-credential-exposure-recovery.mjs", "utf8");
  const recovery = source.slice(source.indexOf("export async function runRecovery"));
  assert.doesNotMatch(source, /prisma\s+migrate|migrate\s+deploy|ALTER TABLE|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:oldSecret|newSecret|CRON_SECRET)/);
  assert.doesNotMatch(source, /(?:remove|DELETE)[^\n]*(?:deployment|\/v13\/deployments)/i);
  assert.match(source, /all_except_custom_domains/);
  assert.match(source, /__credential-recovery-probe__/);
  assert.match(source, /grainlineCronCredentialRecoveryPhase=\$\{phase\}/);
  assert.match(source, /rollbackRequiresRebuildWithCurrentCredentials: true/);
  assert.doesNotMatch(source, /previousProjectEnvironmentId|projectEnvironmentInventory\([^)]/);
  assert.match(source, /route !== "\/v1\/env"[\s\S]*body\.ids\.length !== 1[\s\S]*--dangerously-skip-permissions/);
  assert.match(source, /output === "" && method === "DELETE"/);
  assert.match(source, /function createPreviousSecret[\s\S]*sharedInventory\(inventory\.previousId\);\n\s*projectEnvironmentInventory\(\);/);
  assert.match(source, /function updateDualSecrets[\s\S]*sharedInventory\(previousId\);\n\s*projectEnvironmentInventory\(\);/);
  assert.match(source, /function deletePreviousSecret[\s\S]*sharedInventory\(null\);\n\s*projectEnvironmentInventory\(\);/);
  assert.ok(recovery.indexOf("createPreviousSecret(") < recovery.indexOf('deployReplacement(state, "bridge"'));
  assert.ok(recovery.indexOf('writeState(state, "bridge-promoted"') < recovery.indexOf("updateDualSecrets("));
  assert.ok(recovery.indexOf("updateDualSecrets(") < recovery.indexOf('deployReplacement(state, "dual"'));
  assert.ok(recovery.indexOf("deletePreviousSecret(") < recovery.indexOf('deployReplacement(state, "final"'));
});
