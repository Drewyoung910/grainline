import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "js-yaml";
import { makeR2GitHubConsumerEvidence, writeR2GitHubConsumerEvidence } from "../scripts/r2-application-github-consumer-proof.mjs";

const NOW = Date.parse("2026-09-21T02:00:00.000Z"), COMMIT = "a".repeat(40);
const FAIL = "R2 GitHub consumer proof refused; no credential disclosed.";
const hash = value => createHash("sha256").update(value).digest("hex");
const PREFIX = "CLOUDFLARE_R2_";
function fixture() {
  const values = { ACCOUNT_ID: "d".repeat(32), ACCESS_KEY_ID: "synthetic-access-12345678", SECRET_ACCESS_KEY: "synthetic-secret-" + "b".repeat(40),
    BUCKET_NAME: "synthetic-public", PUBLIC_URL: "https://synthetic.example.test" };
  const review = { nonce: "c".repeat(64), commitSha: COMMIT, snapshotSha256: hash("synthetic snapshot"), capturedAt: new Date(NOW).toISOString(),
    pairSha256: hash(values.ACCESS_KEY_ID + "\0" + values.SECRET_ACCESS_KEY),
    valueSha256: Object.fromEntries(Object.entries(values).map(([k, v]) => [PREFIX + k, hash(v)])) };
  const environment = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "Drewyoung910/grainline", GITHUB_JOB: "proof", GITHUB_SHA: COMMIT, GITHUB_WORKFLOW_SHA: COMMIT,
    GITHUB_WORKFLOW_REF: "Drewyoung910/grainline/.github/workflows/r2-application-consumer-proof.yml@refs/heads/main",
    GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1", R2_CONSUMER_RELEASE_COMMIT: COMMIT,
    R2_CONSUMER_CONFIRM: "prove-reviewed-r2-application-consumer", R2_CONSUMER_REVIEW_JSON: JSON.stringify(review),
    ...Object.fromEntries(Object.entries(values).map(([k, v]) => [PREFIX + k, v])) };
  return { values, review, options: { environment, checkoutCommit: COMMIT, now: NOW } };
}

test("comparison binds source, run, nonce and snapshot while emitting no raw field values", () => {
  const f = fixture(), output = makeR2GitHubConsumerEvidence(f.options), text = JSON.stringify(output);
  assert.equal(output.pairSha256, f.review.pairSha256); assert.deepEqual(output.valueSha256, f.review.valueSha256);
  assert.equal(output.commitSha, COMMIT); assert.equal(output.nonce, f.review.nonce);
  assert.equal(output.reviewedSnapshotSha256, f.review.snapshotSha256); assert.equal(output.matchesReviewedSnapshot, true);
  assert.equal(output.providerRunProvenanceVerified, false); assert.equal(output.consumerConvergenceProven, false);
  assert.equal(output.productionMutationPerformed, false); assert.ok(Object.isFrozen(output.valueSha256));
  for (const value of Object.values(f.values)) assert.equal(text.includes(value), false);
});

for (const [name, field, value] of [
  ["pull request", "GITHUB_EVENT_NAME", "pull_request"], ["fork", "GITHUB_REPOSITORY", "other/grainline"],
  ["branch", "GITHUB_REF", "refs/heads/feature"], ["other workflow", "GITHUB_WORKFLOW_REF", "other"],
  ["other job", "GITHUB_JOB", "check"], ["mismatched workflow source", "GITHUB_WORKFLOW_SHA", "b".repeat(40)],
  ["unreviewed commit", "R2_CONSUMER_RELEASE_COMMIT", "b".repeat(40)], ["invalid run", "GITHUB_RUN_ID", "../../other"],
  ["invalid attempt", "GITHUB_RUN_ATTEMPT", "0"], ["missing confirmation", "R2_CONSUMER_CONFIRM", ""],
  ["missing credential", PREFIX + "SECRET_ACCESS_KEY", ""], ["different credential", PREFIX + "SECRET_ACCESS_KEY", "d".repeat(64)],
  ["private bucket", PREFIX + "PRIVATE_BUCKET_NAME", "private"], ["protected cleanup credential", "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY", "protected"],
  ["database credential", "DATABASE_URL", "postgresql://synthetic"],
]) test(`refuses ${name} without disclosing values`, () => {
  const f = fixture(); f.options.environment[field] = value;
  assert.throws(() => makeR2GitHubConsumerEvidence(f.options), error => error.message === FAIL && error.cause === undefined);
});

test("review cannot accept stale, future, incomplete or mismatched fingerprint evidence", () => {
  for (const change of [f => { f.review.capturedAt = new Date(NOW - 300001).toISOString(); },
    f => { f.review.capturedAt = new Date(NOW + 1).toISOString(); }, f => { delete f.review.valueSha256[PREFIX + "PUBLIC_URL"]; },
    f => { f.review.pairSha256 = hash("foreign"); }, f => { f.review.nonce = "short"; },
    f => { f.review.valueSha256[PREFIX + "BUCKET_NAME"] = hash("foreign"); }, f => { f.review.rawSecret = "do-not-emit"; },
    f => { f.options.checkoutCommit = "b".repeat(40); }]) {
    const f = fixture(); change(f); f.options.environment.R2_CONSUMER_REVIEW_JSON = JSON.stringify(f.review);
    assert.throws(() => makeR2GitHubConsumerEvidence(f.options), error => error.message === FAIL);
  }
});

test("artifact uses exclusive mode-0600 output and never overwrites a prior result or symlink", t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "r2-github-proof-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(); f.options.environment.RUNNER_TEMP = directory;
  const path = writeR2GitHubConsumerEvidence(f.options);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path)), makeR2GitHubConsumerEvidence(f.options));
  const bytes = readFileSync(path); assert.throws(() => writeR2GitHubConsumerEvidence(f.options));
  assert.deepEqual(readFileSync(path), bytes);
  rmSync(path); const target = join(directory, "preserve"); writeFileSync(target, "preserve"); symlinkSync(target, path);
  assert.throws(() => writeR2GitHubConsumerEvidence(f.options)); assert.equal(readFileSync(target, "utf8"), "preserve");
});

test("CLI refuses an unreviewed local invocation with only a sanitized diagnostic", () => {
  const result = spawnSync(process.execPath, [new URL("../scripts/r2-application-github-consumer-proof.mjs", import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ...fixture().options.environment }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr.trim(), FAIL);
});

test("manual-only workflow isolates five application secrets to the comparison step", () => {
  const text = readFileSync(new URL("../.github/workflows/r2-application-consumer-proof.yml", import.meta.url), "utf8"), workflow = YAML.load(text);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" }); assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(workflow.jobs), ["proof"]);
  const job = workflow.jobs.proof;
  assert.equal(job.environment, undefined); assert.equal(job.env, undefined);
  assert.match(job.if, /github.repository == 'Drewyoung910\/grainline'/); assert.match(job.if, /github.ref == 'refs\/heads\/main'/);
  assert.equal(job.steps.length, 4);
  const [checkout, setup, proof, upload] = job.steps;
  assert.equal(checkout.with.ref, "${{ github.sha }}"); assert.equal(checkout.with["persist-credentials"], false);
  for (const step of [checkout, setup, upload]) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.equal(proof.run, "node scripts/r2-application-github-consumer-proof.mjs");
  assert.deepEqual(Object.entries(proof.env).filter(([, v]) => v.includes("secrets.")).map(([key]) => key).sort(), Object.keys(fixture().review.valueSha256).sort());
  assert.equal(upload.with["if-no-files-found"], "error"); assert.equal(upload.if, undefined);
  assert.equal(text.includes("DIRECT_UPLOAD_CLEANUP"), false); assert.equal(text.includes("npm ci"), false);
  assert.equal(text.includes("${{ inputs."), true); assert.equal(proof.run.includes("${{"), false);
});
