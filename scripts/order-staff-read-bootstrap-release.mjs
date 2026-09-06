// Pure release attestation. No observation collection or production entrypoint.
import assert from "node:assert/strict";

const COMMIT = /^[0-9a-f]{40}$/u;
const RUN = /^[1-9][0-9]{0,19}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PROJECT = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
const TEAM = "team_wvQeQHZGwCSwinC1uB7xbpjr";
const ALIASES = ["grainline-drew-youngs-projects.vercel.app", "grainline.vercel.app", "thegrainline.com", "www.thegrainline.com"].sort();
const KEYS = ["releaseCommit", "ciRunId", "deployedSourceCommit", "deploymentId", "credentialEpochSha256"].sort();

// reviewed must come from the sealed, authorized release artifact, not CLI
// overrides. Other arguments must come from independently fetched observations.
// The future production entrypoint must supply both; this is not self-attestation.
export function assertStaffBootstrapRelease({ reviewed, git, ci, deployment, credentialEpoch }) {
  try {
    assert.ok(reviewed && JSON.stringify(Object.keys(reviewed).sort()) === JSON.stringify(KEYS));
    for (const field of KEYS) assert.ok(typeof reviewed[field] === "string" && reviewed[field] === reviewed[field].trim());
    assert.ok(COMMIT.test(reviewed.releaseCommit) && COMMIT.test(reviewed.deployedSourceCommit) &&
      RUN.test(reviewed.ciRunId) && /^dpl_[A-Za-z0-9]{20,40}$/u.test(reviewed.deploymentId) &&
      DIGEST.test(reviewed.credentialEpochSha256));
    assert.ok(git?.head === reviewed.releaseCommit && git.remoteMain === reviewed.releaseCommit &&
      git.status === "" && git.repository === "Drewyoung910/grainline");
    assert.ok(Number.isSafeInteger(ci?.id) && String(ci.id) === reviewed.ciRunId &&
      ci.repository?.full_name === "Drewyoung910/grainline" && ci.head_sha === reviewed.releaseCommit &&
      ci.head_branch === "main" && ci.path === ".github/workflows/ci.yml" && ci.event === "push" &&
      ci.status === "completed" && ci.conclusion === "success");
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
      deploymentId: reviewed.deploymentId, credentialEpochSha256: reviewed.credentialEpochSha256 });
  } catch {
    throw new Error("staff bootstrap release observations do not match the reviewed binding");
  }
}
