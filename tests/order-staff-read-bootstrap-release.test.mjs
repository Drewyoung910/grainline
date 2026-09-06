import assert from "node:assert/strict";
import test from "node:test";
import { assertStaffBootstrapRelease } from "../scripts/order-staff-read-bootstrap-release.mjs";

function fixture() {
  const releaseCommit = "a".repeat(40);
  const deploymentId = "dpl_" + "b".repeat(24);
  return {
    reviewed: { releaseCommit, ciRunId: "34010014880", deployedSourceCommit: "c".repeat(40),
      deploymentId, credentialEpochSha256: "d".repeat(64) },
    git: { head: releaseCommit, remoteMain: releaseCommit, status: "", repository: "Drewyoung910/grainline" },
    ci: { id: 34010014880, repository: { full_name: "Drewyoung910/grainline" }, head_sha: releaseCommit,
      head_branch: "main", path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success" },
    deployment: { id: deploymentId, projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp", teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
      target: "production", readyState: "READY", sourceCommit: "c".repeat(40),
      aliases: ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app", "grainline-drew-youngs-projects.vercel.app"]
        .map(hostname => ({ hostname, deploymentId })) },
    credentialEpoch: { evidenceSha256: "d".repeat(64), status: "complete", currentCredentialsMatch: true },
  };
}

test("staff bootstrap release binds clean exact main, CI, unchanged deployment and credential epoch", () => {
  const value = fixture();
  const result = assertStaffBootstrapRelease(value);
  assert.deepEqual(result, { releaseCommit: value.reviewed.releaseCommit, ciRunId: "34010014880",
    deploymentId: value.reviewed.deploymentId, credentialEpochSha256: value.reviewed.credentialEpochSha256 });
  assert.ok(Object.isFrozen(result));
});

test("every release identity, CI status, alias and credential epoch mismatch is refused", () => {
  const mutations = [
    value => { value.reviewed.extra = true; },
    value => { value.reviewed.releaseCommit += "\n"; },
    value => { value.reviewed.ciRunId = 34010014880; },
    value => { value.git.head = "b".repeat(40); },
    value => { value.git.remoteMain = "b".repeat(40); },
    value => { value.git.status = " M script"; },
    value => { value.git.repository = "attacker/grainline"; },
    value => { value.ci.id += 1; },
    value => { value.ci.id = String(value.ci.id); },
    value => { value.ci.repository.full_name = "attacker/grainline"; },
    value => { value.ci.head_sha = "b".repeat(40); },
    value => { value.ci.head_branch = "draft"; },
    value => { value.ci.event = "pull_request"; },
    value => { value.ci.path = ".github/workflows/different.yml"; },
    value => { value.ci.status = "in_progress"; },
    value => { value.ci.conclusion = "failure"; },
    value => { value.deployment.id += "X"; },
    value => { value.deployment.projectId = "other"; },
    value => { value.deployment.teamId = "other"; },
    value => { value.deployment.target = "preview"; },
    value => { value.deployment.readyState = "ERROR"; },
    value => { value.deployment.sourceCommit = "b".repeat(40); },
    value => { value.deployment.aliases.pop(); },
    value => { value.deployment.aliases[0].hostname = value.deployment.aliases[1].hostname; },
    value => { value.deployment.aliases[0].deploymentId += "X"; },
    value => { value.credentialEpoch.evidenceSha256 = "e".repeat(64); },
    value => { value.credentialEpoch.status = "pending"; },
    value => { value.credentialEpoch.currentCredentialsMatch = false; },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertStaffBootstrapRelease(value), /observations do not match/u);
  }
  for (const field of Object.keys(fixture())) {
    const value = fixture();
    delete value[field];
    assert.throws(() => assertStaffBootstrapRelease(value), /observations do not match/u);
  }
});
