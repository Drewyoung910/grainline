import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAIL = "Admin GitHub consumer proof refused; no credential disclosed.";
const check = value => { if (!value) throw new Error(FAIL); };
const REPOSITORY = "Drewyoung910/grainline";
const WORKFLOW = `${REPOSITORY}/.github/workflows/admin-consumer-proof.yml@refs/heads/main`;
const commit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
const CODES = new Set(["execution-context", "source-binding", "run-identity", "review-input", "review-shape",
  "review-freshness", "credential-boundary", "credential-format", "credential-pair-mismatch", "artifact-directory", "artifact-write", "checkout-read"]);
const failure = code => Object.assign(new Error(FAIL), { failureCode: CODES.has(code) ? code : "execution-context" });

function reviewFields(review) {
  check(commit(review.commitSha) && digest(review.nonce) && uuid(review.operationId));
  const captured = Date.parse(review.capturedAt);
  check(typeof review.capturedAt === "string" && Number.isFinite(captured)
    && new Date(captured).toISOString() === review.capturedAt);
  return captured;
}

// Hashes only the already public, keyed review, never a raw PIN or credential.
// The receiver binds this digest to its locally generated dispatch review so an
// artifact cannot substitute another pair comparison under the same nonce.
export function adminGitHubReviewDigest(review) {
  try {
    check(exact(review, ["operationId", "commitSha", "nonce", "capturedAt", "pairHmacSha256"])
      && digest(review.pairHmacSha256));
    reviewFields(review);
    return createHash("sha256").update(JSON.stringify([review.operationId, review.commitSha,
      review.nonce, review.capturedAt, review.pairHmacSha256])).digest("hex");
  } catch { throw failure("review-shape"); }
}

function pairMac({ pin, cookieSecret, review }) {
  check(typeof pin === "string" && /^[0-9]{6}$/.test(pin)
    && typeof cookieSecret === "string" && /^[A-Za-z0-9_-]{64}$/.test(cookieSecret));
  const key = Buffer.from(cookieSecret, "base64url");
  let message;
  try {
    check(key.length === 48 && key.toString("base64url") === cookieSecret);
    // The high-entropy prepared cookie secret is the HMAC key. Never publish a
    // standalone hash/MAC keyed by the six-digit PIN: that permits enumeration.
    message = Buffer.from(JSON.stringify(["grainline-admin-repository-consumer-v1", REPOSITORY, WORKFLOW,
      review.operationId, review.commitSha, review.nonce, review.capturedAt, pin]));
    return createHmac("sha256", key).update(message).digest();
  } finally { key.fill(0); message?.fill(0); }
}

// Call only inside the existing private prepared-input scope. This helper does
// not read a file, print credentials, dispatch a run, or claim provider proof.
// A fresh random nonce is generated here; callers durably consume it once.
export function makeAdminGitHubConsumerReview({ pin, cookieSecret, operationId, commitSha, now = Date.now() }) {
  let mac;
  try {
    check(Number.isSafeInteger(now) && now > 0);
    const review = { operationId, commitSha, nonce: randomBytes(32).toString("hex"), capturedAt: new Date(now).toISOString() };
    reviewFields(review);
    mac = pairMac({ pin, cookieSecret, review });
    return Object.freeze({ ...review, pairHmacSha256: mac.toString("hex") });
  } catch { throw failure("review-input"); }
  finally { mac?.fill(0); }
}

// The returned JSON cannot establish its own GitHub provenance. Acceptance
// requires native verification of the exact run, source, artifact and nonce.
export function makeAdminGitHubConsumerEvidence({ environment: env, checkoutCommit, now = Date.now() }) {
  let stage = "execution-context", actual, expected;
  try {
    check(env && env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch"
      && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === "refs/heads/main"
      && env.GITHUB_WORKFLOW_REF === WORKFLOW && env.GITHUB_JOB === "proof");
    stage = "source-binding";
    check(commit(env.GITHUB_SHA) && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
      && checkoutCommit === env.GITHUB_SHA && env.ADMIN_CONSUMER_RELEASE_COMMIT === env.GITHUB_SHA);
    stage = "run-identity";
    check(typeof env.GITHUB_RUN_ID === "string" && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID)
      && env.GITHUB_RUN_ATTEMPT === "1");
    stage = "review-input";
    check(env.ADMIN_CONSUMER_CONFIRM === "prove-reviewed-admin-repository-consumer"
      && typeof env.ADMIN_CONSUMER_REVIEW_JSON === "string" && env.ADMIN_CONSUMER_REVIEW_JSON.length <= 2048
      && Number.isSafeInteger(now) && now > 0);
    const review = JSON.parse(env.ADMIN_CONSUMER_REVIEW_JSON);
    stage = "review-shape";
    check(exact(review, ["operationId", "commitSha", "nonce", "capturedAt", "pairHmacSha256"])
      && review.commitSha === checkoutCommit && digest(review.pairHmacSha256));
    const captured = reviewFields(review);
    stage = "review-freshness";
    check(captured <= now && now - captured <= 300000);
    stage = "credential-boundary";
    check(Object.entries(env).every(([key, value]) => !value || !(
      ["DATABASE_URL", "DIRECT_URL", "PRODUCTION_MIGRATION_DIRECT_URL", "CLERK_SECRET_KEY", "GITHUB_TOKEN", "GH_TOKEN"].includes(key)
      || key.startsWith("CLOUDFLARE_") || key.startsWith("DIRECT_UPLOAD_CLEANUP_")
      || (key.startsWith("ADMIN_PIN") && !["ADMIN_PIN", "ADMIN_PIN_COOKIE_SECRET"].includes(key)))));
    stage = "credential-format";
    actual = pairMac({ pin: env.ADMIN_PIN, cookieSecret: env.ADMIN_PIN_COOKIE_SECRET, review });
    expected = Buffer.from(review.pairHmacSha256, "hex");
    stage = "credential-pair-mismatch";
    check(timingSafeEqual(actual, expected));
    return Object.freeze({ schemaVersion: 1, operation: "admin-github-configured-consumer", repository: REPOSITORY,
      workflowRef: WORKFLOW, commitSha: checkoutCommit, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
      operationId: review.operationId, nonce: review.nonce, reviewSha256: adminGitHubReviewDigest(review),
      reviewedAt: review.capturedAt, capturedAt: new Date(now).toISOString(),
      comparedFields: 2, matchesReviewedPair: true, repositorySecretMetadataVerified: false,
      providerRunProvenanceVerified: false, consumerConvergenceProven: false, credentialRecoveryAccepted: false,
      productionMutationPerformed: false });
  } catch { throw failure(stage); }
  finally { actual?.fill(0); expected?.fill(0); }
}

export function writeAdminGitHubConsumerEvidence(options) {
  let fd, stage = "execution-context";
  try {
    const record = makeAdminGitHubConsumerEvidence(options);
    stage = "artifact-directory";
    const directory = options.environment.RUNNER_TEMP;
    check(typeof directory === "string" && isAbsolute(directory) && realpathSync(directory) === directory);
    const stat = lstatSync(directory); check(stat.isDirectory() && stat.uid === process.getuid());
    const path = join(directory, `admin-consumer-${record.runId}-${record.runAttempt}.json`);
    stage = "artifact-write";
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(record, null, 2) + "\n"); fsyncSync(fd);
    return path;
  } catch (error) { throw failure(CODES.has(error?.failureCode) ? error.failureCode : stage); }
  finally { if (fd !== undefined) closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const checkoutCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 128,
    }).toString("utf8").trim();
    writeAdminGitHubConsumerEvidence({ environment: process.env, checkoutCommit });
    console.log("Admin repository credential pair matched; sanitized artifact saved.");
  } catch (error) {
    console.error(FAIL);
    console.error(`Admin consumer failure code: ${CODES.has(error?.failureCode) ? error.failureCode : "checkout-read"}`);
    process.exitCode = 1;
  }
}
