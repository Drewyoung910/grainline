// Fabricated metadata, never a live release attestation.
import { accountDeletionCredentialEpochSha256 } from "../../scripts/account-deletion-worker-bootstrap-release.mjs";

export function accountDeletionReleaseFixture() {
  const releaseCommit = "a".repeat(40);
  const deploymentId = "dpl_" + "b".repeat(24);
  const ownerCredentialEvidenceSha256 = "e".repeat(64);
  const runtimeCredentialEvidenceSha256 = "f".repeat(64);
  const credentialEpochSha256 = accountDeletionCredentialEpochSha256({
    ownerCredentialEvidenceSha256,
    runtimeCredentialEvidenceSha256,
  });
  return {
    reviewed: { releaseCommit, ciRunId: "34010014880", deployedSourceCommit: "c".repeat(40),
      deploymentId, credentialEpochSha256, ownerCredentialEvidenceSha256, runtimeCredentialEvidenceSha256,
      tlsProofRunId: "34021451851",
      tlsProofJobId: "101454688066", tlsProofRunAttempt: "1" },
    git: { head: releaseCommit, remoteMain: releaseCommit, status: "", repository: "Drewyoung910/grainline" },
    ci: { id: 34010014880, repository: { full_name: "Drewyoung910/grainline" }, head_sha: releaseCommit,
      head_branch: "main", path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success" },
    tlsProofRun: { id: 34021451851, run_attempt: 1, repository: { full_name: "Drewyoung910/grainline" },
      head_sha: releaseCommit, head_branch: "main", path: ".github/workflows/account-deletion-worker-bootstrap-proof.yml",
      event: "push", status: "completed", conclusion: "success" },
    tlsProofJob: { id: 101454688066, run_id: 34021451851, run_attempt: 1, head_sha: releaseCommit,
      name: "tls-login", status: "completed", conclusion: "success", steps: [
        "Enable TLS only on the disposable proof service", "Prove real TLS channel-bound bootstrap and exact restart", "Stop containers",
      ].map(name => ({ name, status: "completed", conclusion: "success" })) },
    deployment: { id: deploymentId, projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp", teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
      target: "production", readyState: "READY", sourceCommit: "c".repeat(40),
      aliases: ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app", "grainline-drew-youngs-projects.vercel.app"]
        .map(hostname => ({ hostname, deploymentId })) },
    credentialEpoch: { evidenceSha256: credentialEpochSha256, status: "complete", localCredentialsMatch: true },
  };
}
