import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Resend } from "resend";

const ROOT = "/Users/drewyoung/grainline";
const SOURCE = "/private/tmp/grainline-order-shipping-production-deploy-20260902";
const LOCAL_ENV = path.join(ROOT, ".env.local");
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const JOURNAL = path.join(EVIDENCE_DIRECTORY, ".resend-credential-recovery-20260902.private.json");
const EVIDENCE = path.join(EVIDENCE_DIRECTORY, "resend-credential-recovery-20260902.json");
const VERCEL_CLI = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";

const REPOSITORY = "Drewyoung910/grainline";
const PROJECT = Object.freeze({
  id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  name: "grainline",
  scope: "drew-youngs-projects",
});
const SOURCE_COMMIT = "b22fa138d84bad792ba206ee00dacb48d475d4a4";
const PREDECESSOR_DEPLOYMENT = "dpl_AmW64aR14Yk47HK54kwiMSiKwkJD";
const OLD_KEY = Object.freeze({
  id: "4c666da1-7a62-4ad4-8014-0c646a8da911",
  name: "grainline-production",
});
const NEW_KEY_NAME = "grainline-production-recovery-20260902";
const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const COMMIT = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const STAGES = Object.freeze([
  "preflight",
  "provider-created",
  "github-updated",
  "vercel-updated",
  "local-updated",
  "deployment-ready",
  "promoted",
  "provider-revoked",
]);
const RESOLVED_SECRET_HASH_PREFIX = "GRAINLINE_RESEND_SECRET_SHA256:";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEnvironment(extra = {}) {
  const env = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function run(command, args, { cwd = ROOT, input, json = false, timeout = 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeEnvironment(),
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Resend recovery dependency failed");
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Resend recovery dependency returned invalid JSON");
  }
}

function assertPrivateFile(file, label) {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular mode-0600 file`);
  }
}

function writePrivate(file, value, { replace = false } = {}) {
  const temporary = `${file}.tmp-${process.pid}`;
  if (!replace && existsSync(file)) throw new Error("private recovery file already exists");
  writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}

function gitState(directory) {
  return Object.freeze({
    head: run("git", ["rev-parse", "HEAD"], { cwd: directory }),
    status: run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: directory }),
  });
}

export function assertExactGitState(state, expected) {
  if (state?.head !== expected || state.status !== "") {
    throw new Error("Resend recovery Git state is not exact and clean");
  }
  return true;
}

function githubRun(id, commit) {
  const runPayload = run("gh", ["api", `repos/${REPOSITORY}/actions/runs/${id}`], { json: true });
  if (
    runPayload?.id !== id
    || runPayload.name !== "CI"
    || runPayload.status !== "completed"
    || runPayload.conclusion !== "success"
    || runPayload.head_sha !== commit
    || runPayload.event !== "pull_request"
  ) throw new Error("Resend recovery CI binding is invalid");
  return true;
}

export function normalizeProviderInventory(payload) {
  if (payload?.error || !Array.isArray(payload?.data?.data) || payload.data.has_more !== false) {
    throw new Error("Resend API-key inventory is incomplete");
  }
  const rows = payload.data.data;
  const old = rows.filter((entry) => entry?.id === OLD_KEY.id && entry.name === OLD_KEY.name);
  const replacement = rows.filter((entry) => entry?.name === NEW_KEY_NAME);
  if (old.length !== 1 || replacement.length > 1) {
    throw new Error("Resend API-key inventory drifted");
  }
  if (rows.length !== old.length + replacement.length) {
    throw new Error("Unreviewed Resend API keys exist");
  }
  return Object.freeze({ old: Object.freeze({ ...old[0] }), replacement: replacement[0] ?? null });
}

async function listProviderKeys(secret) {
  return normalizeProviderInventory(await new Resend(secret).apiKeys.list({ limit: 100 }));
}

export function normalizeCreatedKey(payload) {
  if (
    payload?.error
    || typeof payload?.data?.id !== "string"
    || typeof payload.data.token !== "string"
    || !payload.data.token.startsWith("re_")
    || payload.data.token.length < 20
  ) throw new Error("Resend replacement API-key response is invalid");
  return Object.freeze({ id: payload.data.id, token: payload.data.token });
}

async function createProviderKey(secret) {
  return normalizeCreatedKey(await new Resend(secret).apiKeys.create({
    name: NEW_KEY_NAME,
    permission: "full_access",
  }));
}

async function deleteProviderKey(secret, id) {
  const response = await new Resend(secret).apiKeys.remove(id);
  if (response?.error) throw new Error("Resend API-key revocation failed");
}

export function validateState(value) {
  const stageIndex = STAGES.indexOf(value?.stage);
  if (
    value?.schemaVersion !== 1
    || value.operation !== "resend-credential-exposure-recovery"
    || stageIndex < 0
    || !COMMIT.test(value.operatorCommit)
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.operatorCiRunId <= 0
    || value.sourceCommit !== SOURCE_COMMIT
    || value.predecessorDeploymentId !== PREDECESSOR_DEPLOYMENT
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.oldToken !== "string"
    || !value.oldToken.startsWith("re_")
    || typeof value.oldTokenSha256 !== "string"
    || value.oldTokenSha256 !== sha256(value.oldToken)
    || (value.newToken !== null && (!value.newToken.startsWith("re_") || value.newTokenSha256 !== sha256(value.newToken)))
  ) throw new Error("private Resend recovery state is invalid");
  if (stageIndex >= STAGES.indexOf("provider-created")) {
    if (typeof value.newKeyId !== "string" || value.newToken === null) {
      throw new Error("private Resend replacement state is incomplete");
    }
  }
  if (stageIndex >= STAGES.indexOf("deployment-ready")) {
    if (!DEPLOYMENT.test(value.replacementDeploymentId) || typeof value.replacementDeploymentUrl !== "string") {
      throw new Error("private Resend deployment state is incomplete");
    }
  }
  return Object.freeze({ ...value });
}

function readState() {
  assertPrivateFile(JOURNAL, "private Resend recovery journal");
  return validateState(JSON.parse(readFileSync(JOURNAL, "utf8")));
}

function writeState(state, stage, patch = {}) {
  const current = STAGES.indexOf(state.stage);
  const next = STAGES.indexOf(stage);
  if (next < current || next > current + 1) throw new Error("Resend recovery stage transition is invalid");
  const value = validateState({ ...state, ...patch, stage, updatedAt: new Date().toISOString() });
  writePrivate(JOURNAL, `${JSON.stringify(value, null, 2)}\n`, { replace: true });
  return value;
}

function createState(config, oldToken) {
  const now = new Date().toISOString();
  const value = validateState({
    schemaVersion: 1,
    operation: "resend-credential-exposure-recovery",
    stage: "preflight",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    replacementDeploymentId: null,
    replacementDeploymentUrl: null,
    oldKeyId: OLD_KEY.id,
    oldToken,
    oldTokenSha256: sha256(oldToken),
    newKeyId: null,
    newToken: null,
    newTokenSha256: null,
    createdAt: now,
    updatedAt: now,
  });
  writePrivate(JOURNAL, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function replaceLocalValue(name, value) {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`${name} is missing from local environment`);
  const next = source.replace(pattern, `${name}=${value}`);
  if (next === source) throw new Error(`${name} local replacement was ineffective`);
  writePrivate(LOCAL_ENV, next, { replace: true });
  const parsed = dotenv.parse(readFileSync(LOCAL_ENV, "utf8"));
  if (parsed[name] !== value) throw new Error(`${name} local replacement did not persist`);
}

function updateGithubSecret(value) {
  run("gh", ["secret", "set", "RESEND_API_KEY", "--repo", REPOSITORY], { input: `${value}\n` });
}

function updateVercelSecret(value) {
  run(process.execPath, [
    VERCEL_CLI,
    "env", "update", "RESEND_API_KEY",
    "--sensitive", "--yes", "--scope", PROJECT.scope, "--no-color",
  ], { cwd: ROOT, input: `${value}\n` });
}

export function normalizeResolvedSecretSha256(output) {
  if (typeof output !== "string") throw new Error("Vercel Resend secret hash output is invalid");
  const matches = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(RESOLVED_SECRET_HASH_PREFIX));
  if (matches.length !== 1) throw new Error("Vercel Resend secret hash marker is not unique");
  const digest = matches[0].slice(RESOLVED_SECRET_HASH_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Vercel Resend secret hash is malformed");
  return digest;
}

function resolvedVercelSecretSha256() {
  return normalizeResolvedSecretSha256(run(process.execPath, [
    VERCEL_CLI,
    "env", "run", "--environment", "production",
    "--project", PROJECT.name, "--scope", PROJECT.scope, "--no-color",
    "--", process.execPath, "-e",
    `const c=require('node:crypto');const v=process.env.RESEND_API_KEY;if(!v)process.exit(42);process.stdout.write('${RESOLVED_SECRET_HASH_PREFIX}'+c.createHash('sha256').update(v).digest('hex'))`,
  ], { cwd: SOURCE }));
}

function readDeployment(idOrUrl) {
  const payload = run(process.execPath, [
    VERCEL_CLI,
    "api", `/v13/deployments/${idOrUrl}`,
    "--raw", "--scope", PROJECT.scope, "--no-color",
  ], { cwd: ROOT, json: true });
  return Object.freeze({
    id: payload.id,
    url: payload.url,
    projectId: payload.projectId,
    readyState: payload.readyState,
    target: payload.target,
    sourceCommit: payload.meta?.gitCommitSha,
    marker: payload.meta?.grainlineResendCredentialRecovery,
  });
}

export function normalizeDeployment(value, marker) {
  if (
    !DEPLOYMENT.test(value?.id)
    || typeof value.url !== "string"
    || !value.url.endsWith(".vercel.app")
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.sourceCommit !== SOURCE_COMMIT
    || value.marker !== marker
    || value.id === PREDECESSOR_DEPLOYMENT
  ) throw new Error("Resend replacement deployment is invalid");
  return Object.freeze({ ...value });
}

function deploymentMarker(createdAt) {
  return sha256(`resend-credential-recovery:${createdAt}`).slice(0, 32);
}

function deployReplacement(state) {
  const marker = deploymentMarker(state.createdAt);
  const output = run(process.execPath, [
    VERCEL_CLI,
    "deploy", SOURCE,
    "--prod", "--skip-domain", "--force", "--yes",
    "--project", PROJECT.name, "--scope", PROJECT.scope,
    "--meta", `gitCommitSha=${SOURCE_COMMIT}`,
    "--meta", "gitCommitRef=HEAD",
    "--meta", `grainlineResendCredentialRecovery=${marker}`,
    "--no-color",
  ], { cwd: SOURCE, timeout: 15 * 60_000 });
  const url = output.split(/\r?\n/).find((line) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line.trim()))?.trim();
  if (!url) throw new Error("Resend replacement deployment URL was not returned");
  return normalizeDeployment(readDeployment(new URL(url).hostname), marker);
}

function aliasTargets() {
  return CANONICAL_ALIASES.map((alias) => Object.freeze({ alias, deployment: readDeployment(alias) }));
}

export function normalizeAliasTargets(targets, expectedId) {
  if (
    !DEPLOYMENT.test(expectedId)
    || !Array.isArray(targets)
    || targets.length !== CANONICAL_ALIASES.length
    || targets.some((entry, index) => (
      entry?.alias !== CANONICAL_ALIASES[index]
      || entry.deployment?.id !== expectedId
      || entry.deployment.projectId !== PROJECT.id
      || entry.deployment.readyState !== "READY"
      || entry.deployment.target !== "production"
    ))
  ) throw new Error("canonical alias state drifted");
  return true;
}

function promoteReplacement(state) {
  normalizeAliasTargets(aliasTargets(), PREDECESSOR_DEPLOYMENT);
  run(process.execPath, [
    VERCEL_CLI,
    "promote", state.replacementDeploymentUrl,
    "--scope", PROJECT.scope, "--yes", "--no-color",
  ], { cwd: ROOT, timeout: 5 * 60_000 });
  normalizeAliasTargets(aliasTargets(), state.replacementDeploymentId);
}

async function expectOldRejected(token) {
  const response = await new Resend(token).apiKeys.list({ limit: 1 });
  if (!response?.error || ![401, 403].includes(response.error.statusCode)) {
    throw new Error("superseded Resend API key still authenticates");
  }
  return true;
}

async function liveRoutes() {
  const rows = [];
  for (const route of ["/", "/api/health"]) {
    const response = await fetch(`https://thegrainline.com${route}`, { redirect: "manual" });
    if (response.status !== 200) throw new Error("canonical route failed after Resend recovery");
    rows.push(Object.freeze({
      route,
      status: response.status,
      contentType: response.headers.get("content-type")?.split(";")[0] ?? "",
    }));
  }
  return Object.freeze(rows);
}

export function sanitizedEvidence(config, state, routes) {
  return Object.freeze({
    schemaVersion: 1,
    operation: "resend-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    completedAt: new Date().toISOString(),
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    provider: {
      oldKeyId: state.oldKeyId,
      replacementKeyId: state.newKeyId,
      oldTokenSha256: state.oldTokenSha256,
      replacementTokenSha256: state.newTokenSha256,
      replacementAuthenticated: true,
      oldCredentialRejected: true,
      otherKeysObserved: 0,
    },
    consumers: {
      localUpdated: true,
      githubRepositorySecretUpdated: true,
      vercelProductionUpdated: true,
    },
    deployment: {
      priorId: PREDECESSOR_DEPLOYMENT,
      replacementId: state.replacementDeploymentId,
      sourceCommit: SOURCE_COMMIT,
      canonicalRoutes: routes,
    },
    migrationsApplied: [],
    otherProviderStateChanged: false,
  });
}

export async function runRecovery(config) {
  if (!COMMIT.test(config?.operatorCommit) || !Number.isSafeInteger(config?.operatorCiRunId)) {
    throw new Error("Resend recovery requires an exact operator commit and CI run");
  }
  assertExactGitState(gitState(process.cwd()), config.operatorCommit);
  assertExactGitState(gitState(SOURCE), SOURCE_COMMIT);
  githubRun(config.operatorCiRunId, config.operatorCommit);

  let state;
  if (existsSync(JOURNAL)) {
    state = readState();
    if (state.operatorCommit !== config.operatorCommit || state.operatorCiRunId !== config.operatorCiRunId) {
      throw new Error("private Resend journal belongs to another release");
    }
  } else {
    const local = dotenv.parse(readFileSync(LOCAL_ENV, "utf8"));
    const oldToken = local.RESEND_API_KEY;
    if (typeof oldToken !== "string" || !oldToken.startsWith("re_")) {
      throw new Error("local Resend credential is missing or malformed");
    }
    normalizeAliasTargets(aliasTargets(), PREDECESSOR_DEPLOYMENT);
    const inventory = await listProviderKeys(oldToken);
    if (inventory.replacement !== null) {
      throw new Error("orphaned Resend replacement key requires explicit reconciliation");
    }
    if (resolvedVercelSecretSha256() !== sha256(oldToken)) {
      throw new Error("resolved Vercel Resend credential does not match local preflight");
    }
    state = createState(config, oldToken);
  }

  if (state.stage === "preflight") {
    const created = await createProviderKey(state.oldToken);
    state = writeState(state, "provider-created", {
      newKeyId: created.id,
      newToken: created.token,
      newTokenSha256: sha256(created.token),
    });
  }
  if (state.stage === "provider-created") {
    updateGithubSecret(state.newToken);
    state = writeState(state, "github-updated");
  }
  if (state.stage === "github-updated") {
    updateVercelSecret(state.newToken);
    if (resolvedVercelSecretSha256() !== state.newTokenSha256) {
      throw new Error("Vercel Resend replacement did not converge");
    }
    state = writeState(state, "vercel-updated");
  }
  if (state.stage === "vercel-updated") {
    replaceLocalValue("RESEND_API_KEY", state.newToken);
    state = writeState(state, "local-updated");
  }
  if (state.stage === "local-updated") {
    const deployment = deployReplacement(state);
    state = writeState(state, "deployment-ready", {
      replacementDeploymentId: deployment.id,
      replacementDeploymentUrl: deployment.url,
    });
    return Object.freeze({ status: "promotion-required", deploymentId: deployment.id, deploymentUrl: deployment.url });
  }
  if (state.stage === "deployment-ready") {
    promoteReplacement(state);
    state = writeState(state, "promoted");
  }
  if (state.stage === "promoted") {
    const inventory = await listProviderKeys(state.newToken);
    assert.equal(inventory.replacement?.id, state.newKeyId);
    await deleteProviderKey(state.newToken, state.oldKeyId);
    await expectOldRejected(state.oldToken);
    state = writeState(state, "provider-revoked");
  }
  if (state.stage === "provider-revoked") {
    normalizeAliasTargets(aliasTargets(), state.replacementDeploymentId);
    const routes = await liveRoutes();
    const evidence = sanitizedEvidence(config, state, routes);
    writePrivate(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { replace: existsSync(EVIDENCE) });
    rmSync(JOURNAL);
    return Object.freeze({
      status: "passed",
      acceptanceEligible: true,
      replacementDeploymentId: state.replacementDeploymentId,
      oldCredentialRejected: true,
      evidenceSha256: sha256(readFileSync(EVIDENCE)),
    });
  }
  throw new Error("Resend recovery reached an unknown stage");
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const operatorCommit = values.get("--operator-commit");
  const operatorCiRunId = Number(values.get("--operator-ci-run-id"));
  const confirmation = values.get("--confirm");
  if (confirmation !== "rotate-exposed-resend-20260902") throw new Error("Resend recovery confirmation mismatch");
  return { operatorCommit, operatorCiRunId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRecovery(parseArguments(process.argv.slice(2))).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => {
      process.stderr.write("Resend credential recovery stopped fail-closed; inspect the private journal.\n");
      process.exitCode = 1;
    },
  );
}
