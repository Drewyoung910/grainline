import assert from "node:assert/strict";
import test from "node:test";
import {
  RELEASE_BINDING, PRODUCTION_ORIGIN, REQUIRED_ALIASES, REVIEWED_PROJECT,
  createInitialState, validateRestartState, verifyOperatorRelease,
  verifyDeploymentBoundary, parseGitHubCiRun, parseVercelDeployment,
  parseVercelAliasInspection,
} from "../scripts/order-authenticated-route-smoke.mjs";
import { SUCCESSOR_RELEASE_BINDING as successor } from "../scripts/order-authenticated-route-smoke-successor.mjs";

const operatorCommit = "c".repeat(40), operatorCiRunId = 987654;
const config = release => ({ operatorCommit, operatorCiRunId, release });
const canary = { id: "synthetic-canary", clerkUserId: "user_synthetic", role: "USER",
  termsAcceptedAt: null, termsVersion: null, ageAttestedAt: null,
  notificationPreferences: {}, emailPreferenceOptInAt: null };
const seller = { id: "synthetic-seller", userId: "synthetic-seller-user", stripeAccountId: "acct_synthetic" };
const ci = (commit, id) => ({ databaseId: id, headSha: commit, conclusion: "success",
  status: "completed", workflowName: "CI", headBranch: "main", event: "push" });
const deployment = release => ({ id: release.deploymentId, target: "production", readyState: "READY",
  meta: { gitCommitSha: release.commit }, project: { id: REVIEWED_PROJECT.projectId },
  team: { id: REVIEWED_PROJECT.orgId }, aliases: [...REQUIRED_ALIASES] });

for (const [label, release] of [["historical", RELEASE_BINDING], ["successor", successor]]) {
  test(`${label} journal creation and restart retain the selected application identity`, () => {
    const selected = config(release), state = createInitialState(selected, canary, seller);
    assert.equal(state.deployedCommit, release.commit);
    assert.equal(state.deployedCiRunId, release.ciRunId);
    assert.equal(state.deploymentId, release.deploymentId);
    assert.equal(state.operatorCommit, operatorCommit);
    assert.deepEqual(validateRestartState(state, selected, release, { allowLegacyCleanupRecovery: false }), state);
    const other = release === successor ? RELEASE_BINDING : successor;
    assert.throws(() => validateRestartState(state, config(other), other));
  });
}

test("missing explicit initial journal release fails instead of using the historical default", () => {
  assert.throws(() => createInitialState({ operatorCommit, operatorCiRunId }, canary, seller));
});

test("successor deployment and aliases accept only the selected source and deployment", () => {
  assert.notEqual(successor.deploymentId, RELEASE_BINDING.deploymentId);
  assert.equal(parseVercelDeployment(deployment(successor), successor).sourceCommit, successor.commit);
  assert.throws(() => parseVercelDeployment(deployment(successor)));
  assert.throws(() => parseVercelDeployment(deployment(RELEASE_BINDING), successor));
  assert.throws(() => parseVercelDeployment({ ...deployment(successor), meta: { gitCommitSha: RELEASE_BINDING.commit } }, successor));
  for (const alias of REQUIRED_ALIASES) {
    assert.equal(parseVercelAliasInspection(deployment(successor), alias, successor).deploymentId, successor.deploymentId);
    assert.throws(() => parseVercelAliasInspection(deployment(RELEASE_BINDING), alias, successor));
  }
});

test("source admission verifies operator CI, application CI, then selected deployment", () => {
  const calls = [];
  const result = verifyOperatorRelease(config(successor), {
    readGit: () => ({ branch: "main", head: operatorCommit, status: "" }),
    verifyCi: (commit, id) => { calls.push(["ci", commit, id]); return parseGitHubCiRun(ci(commit, id), commit, id); },
    verifyDeployment: release => { calls.push(["deployment", release.deploymentId]); return parseVercelDeployment(deployment(release), release); },
  });
  assert.deepEqual(calls, [["ci", operatorCommit, operatorCiRunId], ["ci", successor.commit, successor.ciRunId], ["deployment", successor.deploymentId]]);
  assert.equal(result.sourceCommit, successor.commit);
});

for (const failure of ["dirty", "operator-ci", "application-ci", "application-sha", "deployment"]) {
  test(`source admission stops at ${failure} without accepting a later boundary`, () => {
    const calls = [];
    assert.throws(() => verifyOperatorRelease(config(successor), {
      readGit: () => ({ branch: "main", head: operatorCommit, status: failure === "dirty" ? " M changed" : "" }),
      verifyCi: (commit, id) => {
        calls.push(commit === operatorCommit ? "operator" : "application");
        const value = ci(commit, id);
        if ((failure === "operator-ci" && commit === operatorCommit) || (failure === "application-ci" && commit === successor.commit)) value.conclusion = "failure";
        if (failure === "application-sha" && commit === successor.commit) value.headSha = RELEASE_BINDING.commit;
        return parseGitHubCiRun(value, commit, id);
      },
      verifyDeployment: release => {
        calls.push("deployment");
        return parseVercelDeployment(deployment(failure === "deployment" ? RELEASE_BINDING : release), release);
      },
    }));
    assert.deepEqual(calls, failure === "dirty" ? [] : failure === "operator-ci" ? ["operator"]
      : failure === "deployment" ? ["operator", "application", "deployment"] : ["operator", "application"]);
  });
}

for (const mode of ["current", "historical-marker", "unhealthy", "wrong-page-status"]) {
  test(`canonical boundary uses successor selection with ${mode}`, async () => {
    const calls = [];
    const request = async (url, options) => {
      calls.push(url); assert.equal(options.redirect, "manual"); assert.ok(options.signal instanceof AbortSignal);
      if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: mode !== "unhealthy" }), { status: 200 });
      return new Response(`<script src="/_next/x.js?dpl=${mode === "historical-marker" ? RELEASE_BINDING.deploymentId : successor.deploymentId}"></script>`, { status: mode === "wrong-page-status" ? 403 : 200 });
    };
    if (mode === "current") assert.deepEqual(await verifyDeploymentBoundary(successor, request), { canonicalDeploymentMarker: true, healthStatus: 200 });
    else await assert.rejects(verifyDeploymentBoundary(successor, request));
    assert.deepEqual(calls, mode === "unhealthy" ? [`${PRODUCTION_ORIGIN}/api/health`] : [`${PRODUCTION_ORIGIN}/api/health`, PRODUCTION_ORIGIN]);
  });
}

for (const field of ["deployedCommit", "deployedCiRunId", "deploymentId", "operatorCommit", "operatorCiRunId"]) {
  test(`successor restart rejects drift in ${field}`, () => {
    const selected = config(successor), state = createInitialState(selected, canary, seller);
    state[field] = typeof state[field] === "number" ? state[field] + 1 : "d".repeat(40);
    assert.throws(() => validateRestartState(state, selected, successor, { allowLegacyCleanupRecovery: false }));
  });
}

for (const change of [{ version: 1 }, { recoveredFromOperator: {} }]) {
  test(`successor refuses historical cleanup state ${Object.keys(change)[0]}`, () => {
    const selected = config(successor), state = { ...createInitialState(selected, canary, seller), ...change };
    assert.throws(() => validateRestartState(state, selected, successor, { allowLegacyCleanupRecovery: false }), /historical cleanup is unavailable/);
  });
}
