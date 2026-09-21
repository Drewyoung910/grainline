import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FAIL = "Protected R2 identity check refused; no credential values or provider errors are reported.";
const check = v => { if (!v) throw new Error(FAIL); };
const digest = v => createHash("sha256").update(v).digest("hex");
const sha = v => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const required = (env, key, pattern) => { const v = env[key]; check(typeof v === "string" && pattern.test(v)); return v; };
const SHARED = ["DATABASE_URL", "DIRECT_URL", "PRODUCTION_MIGRATION_DIRECT_URL", "DIRECT_UPLOAD_CLEANUP_DATABASE_URL", "GRANT_AUDIT_DATABASE_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];

// Pure comparison input extraction. No provider, S3, database or filesystem
// access occurs here. The protected workflow is the credential source; native
// run/artifact provenance must still be checked by the receiving operator.
export function cleanupKeyIdentity(env, git) {
  try {
    check(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_REF === "refs/heads/main"
      && env.GITHUB_REPOSITORY === "Drewyoung910/grainline" && env.GITHUB_REPOSITORY_ID === "1062688469"
      && env.GITHUB_WORKFLOW_REF === "Drewyoung910/grainline/.github/workflows/r2-cleanup-key-identity.yml@refs/heads/main"
      && env.R2_CLEANUP_IDENTITY_CONFIRM === "compare-protected-r2-cleanup-key"
      && sha(env.R2_CLEANUP_IDENTITY_COMMIT) && env.GITHUB_SHA === env.R2_CLEANUP_IDENTITY_COMMIT
      && git?.head === env.GITHUB_SHA && git.clean === true
      && !Object.keys(env).some(k => k.startsWith("CLOUDFLARE_R2_") || SHARED.includes(k)));
    const operationId = required(env, "R2_CLEANUP_IDENTITY_OPERATION", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    const runId = required(env, "GITHUB_RUN_ID", /^[1-9][0-9]{0,19}$/), runAttempt = required(env, "GITHUB_RUN_ATTEMPT", /^1$/);
    const account = required(env, "DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID", /^[a-f0-9]{32}$/);
    const bucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
    const publicBucket = required(env, "DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET", bucketPattern);
    const privateBucket = required(env, "DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET", bucketPattern); check(publicBucket !== privateBucket);
    const access = required(env, "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID", /^[A-Za-z0-9_-]{16,128}$/);
    const secret = required(env, "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY", /^[A-Za-z0-9_+/=-]{32,256}$/);
    return Object.freeze({ schemaVersion: 1, operation: "protected-r2-cleanup-key-identity", operationId,
      sourceSha: git.head, runId, runAttempt, environment: "Production DirectUpload Cleanup",
      accountSha256: digest(account), publicBucketSha256: digest(publicBucket), privateBucketSha256: digest(privateBucket),
      accessKeyIdSha256: digest(access), credentialPairSha256: digest(access + "\0" + secret),
      credentialValuesDisclosed: false, providerRequestsPerformed: false, objectOperationsPerformed: false,
      databaseOperationsPerformed: false, rotationAccepted: false });
  } catch { throw new Error(FAIL); }
}

function main() {
  const env = process.env;
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const clean = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "";
  const result = cleanupKeyIdentity(env, { head, clean });
  check(typeof env.RUNNER_TEMP === "string" && realpathSync(env.RUNNER_TEMP) === env.RUNNER_TEMP);
  const dir = lstatSync(env.RUNNER_TEMP); check(dir.isDirectory() && dir.uid === process.getuid());
  const path = join(env.RUNNER_TEMP, `r2-cleanup-key-identity-${result.runId}-${result.runAttempt}.json`);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(result) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  process.stdout.write(JSON.stringify({ identityArtifactWritten: true, providerRequestsPerformed: false }) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { process.stderr.write(FAIL + "\n"); process.exitCode = 1; }
}
