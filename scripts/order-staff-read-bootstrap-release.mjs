// Pure release attestation. No observation collection or production entrypoint.
import assert from "node:assert/strict";

const COMMIT = /^[0-9a-f]{40}$/u;
const RUN = /^[1-9][0-9]{0,19}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PROJECT = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
const TEAM = "team_wvQeQHZGwCSwinC1uB7xbpjr";
const ALIASES = ["grainline-drew-youngs-projects.vercel.app", "grainline.vercel.app", "thegrainline.com", "www.thegrainline.com"].sort();
const KEYS = ["releaseCommit", "ciRunId", "deployedSourceCommit", "deploymentId", "credentialEpochSha256",
  "tlsProofRunId", "tlsProofJobId", "tlsProofRunAttempt"].sort();
const REQUIRED_TLS_STEPS = ["Enable TLS only on the disposable proof service",
  "Prove real TLS channel-bound bootstrap and exact restart", "Stop containers"];

export function assertStaffBootstrapReviewedBinding(value) {
  try {
    const reviewed = structuredClone(value);
    assert.ok(reviewed && JSON.stringify(Object.keys(reviewed).sort()) === JSON.stringify(KEYS));
    for (const field of KEYS) assert.ok(typeof reviewed[field] === "string" && reviewed[field] === reviewed[field].trim());
    assert.ok(COMMIT.test(reviewed.releaseCommit) && COMMIT.test(reviewed.deployedSourceCommit) &&
      RUN.test(reviewed.ciRunId) && /^dpl_[A-Za-z0-9]{20,40}$/u.test(reviewed.deploymentId) &&
      DIGEST.test(reviewed.credentialEpochSha256));
    for (const key of ["tlsProofRunId", "tlsProofJobId", "tlsProofRunAttempt"]) assert.ok(RUN.test(reviewed[key]));
    return Object.freeze(reviewed);
  } catch { throw new Error("staff bootstrap reviewed binding is invalid"); }
}

// reviewed must come from the sealed, authorized release artifact, not CLI
// overrides. Other arguments must come from independently fetched observations.
// The future production entrypoint must supply both; this is not self-attestation.
export function assertStaffBootstrapRelease({ reviewed, git, ci, tlsProofRun, tlsProofJob, deployment, credentialEpoch }) {
  try {
    reviewed = assertStaffBootstrapReviewedBinding(reviewed);
    assert.ok(git?.head === reviewed.releaseCommit && git.remoteMain === reviewed.releaseCommit &&
      git.status === "" && git.repository === "Drewyoung910/grainline");
    assert.ok(Number.isSafeInteger(ci?.id) && String(ci.id) === reviewed.ciRunId &&
      ci.repository?.full_name === "Drewyoung910/grainline" && ci.head_sha === reviewed.releaseCommit &&
      ci.head_branch === "main" && ci.path === ".github/workflows/ci.yml" && ci.event === "push" &&
      ci.status === "completed" && ci.conclusion === "success");
    assert.ok(Number.isSafeInteger(tlsProofRun?.id) && String(tlsProofRun.id) === reviewed.tlsProofRunId &&
      Number.isSafeInteger(tlsProofRun.run_attempt) && String(tlsProofRun.run_attempt) === reviewed.tlsProofRunAttempt &&
      tlsProofRun.repository?.full_name === "Drewyoung910/grainline" && tlsProofRun.head_sha === reviewed.releaseCommit &&
      tlsProofRun.head_branch === "main" && tlsProofRun.path === ".github/workflows/order-staff-bootstrap-proof.yml" &&
      tlsProofRun.event === "push" && tlsProofRun.status === "completed" && tlsProofRun.conclusion === "success");
    assert.ok(Number.isSafeInteger(tlsProofJob?.id) && String(tlsProofJob.id) === reviewed.tlsProofJobId &&
      tlsProofJob.run_id === tlsProofRun.id && tlsProofJob.run_attempt === tlsProofRun.run_attempt &&
      tlsProofJob.head_sha === reviewed.releaseCommit && tlsProofJob.name === "tls-login" &&
      tlsProofJob.status === "completed" && tlsProofJob.conclusion === "success" && Array.isArray(tlsProofJob.steps) &&
      tlsProofJob.steps.every(step => step.status === "completed" && step.conclusion === "success") &&
      REQUIRED_TLS_STEPS.every(name => tlsProofJob.steps.filter(step => step.name === name).length === 1));
    // deployment is a normalized independently read snapshot, including each
    // canonical alias's resolved ID and source-provenance verification.
    assert.ok(deployment?.id === reviewed.deploymentId && deployment.projectId === PROJECT &&
      deployment.teamId === TEAM && deployment.target === "production" && deployment.readyState === "READY" &&
      deployment.sourceCommit === reviewed.deployedSourceCommit && Array.isArray(deployment.aliases) &&
      deployment.aliases.length === ALIASES.length &&
      JSON.stringify(deployment.aliases.map(item => item.hostname).sort()) === JSON.stringify(ALIASES) &&
      deployment.aliases.every(item => item.deploymentId === reviewed.deploymentId));
    assert.ok(credentialEpoch?.evidenceSha256 === reviewed.credentialEpochSha256 &&
      credentialEpoch.status === "complete" && credentialEpoch.currentCredentialsMatch === true);
    return Object.freeze({ releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId,
      tlsProofRunId: reviewed.tlsProofRunId, tlsProofJobId: reviewed.tlsProofJobId,
      tlsProofRunAttempt: reviewed.tlsProofRunAttempt,
      deploymentId: reviewed.deploymentId, credentialEpochSha256: reviewed.credentialEpochSha256 });
  } catch {
    throw new Error("staff bootstrap release observations do not match the reviewed binding");
  }
}
