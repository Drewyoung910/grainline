import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, realpathSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "js-yaml";
import { adminGitHubReviewDigest, makeAdminGitHubConsumerReview, makeAdminGitHubConsumerEvidence, writeAdminGitHubConsumerEvidence } from "../scripts/admin-github-consumer-proof.mjs";

const NOW = Date.parse("2026-09-22T02:30:00.000Z"), COMMIT = "a".repeat(40);
const FAIL = "Admin GitHub consumer proof refused; no credential disclosed.";
const PIN = "042731", COOKIE = Buffer.from(Array.from({ length: 48 }, (_, n) => n + 1)).toString("base64url");
const OPERATION = "12345678-abcd-4abc-8abc-123456789abc";
function fixture() {
  const review = makeAdminGitHubConsumerReview({ pin: PIN, cookieSecret: COOKIE, operationId: OPERATION, commitSha: COMMIT, now: NOW });
  const environment = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_JOB: "proof", GITHUB_SHA: COMMIT, GITHUB_WORKFLOW_SHA: COMMIT,
    GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/admin-consumer-proof.yml@refs/heads/main",
    GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1", ADMIN_CONSUMER_RELEASE_COMMIT: COMMIT,
    ADMIN_CONSUMER_CONFIRM: "prove-reviewed-admin-repository-consumer", ADMIN_CONSUMER_REVIEW_JSON: JSON.stringify(review),
    ADMIN_PIN: PIN, ADMIN_PIN_COOKIE_SECRET: COOKIE };
  return { review: { ...review }, options: { environment, checkoutCommit: COMMIT, now: NOW } };
}
const expectFailure = (f, code) => assert.throws(() => makeAdminGitHubConsumerEvidence(f.options), error => {
  assert.equal(error.message, FAIL); assert.equal(error.failureCode, code); assert.equal(error.cause, undefined);
  assert.equal(JSON.stringify(error).includes(PIN), false); assert.equal(JSON.stringify(error).includes(COOKIE), false);
  return true;
});

test("fresh reviews bind both prepared fields with the high entropy cookie key", () => {
  const f = fixture(), another = fixture();
  assert.notEqual(f.review.nonce, another.review.nonce);
  const message = JSON.stringify(["grainline-admin-repository-consumer-v1", "Drewyoung910/grainline",
    "Drewyoung910/grainline/.github/workflows/admin-consumer-proof.yml@refs/heads/main", OPERATION, COMMIT,
    f.review.nonce, new Date(NOW).toISOString(), PIN]);
  assert.equal(f.review.pairHmacSha256, createHmac("sha256", Buffer.from(COOKIE, "base64url")).update(message).digest("hex"));
  assert.notEqual(f.review.pairHmacSha256, createHash("sha256").update(PIN).digest("hex"));
  const output = makeAdminGitHubConsumerEvidence(f.options), text = JSON.stringify(output);
  for (const value of [PIN, COOKIE, f.review.pairHmacSha256, createHash("sha256").update(PIN).digest("hex")]) assert.equal(text.includes(value), false);
  assert.equal(output.matchesReviewedPair, true); assert.equal(output.comparedFields, 2);
  assert.equal(output.providerRunProvenanceVerified, false); assert.equal(output.consumerConvergenceProven, false);
  assert.equal(output.credentialRecoveryAccepted, false); assert.equal(output.productionMutationPerformed, false);
  assert.equal(output.nonce, f.review.nonce); assert.equal(output.operationId, OPERATION);
});

for (const [name, field, value, code] of [
  ["fork", "GITHUB_REPOSITORY", "other/grainline", "execution-context"],
  ["PR", "GITHUB_EVENT_NAME", "pull_request", "execution-context"],
  ["branch", "GITHUB_REF", "refs/heads/topic", "execution-context"],
  ["workflow", "GITHUB_WORKFLOW_REF", "other", "execution-context"],
  ["job", "GITHUB_JOB", "other", "execution-context"],
  ["workflow source", "GITHUB_WORKFLOW_SHA", "b".repeat(40), "source-binding"],
  ["release source", "ADMIN_CONSUMER_RELEASE_COMMIT", "b".repeat(40), "source-binding"],
  ["run path injection", "GITHUB_RUN_ID", "../escape", "run-identity"],
  ["rerun", "GITHUB_RUN_ATTEMPT", "2", "run-identity"],
  ["confirmation", "ADMIN_CONSUMER_CONFIRM", "", "review-input"],
  ["missing PIN", "ADMIN_PIN", "", "credential-format"],
  ["whitespace PIN", "ADMIN_PIN", PIN + "\n", "credential-format"],
  ["wrong PIN", "ADMIN_PIN", "000001", "credential-pair-mismatch"],
  ["wrong cookie", "ADMIN_PIN_COOKIE_SECRET", Buffer.alloc(48, 93).toString("base64url"), "credential-pair-mismatch"],
  ["short cookie", "ADMIN_PIN_COOKIE_SECRET", "short", "credential-format"],
  ["database", "DATABASE_URL", "sensitive", "credential-boundary"],
  ["provider key", "CLERK_SECRET_KEY", "sensitive", "credential-boundary"],
  ["admin override", "ADMIN_PIN_SECRET_MAP", "sensitive", "credential-boundary"],
  ["GitHub token", "GH_TOKEN", "sensitive", "credential-boundary"],
]) test(`refuses ${name} without revealing input values`, () => {
  const f = fixture(); f.options.environment[field] = value; expectFailure(f, code);
});

for (const [name, change, code] of [
  ["nonce", r => { r.nonce = "f".repeat(64); }, "credential-pair-mismatch"],
  ["operation", r => { r.operationId = "22345678-abcd-4abc-8abc-123456789abc"; }, "credential-pair-mismatch"],
  ["timestamp", r => { r.capturedAt = new Date(NOW - 1000).toISOString(); }, "credential-pair-mismatch"],
  ["source", r => { r.commitSha = "b".repeat(40); }, "review-shape"],
  ["injected field", r => { r.rawPin = PIN; }, "review-shape"],
  ["malformed MAC", r => { r.pairHmacSha256 = "not-a-mac"; }, "review-shape"],
  ["future timestamp", r => { r.capturedAt = new Date(NOW + 1).toISOString(); }, "review-freshness"],
  ["stale timestamp", r => { r.capturedAt = new Date(NOW - 300001).toISOString(); }, "review-freshness"],
]) test(`refuses changed review ${name}`, () => {
  const f = fixture(); change(f.review); f.options.environment.ADMIN_CONSUMER_REVIEW_JSON = JSON.stringify(f.review); expectFailure(f, code);
});

test("review freshness accepts exactly five minutes and rejects beyond", () => {
  const f = fixture(); f.options.now += 300000; assert.equal(makeAdminGitHubConsumerEvidence(f.options).matchesReviewedPair, true);
  f.options.now++; expectFailure(f, "review-freshness");
});

test("the public review digest binds the expected pair even when nonce and context stay the same", () => {
  const f = fixture(), other = { ...f.review, pairHmacSha256: "e".repeat(64) };
  assert.notEqual(adminGitHubReviewDigest(f.review), adminGitHubReviewDigest(other));
  assert.equal(makeAdminGitHubConsumerEvidence(f.options).reviewSha256, adminGitHubReviewDigest(f.review));
  assert.equal(adminGitHubReviewDigest(Object.fromEntries(Object.entries(f.review).reverse())), adminGitHubReviewDigest(f.review));
});

test("review generation rejects invalid private inputs without reflecting them", () => {
  for (const change of [{ pin: "bad-secret" }, { cookieSecret: "bad-secret" }, { operationId: "bad-secret" }, { commitSha: "bad-secret" }, { now: NaN }]) {
    assert.throws(() => makeAdminGitHubConsumerReview({ pin: PIN, cookieSecret: COOKIE, operationId: OPERATION, commitSha: COMMIT, now: NOW, ...change }),
      error => error.message === FAIL && error.failureCode === "review-input" && !JSON.stringify(error).includes("bad-secret"));
  }
});

test("provider-shaped exceptions are reduced to a fixed diagnostic", () => {
  const f = fixture(); Object.defineProperty(f.options.environment, "GITHUB_ACTIONS", { get() {
    throw Object.assign(new Error(COOKIE), { failureCode: PIN });
  } }); expectFailure(f, "execution-context");
});

test("artifact has mode 0600 and does not overwrite an existing file or symlink", t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "admin-consumer-proof-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(); f.options.environment.RUNNER_TEMP = directory;
  const path = writeAdminGitHubConsumerEvidence(f.options), bytes = readFileSync(path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(bytes), makeAdminGitHubConsumerEvidence(f.options));
  assert.throws(() => writeAdminGitHubConsumerEvidence(f.options)); assert.deepEqual(readFileSync(path), bytes);
  rmSync(path); const target = join(directory, "preserve"); writeFileSync(target, "preserve"); symlinkSync(target, path);
  assert.throws(() => writeAdminGitHubConsumerEvidence(f.options)); assert.equal(readFileSync(target, "utf8"), "preserve");
});

test("a failed comparison leaves no artifact", t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "admin-consumer-failed-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(); f.options.environment.RUNNER_TEMP = directory; f.options.environment.ADMIN_PIN = "999999";
  assert.throws(() => writeAdminGitHubConsumerEvidence(f.options)); assert.deepEqual(readdirSync(directory), []);
});

test("CLI refuses local source mismatch with only fixed diagnostics", () => {
  const result = spawnSync(process.execPath, [new URL("../scripts/admin-github-consumer-proof.mjs", import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ...fixture().options.environment }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), FAIL + "\nAdmin consumer failure code: source-binding");
});

test("workflow uses only two repository secrets in one main-only manual comparison step", () => {
  const text = readFileSync(new URL("../.github/workflows/admin-consumer-proof.yml", import.meta.url), "utf8"), workflow = YAML.load(text);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]); assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false); assert.equal(workflow.env, undefined);
  assert.deepEqual(Object.keys(workflow.jobs), ["proof"]); const job = workflow.jobs.proof;
  assert.equal(job.environment, undefined); assert.equal(job.env, undefined); assert.equal(job["timeout-minutes"], 5);
  assert.match(job.if, /github.repository == 'Drewyoung910\/grainline'/); assert.match(job.if, /github.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /github.event_name == 'workflow_dispatch'/); assert.match(job.if, /github.run_attempt == 1/);
  assert.equal(job.steps.length, 4); const [checkout, setup, proof, upload] = job.steps;
  for (const step of [checkout, setup, upload]) { assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/); assert.equal(step.env, undefined); }
  assert.equal(checkout.with.ref, "${{ github.sha }}"); assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(proof.run, "node scripts/admin-github-consumer-proof.mjs");
  assert.deepEqual(Object.entries(proof.env).filter(([, value]) => value.includes("secrets.")).map(([key]) => key), ["ADMIN_PIN", "ADMIN_PIN_COOKIE_SECRET"]);
  assert.equal(upload.if, undefined); assert.equal(upload.with["if-no-files-found"], "error"); assert.equal(upload.with["retention-days"], 7);
  assert.equal(text.includes("npm ci"), false); assert.equal(proof.run.includes("${{"), false);
});
