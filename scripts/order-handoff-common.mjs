// Inactive proposal. All filesystem records below are non-credential records.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const FLAGS = Object.freeze({ productionExecutionAuthorized: false, completeProductionScope: false });
export const REPO = "Drewyoung910/grainline";
export const FAILURE = "Order handoff failed; preserve attempt; no automatic retry";
export const hash = value => createHash("sha256").update(value).digest("hex");
export const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
export const id = value => assert.ok(typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value)));
export const sha = value => assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
export const uuid = value => assert.match(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
const same = (a, b) => ["dev", "ino", "mode", "uid"].every(k => a[k] === b[k]);
export function directoryGuard(directory) {
  assert.equal(path.resolve(directory), directory); assert.equal(fs.realpathSync(directory), directory);
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700);
  return () => { assert.equal(fs.realpathSync(directory), directory); assert.ok(same(stat, fs.lstatSync(directory))); };
}
export function readBounded(file, limit = 16384, mode = 0o600) {
  assert.equal(fs.realpathSync(file), file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink === 1n
      && (before.mode & 0o7777n) === BigInt(mode) && before.size <= BigInt(limit));
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    for (const key of ["dev", "ino", "mode", "uid", "size", "mtimeNs", "ctimeNs", "nlink"]) {
      assert.equal(after[key], before[key]); assert.equal(named[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}
export const readJson = file => JSON.parse(readBounded(file).toString("utf8"));
export function pinFile(file) {
  const bytes = readBounded(file), stat = fs.lstatSync(file, { bigint: true });
  return () => {
    const current = fs.lstatSync(file, { bigint: true });
    for (const key of ["dev", "ino", "mode", "uid", "ctimeNs"]) assert.equal(current[key], stat[key]);
    assert.equal(hash(readBounded(file)), hash(bytes));
  };
}
export function writePrivate(file, value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(value) + "\n";
  assert.ok(Buffer.byteLength(bytes) <= 16384);
  const guard = directoryGuard(path.dirname(file)); guard();
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  guard(); const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  assert.equal(readBounded(file).toString(), bytes);
}
export function contextFromEnvironment(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true"); assert.equal(env.GITHUB_REPOSITORY, REPO);
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch"); assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_JOB, "migrate");
  assert.equal(env.GITHUB_WORKFLOW_REF, `${REPO}/.github/workflows/production-migrations.yml@refs/heads/main`);
  id(env.GITHUB_RUN_ID); id(env.GITHUB_RUN_ATTEMPT); assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/u);
  assert.match(env.RUNNER_NAME, /^[A-Za-z0-9 ._-]{1,100}$/u);
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, releaseCommit: env.GITHUB_SHA, runnerName: env.RUNNER_NAME };
}
export function validatePlan(input) {
  const plan = structuredClone(input);
  keys(plan, ["directory", "reviewed", "ci", "context", "scope", "confirmation"]);
  assert.equal(plan.scope, "order-compatible-prefix-17");
  assert.equal(plan.confirmation, "run-reviewed-production-migrations-from-main");
  assert.equal(fs.realpathSync(plan.directory), plan.directory); assert.equal(process.cwd(), plan.directory);
  keys(plan.context, ["runId", "runAttempt", "releaseCommit", "runnerName"]);
  id(plan.context.runId); id(plan.context.runAttempt); assert.match(plan.context.runnerName, /^[A-Za-z0-9 ._-]{1,100}$/u);
  keys(plan.reviewed, ["nodeSha256", "nodeVersion", "npmCli", "npmCliSha256", "npmVersion", "releaseCommit", "sourceCatalogSha256", "sourceFenceSha256"]);
  for (const key of ["nodeSha256", "npmCliSha256", "sourceCatalogSha256", "sourceFenceSha256"]) sha(plan.reviewed[key]);
  assert.match(plan.reviewed.releaseCommit, /^[a-f0-9]{40}$/u); assert.equal(plan.context.releaseCommit, plan.reviewed.releaseCommit);
  assert.match(plan.reviewed.nodeVersion, /^v22\.\d+\.\d+$/u); assert.equal(process.version, plan.reviewed.nodeVersion);
  assert.equal(hash(fs.readFileSync(fs.realpathSync(process.execPath))), plan.reviewed.nodeSha256);
  assert.equal(fs.realpathSync(plan.reviewed.npmCli), plan.reviewed.npmCli); assert.equal(path.basename(plan.reviewed.npmCli), "npm-cli.js");
  assert.match(plan.reviewed.npmVersion, /^\d+\.\d+\.\d+$/u);
  keys(plan.ci, ["ciRunId", "ciRunAttempt"]); id(plan.ci.ciRunId); id(plan.ci.ciRunAttempt);
  Object.freeze(plan.reviewed); Object.freeze(plan.context); Object.freeze(plan.ci); return Object.freeze(plan);
}
export function assertPreparationEnvironment(env = process.env) {
  for (const key of Object.keys(env)) assert.ok(!/^(?:.*(?:TOKEN|SECRET|PASSWORD)|DATABASE_URL|DIRECT_URL|GRANT_AUDIT_DATABASE_URL|NODE_OPTIONS|NODE_PATH|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY)$/iu.test(key));
}
export function validateReady(value, plan) {
  keys(value, ["version", "supervisorPid", "workerPid", "sessionId", "releaseCommit", "runId", "runAttempt", "nonceSha256", "phase", ...Object.keys(FLAGS)]);
  assert.equal(value.version, 1); assert.equal(value.phase, "awaiting-handoff");
  for (const key of ["supervisorPid", "workerPid"]) assert.ok(Number.isSafeInteger(value[key]) && value[key] > 0);
  uuid(value.sessionId); sha(value.nonceSha256);
  for (const key of ["releaseCommit", "runId", "runAttempt"]) assert.equal(value[key], plan.context[key]);
  for (const [key, expected] of Object.entries(FLAGS)) assert.equal(value[key], expected);
  return value;
}
