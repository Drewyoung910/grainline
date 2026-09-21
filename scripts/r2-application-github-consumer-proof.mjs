import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAIL = "R2 GitHub consumer proof refused; no credential disclosed.";
const check = value => { if (!value) throw new Error(FAIL); };
const hash = value => createHash("sha256").update(value).digest("hex");
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const exact = (value, keys) => value && Object.keys(value).sort().join() === [...keys].sort().join();
const REPOSITORY = "Drewyoung910/grainline";
const WORKFLOW = `${REPOSITORY}/.github/workflows/r2-application-consumer-proof.yml@refs/heads/main`;
const PREFIX = "CLOUDFLARE_R2_";
const KEYS = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME", "PUBLIC_URL"].map(k => PREFIX + k);

// Pure fingerprint comparison. The payload alone is not evidence of a genuine
// GitHub execution: a consumer must independently verify the run and artifact.
export function makeR2GitHubConsumerEvidence({ environment, checkoutCommit, now = Date.now() }) {
  try {
    const env = environment;
    check(env && env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch"
      && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === "refs/heads/main"
      && env.GITHUB_WORKFLOW_REF === WORKFLOW && env.GITHUB_JOB === "proof"
      && commit(env.GITHUB_SHA) && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
      && checkoutCommit === env.GITHUB_SHA && env.R2_CONSUMER_RELEASE_COMMIT === env.GITHUB_SHA
      && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID) && /^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT)
      && env.R2_CONSUMER_CONFIRM === "prove-reviewed-r2-application-consumer"
      && typeof env.R2_CONSUMER_REVIEW_JSON === "string" && env.R2_CONSUMER_REVIEW_JSON.length <= 4096
      && Number.isSafeInteger(now) && now > 0);
    const review = JSON.parse(env.R2_CONSUMER_REVIEW_JSON);
    check(exact(review, ["nonce", "commitSha", "snapshotSha256", "capturedAt", "pairSha256", "valueSha256"])
      && sha(review.nonce) && commit(review.commitSha) && review.commitSha === checkoutCommit
      && sha(review.snapshotSha256) && sha(review.pairSha256) && exact(review.valueSha256, KEYS)
      && Object.values(review.valueSha256).every(sha));
    const captured = Date.parse(review.capturedAt);
    check(typeof review.capturedAt === "string" && Number.isFinite(captured)
      && new Date(captured).toISOString() === review.capturedAt && captured <= now && now - captured <= 300000);
    check(Object.entries(env).every(([key, value]) => !value || !(
      key.startsWith("DIRECT_UPLOAD_CLEANUP_") || ["PRODUCTION_MIGRATION_DIRECT_URL", "DATABASE_URL", "DIRECT_URL", PREFIX + "PRIVATE_BUCKET_NAME"].includes(key))));
    check(KEYS.every(key => typeof env[key] === "string" && env[key].length > 0 && env[key].length <= 4096 && !/[\x00-\x1f\x7f]/.test(env[key])));
    check(/^[a-f0-9]{32}$/.test(env[PREFIX + "ACCOUNT_ID"])
      && /^[A-Za-z0-9_-]{16,128}$/.test(env[PREFIX + "ACCESS_KEY_ID"])
      && /^[A-Za-z0-9_+/=-]{32,256}$/.test(env[PREFIX + "SECRET_ACCESS_KEY"]));
    const values = Object.fromEntries(KEYS.map(key => [key, hash(env[key])]));
    const pair = hash(env[PREFIX + "ACCESS_KEY_ID"] + "\0" + env[PREFIX + "SECRET_ACCESS_KEY"]);
    check(pair === review.pairSha256 && KEYS.every(key => values[key] === review.valueSha256[key]));
    return Object.freeze({ schemaVersion: 1, operation: "r2-github-configured-consumer", repository: REPOSITORY,
      workflowRef: WORKFLOW, commitSha: checkoutCommit, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
      nonce: review.nonce, reviewedSnapshotSha256: review.snapshotSha256, capturedAt: new Date(now).toISOString(),
      pairSha256: pair, valueSha256: Object.freeze(values), comparedFields: 5, matchesReviewedSnapshot: true,
      providerRunProvenanceVerified: false, consumerConvergenceProven: false, productionMutationPerformed: false });
  } catch { throw new Error(FAIL); }
}

export function writeR2GitHubConsumerEvidence({ environment, checkoutCommit, now = Date.now() }) {
  let fd;
  try {
    const record = makeR2GitHubConsumerEvidence({ environment, checkoutCommit, now });
    const directory = environment.RUNNER_TEMP;
    check(typeof directory === "string" && isAbsolute(directory) && realpathSync(directory) === directory);
    const output = join(directory, `r2-application-consumer-${record.runId}-${record.runAttempt}.json`);
    fd = openSync(output, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(record, null, 2) + "\n"); fsyncSync(fd);
    return output;
  } catch { throw new Error(FAIL); }
  finally { if (fd !== undefined) closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const checkoutCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 128,
    }).toString("utf8").trim();
    writeR2GitHubConsumerEvidence({ environment: process.env, checkoutCommit });
    console.log("R2 application credential fingerprints matched; sanitized artifact saved.");
  } catch { console.error(FAIL); process.exitCode = 1; }
}
