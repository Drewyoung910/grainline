import { createHash } from "node:crypto";
import { readR2GitHubArtifact } from "./r2-github-artifact-reader.mjs";

const FAIL = "R2 GitHub receipt refused; refresh the reviewed run evidence.";
const check = value => { if (!value) throw new Error(FAIL); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const number = value => Number.isSafeInteger(value) && value > 0;
const REPO = "Drewyoung910/grainline";
const WORKFLOW = ".github/workflows/r2-application-consumer-proof.yml";
const SCRIPT = "scripts/r2-application-github-consumer-proof.mjs";
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(k => "CLOUDFLARE_R2_" + k);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const iso = value => { const time = Date.parse(value); check(typeof value === "string" && Number.isFinite(time)); return time; };
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function r2GitHubReceiptScope(value) {
  check(exact(value, ["repositoryId", "workflowId", "runId", "runAttempt", "artifactId", "actorId", "commitSha", "workflowSha256", "scriptSha256",
    "nonce", "snapshotSha256", "capturedAt", "dispatchedAt", "pairSha256", "valueSha256", "secretMetadata"]));
  for (const field of ["repositoryId", "workflowId", "runId", "runAttempt", "artifactId", "actorId"]) check(number(value[field]));
  check(typeof value.commitSha === "string" && /^[a-f0-9]{40}$/.test(value.commitSha));
  for (const field of ["workflowSha256", "scriptSha256", "nonce", "snapshotSha256", "pairSha256"]) check(sha(value[field]));
  check(exact(value.valueSha256, KEYS) && Object.values(value.valueSha256).every(sha)
    && exact(value.secretMetadata, KEYS));
  for (const key of KEYS) {
    const meta = value.secretMetadata[key]; check(exact(meta, ["created_at", "updated_at"]));
    check(iso(meta.created_at) <= iso(meta.updated_at) && iso(meta.updated_at) <= iso(value.dispatchedAt));
  }
  check(iso(value.capturedAt) <= iso(value.dispatchedAt) && iso(value.dispatchedAt) - iso(value.capturedAt) <= 300000);
  return structuredClone(value);
}

// Reads only the exact recorded run/attempt/artifact/source and five repository
// secret metadata rows. No dispatch, token mutation, log download or acceptance
// based solely on JSON assertions. The native adapter supplies authenticated GETs.
export async function receiveR2GitHubConsumerProof({ enabled = false, scope: supplied, read, clock = Date.now, signal }) {
  try {
    check(enabled === true && typeof read === "function"); const scope = r2GitHubReceiptScope(supplied);
    const now = clock(); check(number(now) && now >= iso(scope.dispatchedAt) && now - iso(scope.dispatchedAt) <= 900000);
    const bounded = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]);
    const call = async (op, key) => { bounded.throwIfAborted(); const result = await read(op, key, { signal: bounded }); bounded.throwIfAborted(); return result; };
    const runValid = run => {
      check(run.id === scope.runId && run.run_attempt === scope.runAttempt && run.workflow_id === scope.workflowId
        && run.repository?.id === scope.repositoryId && run.repository.full_name === REPO
        && run.head_repository?.id === scope.repositoryId && run.head_repository.full_name === REPO
        && run.head_sha === scope.commitSha && run.head_branch === "main" && run.path === WORKFLOW
        && run.event === "workflow_dispatch" && run.status === "completed" && run.conclusion === "success"
        && run.actor?.id === scope.actorId && run.triggering_actor?.id === scope.actorId
        && iso(run.created_at) >= iso(scope.dispatchedAt) - 1000 && iso(run.created_at) <= now
        && iso(run.updated_at) >= iso(run.created_at) && iso(run.updated_at) <= now);
    };
    const run = await call("run"); runValid(run);
    for (const [operation, path, digest] of [["workflow", WORKFLOW, scope.workflowSha256], ["script", SCRIPT, scope.scriptSha256]]) {
      const file = await call(operation);
      check(file.type === "file" && file.path === path && file.encoding === "base64" && typeof file.content === "string"
        && file.content.length <= 131072 && number(file.size) && file.size <= 65536);
      const bytes = Buffer.from(file.content, "base64"); check(bytes.length === file.size && hash(bytes) === digest);
    }
    const metadata = async () => {
      for (const key of KEYS) {
        const row = await call("secret", key), expected = scope.secretMetadata[key];
        check(row.name === key && row.created_at === expected.created_at && row.updated_at === expected.updated_at);
      }
    };
    await metadata();
    const jobs = await call("jobs");
    check(jobs.total_count === 1 && Array.isArray(jobs.jobs) && jobs.jobs.length === 1);
    const job = jobs.jobs[0];
    check(number(job.id) && job.run_id === scope.runId && job.run_attempt === scope.runAttempt && job.head_sha === scope.commitSha
      && job.name === "proof" && job.status === "completed" && job.conclusion === "success"
      && iso(job.started_at) >= iso(run.created_at) && iso(job.completed_at) <= now && iso(job.completed_at) >= iso(job.started_at));
    check(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.every(step => step.status === "completed" && step.conclusion === "success"));
    for (const name of ["Compare only application R2 credential fingerprints", "Save only the successful fingerprint comparison"])
      check(job.steps.filter(step => step.name === name).length === 1);
    const artifact = await call("artifact");
    const artifactName = `r2-application-consumer-${scope.runId}-${scope.runAttempt}`;
    const validArtifact = item => {
      check(item.id === scope.artifactId && item.name === artifactName && item.expired === false && number(item.size_in_bytes)
        && item.size_in_bytes <= 262144 && /^sha256:[a-f0-9]{64}$/.test(item.digest)
        && item.workflow_run?.id === scope.runId && item.workflow_run.repository_id === scope.repositoryId
        && item.workflow_run.head_repository_id === scope.repositoryId && item.workflow_run.head_sha === scope.commitSha
        && item.workflow_run.head_branch === "main" && iso(item.created_at) >= iso(job.started_at)
        && iso(item.created_at) <= iso(job.completed_at) && iso(item.expires_at) > now);
    };
    validArtifact(artifact);
    const zip = await call("archive");
    check(Buffer.isBuffer(zip) && zip.length === artifact.size_in_bytes && `sha256:${hash(zip)}` === artifact.digest);
    const evidence = readR2GitHubArtifact(zip, artifactName + ".json");
    check(exact(evidence, ["schemaVersion", "operation", "repository", "workflowRef", "commitSha", "runId", "runAttempt", "nonce",
      "reviewedSnapshotSha256", "capturedAt", "pairSha256", "valueSha256", "comparedFields", "matchesReviewedSnapshot",
      "providerRunProvenanceVerified", "consumerConvergenceProven", "productionMutationPerformed"])
      && evidence.schemaVersion === 1 && evidence.operation === "r2-github-configured-consumer" && evidence.repository === REPO
      && evidence.workflowRef === `${REPO}/${WORKFLOW}@refs/heads/main` && evidence.commitSha === scope.commitSha
      && evidence.runId === String(scope.runId) && evidence.runAttempt === String(scope.runAttempt)
      && evidence.nonce === scope.nonce && evidence.reviewedSnapshotSha256 === scope.snapshotSha256
      && evidence.pairSha256 === scope.pairSha256 && exact(evidence.valueSha256, KEYS)
      && KEYS.every(key => evidence.valueSha256[key] === scope.valueSha256[key]) && evidence.comparedFields === 5
      && evidence.matchesReviewedSnapshot === true && evidence.providerRunProvenanceVerified === false
      && evidence.consumerConvergenceProven === false && evidence.productionMutationPerformed === false
      && iso(evidence.capturedAt) >= iso(job.started_at) && iso(evidence.capturedAt) <= iso(job.completed_at)
      && iso(evidence.capturedAt) >= iso(scope.capturedAt) && iso(evidence.capturedAt) - iso(scope.capturedAt) <= 300000);
    await metadata();
    const finalArtifact = await call("artifact"); validArtifact(finalArtifact);
    check(finalArtifact.digest === artifact.digest && finalArtifact.size_in_bytes === artifact.size_in_bytes && finalArtifact.updated_at === artifact.updated_at);
    const finalRun = await call("run"); runValid(finalRun); check(finalRun.updated_at === run.updated_at);
    const finish = clock(); bounded.throwIfAborted(); check(finish >= now && finish - now <= 45000);
    return freeze({ schemaVersion: 1, operation: "r2-github-consumer-verified-receipt", repository: REPO, repositoryId: scope.repositoryId,
      commitSha: scope.commitSha, workflowId: scope.workflowId, runId: scope.runId, runAttempt: scope.runAttempt, artifactId: scope.artifactId,
      artifactSha256: hash(zip), nonce: scope.nonce, snapshotSha256: scope.snapshotSha256, pairSha256: scope.pairSha256,
      valueSha256: scope.valueSha256, providerRunProvenanceVerified: true, repositorySecretMetadataStable: true,
      atomicSecretSnapshotProven: false, consumerConvergenceProven: false, credentialRotationAccepted: false,
      productionMutationPerformed: false, capturedAt: new Date(finish).toISOString() });
  } catch { throw new Error(FAIL); }
}
