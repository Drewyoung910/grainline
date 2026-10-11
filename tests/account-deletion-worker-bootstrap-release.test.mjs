import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { assertAccountDeletionBootstrapRelease } from "../scripts/account-deletion-worker-bootstrap-release.mjs";
import { accountDeletionReleaseFixture } from "./helpers/account-deletion-bootstrap-release-fixture.mjs";

test("account deletion bootstrap release binds clean exact main, CI, unchanged deployment and credential epoch", () => {
  const value = accountDeletionReleaseFixture();
  const result = assertAccountDeletionBootstrapRelease(value);
  assert.deepEqual(result, { releaseCommit: value.reviewed.releaseCommit, ciRunId: "34010014880",
    tlsProofRunId: "34021451851", tlsProofJobId: "101454688066", tlsProofRunAttempt: "1",
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
    value => { value.credentialEpoch.localCredentialsMatch = false; },
  ];
  for (const mutate of mutations) {
    const value = accountDeletionReleaseFixture();
    mutate(value);
    assert.throws(() => assertAccountDeletionBootstrapRelease(value), /observations do not match/u);
  }
  for (const field of Object.keys(accountDeletionReleaseFixture())) {
    const value = accountDeletionReleaseFixture();
    delete value[field];
    assert.throws(() => assertAccountDeletionBootstrapRelease(value), /observations do not match/u);
  }
});

test("TLS proof must be the exact main push, run attempt and successful unskipped job", () => {
  const mutations = [
    value => { value.tlsProofRun.id += 1; },
    value => { value.tlsProofRun.run_attempt += 1; },
    value => { value.tlsProofRun.head_sha = "b".repeat(40); },
    value => { value.tlsProofRun.repository.full_name = "other/grainline"; },
    value => { value.tlsProofRun.head_branch = "draft"; },
    value => { value.tlsProofRun.event = "pull_request"; },
    value => { value.tlsProofRun.path = ".github/workflows/ci.yml"; },
    value => { value.tlsProofRun.conclusion = "failure"; },
    value => { value.tlsProofRun.status = "in_progress"; },
    value => { value.tlsProofJob.id += 1; },
    value => { value.tlsProofJob.run_id += 1; },
    value => { value.tlsProofJob.run_attempt += 1; },
    value => { value.tlsProofJob.head_sha = "b".repeat(40); },
    value => { value.tlsProofJob.name = "different"; },
    value => { value.tlsProofJob.status = "in_progress"; },
    value => { value.tlsProofJob.conclusion = "failure"; },
    value => { value.tlsProofJob.steps[1].conclusion = "skipped"; },
    value => { value.tlsProofJob.steps[1].status = "queued"; },
    value => { value.tlsProofJob.steps.pop(); },
    value => { value.tlsProofJob.steps.push(value.tlsProofJob.steps[1]); },
  ];
  for (const mutate of mutations) {
    const value = accountDeletionReleaseFixture();
    mutate(value);
    assert.throws(() => assertAccountDeletionBootstrapRelease(value), /observations do not match/u);
  }
});

test("standalone proof is available for every exact main head and refuses an accidentally disabled harness", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/account-deletion-worker-bootstrap-proof.yml", "utf8"));
  assert.deepEqual(workflow.on, { pull_request: { branches: ["main"] }, push: { branches: ["main"] } });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs["tls-login"];
  assert.equal(job.environment, undefined);
  assert.equal(job.services.postgres.image, "postgres:16");
  const proof = job.steps.find(step => step.name === "Prove real TLS channel-bound bootstrap and exact restart");
  assert.equal(proof.env.ACCOUNT_DELETION_WORKER_BOOTSTRAP_TLS_PROOF, "loopback-ci-postgres16");
  const command = proof.run.replace(/\s+/gu, " ");
  assert.ok(command.includes('test "$ACCOUNT_DELETION_WORKER_BOOTSTRAP_TLS_PROOF" = loopback-ci-postgres16'));
  assert.ok(command.includes('test -r "$ACCOUNT_DELETION_WORKER_BOOTSTRAP_TLS_PROOF_CA"'));
  assert.ok(command.indexOf("test -r") < command.indexOf("node --test"));
  const stop = job.steps.find(step => step.name === "Stop containers");
  assert.equal(stop.if, "always()");
  assert.equal(stop.env.PROOF_CONTAINER, "${{ job.services.postgres.id }}");
  assert.equal(stop.run, 'docker stop "$PROOF_CONTAINER"');
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\./u);
});
