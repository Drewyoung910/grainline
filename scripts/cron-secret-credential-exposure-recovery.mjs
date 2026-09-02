#!/usr/bin/env node

import crypto from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const ROOT = "/Users/drewyoung/grainline";
const SOURCE = "/private/tmp/grainline-order-shipping-production-deploy-20260902";
const LOCAL_ENV = path.join(ROOT, ".env.local");
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const JOURNAL = path.join(EVIDENCE_DIRECTORY, ".cron-secret-credential-recovery-20260902.private.json");
const EVIDENCE = path.join(EVIDENCE_DIRECTORY, "cron-secret-credential-recovery-20260902.json");
const VERCEL_CLI = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";
const REPOSITORY = "Drewyoung910/grainline";
const PROJECT = Object.freeze({
  id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  name: "grainline",
  scope: "drew-youngs-projects",
  teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
});
const SOURCE_COMMIT = "b22fa138d84bad792ba206ee00dacb48d475d4a4";
const PREDECESSOR_DEPLOYMENT = "dpl_7DA9fNtQZV27smqAvSEJ6RrjtnC9";
const CURRENT_ENVIRONMENT = Object.freeze({
  id: "env_Z5Adun6D9lSNFwiy53ucs4GK",
  key: "CRON_SECRET",
  type: "encrypted",
  target: Object.freeze(["development", "preview", "production"]),
});
const CURRENT_PROJECT_SHADOW_ID = "LRWsHUt7PHsP3rRg";
const PREVIOUS_KEY = "CRON_SECRET_PREVIOUS";
const CURRENT_PROJECT_SHADOW_ROUTE = `/v9/projects/${PROJECT.id}/env/${CURRENT_PROJECT_SHADOW_ID}`;
const RECOVERABLE_BRIDGE_STATE = Object.freeze({
  operatorCommit: "1590f641105eb241b1f6f88f4b5202ef590cb771",
  operatorCiRunId: 33672732081,
  previousEnvironmentId: "env_TLFbbAsJFwAOo5uFLoyVCCVS",
  bridgeDeploymentId: "dpl_CkSvMUPv3w7bWC7g4iZaiMMJ34Dy",
  bridgeDeploymentUrl: "grainline-q32rcdq9o-drew-youngs-projects.vercel.app",
  oldSecretSha256: "cf6b30a860d0881ac61f1cd3e9a0871879d29d23cba5e56bcf1ab91f06bec979",
  newSecretSha256: "8f97197405ea1c772864ce28a1acb34169e22606f9e35e468914e980e95d844e",
});
const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const PROBE_PATH = "/api/cron/__credential-recovery-probe__";
const MAX_REQUEST_DRAIN_MS = 330_000;
const COMMIT = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const DEPLOYMENT_URL = /^[a-z0-9-]+\.vercel\.app$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CURRENT_HASH_PREFIX = "GRAINLINE_CRON_CURRENT_SHA256:";
const PREVIOUS_HASH_PREFIX = "GRAINLINE_CRON_PREVIOUS_SHA256:";
const STAGES = Object.freeze([
  "preflight",
  "bridge-previous-created",
  "bridge-ready",
  "bridge-promoted",
  "consumers-updated",
  "dual-ready",
  "dual-promoted",
  "previous-removed",
  "final-ready",
  "final-promoted",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEnvironment() {
  const env = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function run(command, args, { cwd = ROOT, input, json = false, timeout = 90_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeEnvironment(),
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("cron recovery dependency failed");
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("cron recovery dependency returned invalid JSON");
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
  const descriptor = openSync(temporary, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  chmodSync(file, 0o600);
  const directoryDescriptor = openSync(path.dirname(file), "r");
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function gitState(directory) {
  return Object.freeze({
    head: run("git", ["rev-parse", "HEAD"], { cwd: directory }),
    status: run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: directory }),
  });
}

export function assertExactGitState(state, expected) {
  if (state?.head !== expected || state.status !== "") {
    throw new Error("cron recovery Git state is not exact and clean");
  }
  return true;
}

function githubRun(id, commit) {
  const payload = run("gh", ["api", `repos/${REPOSITORY}/actions/runs/${id}`], { json: true });
  if (
    payload?.id !== id
    || payload.head_sha !== commit
    || payload.status !== "completed"
    || payload.conclusion !== "success"
    || payload.name !== "CI"
  ) throw new Error("cron recovery CI binding failed");
  return true;
}

function githubSecretMetadata() {
  const rows = run("gh", ["secret", "list", "--repo", REPOSITORY, "--json", "name,updatedAt"], { json: true });
  const current = rows.filter((row) => row?.name === CURRENT_ENVIRONMENT.key);
  const previous = rows.filter((row) => row?.name === PREVIOUS_KEY);
  if (current.length !== 1 || previous.length !== 0) {
    throw new Error("GitHub cron secret inventory drifted");
  }
  return Object.freeze({ currentUpdatedAt: current[0].updatedAt });
}

function updateGithubSecret(value) {
  run("gh", ["secret", "set", CURRENT_ENVIRONMENT.key, "--repo", REPOSITORY], { input: `${value}\n` });
}

function readLocal() {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  return dotenv.parse(readFileSync(LOCAL_ENV, "utf8"));
}

function setLocalValues(current, previous) {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  const currentPattern = /^CRON_SECRET=.*$/m;
  if (!currentPattern.test(source)) throw new Error("CRON_SECRET is missing from local environment");
  let next = source.replace(currentPattern, `CRON_SECRET=${current}`);
  const previousPattern = /^CRON_SECRET_PREVIOUS=.*(?:\n|$)/m;
  next = next.replace(previousPattern, "");
  if (previous !== null) {
    const anchor = /^CRON_SECRET=.*$/m;
    next = next.replace(anchor, (line) => `${line}\nCRON_SECRET_PREVIOUS=${previous}`);
  }
  writePrivate(LOCAL_ENV, next, { replace: true });
  const parsed = readLocal();
  if (parsed.CRON_SECRET !== current || (previous === null
    ? parsed.CRON_SECRET_PREVIOUS !== undefined
    : parsed.CRON_SECRET_PREVIOUS !== previous)) {
    throw new Error("local cron secret convergence failed");
  }
}

function vercelApi(route, { method, body } = {}) {
  const args = [VERCEL_CLI, "api", route, "--raw", "--scope", PROJECT.scope, "--no-color"];
  if (method) args.push("--method", method);
  if (method === "DELETE") {
    const exactSharedDelete = (
      route !== "/v1/env"
      ? false
      : Array.isArray(body?.ids)
        && body.ids.length === 1
        && /^env_[A-Za-z0-9]+$/.test(body.ids[0])
    );
    const exactProjectShadowDelete = route === CURRENT_PROJECT_SHADOW_ROUTE && body === undefined;
    if (!exactSharedDelete && !exactProjectShadowDelete) {
      throw new Error("Vercel destructive request is outside the exact environment-variable fence");
    }
    args.push("--dangerously-skip-permissions");
  }
  if (body !== undefined) args.push("--input", "-", "--silent");
  const output = run(process.execPath, args, {
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (output === "" && (
    method === "DELETE"
    || (method === "PATCH" && route === "/v1/env")
  )) return Object.freeze({});
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Vercel API returned invalid JSON");
  }
}

export function normalizeSharedEnvironmentInventory(
  payload,
  previousId = null,
  { allowAnyPrevious = false } = {},
) {
  if (!Array.isArray(payload?.data) || payload.pagination?.next !== null) {
    throw new Error("Vercel shared environment inventory is incomplete");
  }
  const currentRows = payload.data.filter((row) => row?.key === CURRENT_ENVIRONMENT.key);
  const previousRows = payload.data.filter((row) => row?.key === PREVIOUS_KEY);
  const current = currentRows[0];
  const exact = (row, expectedId, key) => (
    row?.id === expectedId
    && row.key === key
    && row.type === CURRENT_ENVIRONMENT.type
    && row.ownerId === PROJECT.teamId
    && row.projectId?.length === 1
    && row.projectId[0] === PROJECT.id
    && JSON.stringify(row.target) === JSON.stringify(CURRENT_ENVIRONMENT.target)
  );
  if (currentRows.length !== 1 || !exact(current, CURRENT_ENVIRONMENT.id, CURRENT_ENVIRONMENT.key)) {
    throw new Error("Vercel current cron environment metadata drifted");
  }
  if (allowAnyPrevious) {
    if (
      previousRows.length > 1
      || (previousRows.length === 1 && (
        !/^env_[A-Za-z0-9]+$/.test(previousRows[0].id ?? "")
        || !exact(previousRows[0], previousRows[0].id, PREVIOUS_KEY)
      ))
    ) throw new Error("Vercel previous cron environment metadata drifted");
  } else if (previousId === null) {
    if (previousRows.length !== 0) throw new Error("unexpected previous cron environment exists");
  } else if (previousRows.length !== 1 || !exact(previousRows[0], previousId, PREVIOUS_KEY)) {
    throw new Error("Vercel previous cron environment metadata drifted");
  }
  return Object.freeze({
    currentId: current.id,
    previousId: allowAnyPrevious ? previousRows[0]?.id ?? null : previousId,
  });
}

function sharedInventory(previousId = null, options = {}) {
  return normalizeSharedEnvironmentInventory(vercelApi("/v1/env"), previousId, options);
}

export function normalizeProjectEnvironmentInventory(payload, expected = "shadow") {
  if (!Array.isArray(payload?.envs)) throw new Error("Vercel project environment inventory is incomplete");
  if (!["shadow", "none", "either"].includes(expected)) {
    throw new Error("Vercel project environment expectation is invalid");
  }
  const currentRows = payload.envs.filter((row) => row?.key === CURRENT_ENVIRONMENT.key);
  const previousRows = payload.envs.filter((row) => row?.key === PREVIOUS_KEY);
  const exact = (row, id, key) => (
    row?.id === id
    && row.key === key
    && row.type === CURRENT_ENVIRONMENT.type
    && row.gitBranch == null
    && row.configurationId == null
    && Array.isArray(row.customEnvironmentIds)
    && row.customEnvironmentIds.length === 0
    && JSON.stringify(row.target) === JSON.stringify(CURRENT_ENVIRONMENT.target)
  );
  const exactShadow = currentRows.length === 1
    && exact(currentRows[0], CURRENT_PROJECT_SHADOW_ID, CURRENT_ENVIRONMENT.key);
  if (
    (expected === "shadow" && !exactShadow)
    || (expected === "none" && currentRows.length !== 0)
    || (expected === "either" && currentRows.length !== 0 && !exactShadow)
  ) throw new Error("Vercel project current cron shadow metadata drifted");
  if (previousRows.length !== 0) {
    throw new Error("unexpected project-local previous cron environment shadow exists");
  }
  return Object.freeze({ currentId: currentRows[0]?.id ?? null, previousId: null });
}

function projectEnvironmentInventory(expected = "shadow") {
  const payload = vercelApi(`/v10/projects/${PROJECT.id}/env?decrypt=false`);
  return normalizeProjectEnvironmentInventory(payload, expected);
}

export function normalizeSharedSecretHash(payload, expectedId, expectedKey) {
  if (
    payload?.id !== expectedId
    || payload.key !== expectedKey
    || payload.ownerId !== PROJECT.teamId
    || payload.type !== CURRENT_ENVIRONMENT.type
    || payload.deletedAt !== null
    || payload.decrypted !== true
    || payload.projectId?.length !== 1
    || payload.projectId[0] !== PROJECT.id
    || JSON.stringify(payload.target) !== JSON.stringify(CURRENT_ENVIRONMENT.target)
    || typeof payload.value !== "string"
    || payload.value.length < 32
  ) throw new Error("Vercel shared cron value response drifted");
  return sha256(payload.value);
}

function storedSharedHashes(previousId) {
  return Object.freeze({
    current: normalizeSharedSecretHash(
      vercelApi(`/v1/env/${CURRENT_ENVIRONMENT.id}`),
      CURRENT_ENVIRONMENT.id,
      CURRENT_ENVIRONMENT.key,
    ),
    previous: normalizeSharedSecretHash(
      vercelApi(`/v1/env/${previousId}`),
      previousId,
      PREVIOUS_KEY,
    ),
  });
}

export function classifyDualCredentialState(snapshot, hashes) {
  const oldHash = hashes?.old;
  const newHash = hashes?.replacement;
  const shared = snapshot?.shared;
  const effective = snapshot?.effective;
  const projectShadowId = snapshot?.projectShadowId ?? null;
  if (
    !SHA256.test(oldHash ?? "")
    || !SHA256.test(newHash ?? "")
    || oldHash === newHash
    || ![oldHash, newHash].includes(shared?.current)
    || ![oldHash, newHash].includes(shared?.previous)
    || ![oldHash, newHash].includes(effective?.current)
    || ![oldHash, newHash].includes(effective?.previous)
    || ![null, CURRENT_PROJECT_SHADOW_ID].includes(projectShadowId)
  ) throw new Error("cron dual-secret state is outside the reviewed values");

  if (projectShadowId === CURRENT_PROJECT_SHADOW_ID) {
    if (effective.current !== oldHash) {
      throw new Error("project cron shadow does not resolve the reviewed old value");
    }
    if (shared.current === oldHash && shared.previous === newHash) return "pre-convergence";
    if (shared.current === newHash && shared.previous === oldHash) return "shared-converged-shadowed";
    return "shared-convergence-partial";
  }
  if (shared.current !== newHash || shared.previous !== oldHash) {
    throw new Error("project cron shadow was removed before shared convergence");
  }
  if (effective.current === newHash && effective.previous === oldHash) return "dual-converged";
  return "shadow-removed-propagating";
}

function dualCredentialSnapshot(previousId) {
  sharedInventory(previousId);
  const project = projectEnvironmentInventory("either");
  return Object.freeze({
    shared: storedSharedHashes(previousId),
    effective: resolvedVercelHashes(),
    projectShadowId: project.currentId,
  });
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForResolvedHashes({
  expectedCurrent,
  expectedPrevious,
  allowedCurrent,
  allowedPrevious,
  failure,
}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const resolved = resolvedVercelHashes();
    if (resolved.current === expectedCurrent && resolved.previous === expectedPrevious) return resolved;
    if (!allowedCurrent.includes(resolved.current) || !allowedPrevious.includes(resolved.previous)) {
      throw new Error(`${failure} changed outside the reviewed values`);
    }
    await pause(1_500);
  }
  throw new Error(`${failure} did not converge`);
}

async function createPreviousSecret(value, expectedCurrentHash, expectedPreviousHash) {
  let inventory = sharedInventory(null, { allowAnyPrevious: true });
  if (inventory.previousId === null) {
    vercelApi("/v1/env", {
      method: "POST",
      body: {
        evs: [{
          key: PREVIOUS_KEY,
          value,
          comment: "Temporary dual-verify secret for 2026-09-02 exposure recovery",
        }],
        type: CURRENT_ENVIRONMENT.type,
        target: CURRENT_ENVIRONMENT.target,
        projectId: [PROJECT.id],
      },
    });
    inventory = sharedInventory(null, { allowAnyPrevious: true });
  }
  if (!inventory.previousId) throw new Error("Vercel previous cron environment creation was ambiguous");
  projectEnvironmentInventory("shadow");
  await waitForResolvedHashes({
    expectedCurrent: expectedCurrentHash,
    expectedPrevious: expectedPreviousHash,
    allowedCurrent: [expectedCurrentHash],
    allowedPrevious: ["absent", expectedPreviousHash],
    failure: "Vercel previous cron environment value",
  });
  sharedInventory(inventory.previousId);
  projectEnvironmentInventory("shadow");
  return Object.freeze({ sharedId: inventory.previousId });
}

async function updateDualSecrets(currentValue, previousValue, previousId, hashes) {
  let snapshot = dualCredentialSnapshot(previousId);
  let classification = classifyDualCredentialState(snapshot, hashes);
  if (["pre-convergence", "shared-convergence-partial"].includes(classification)) {
    vercelApi("/v1/env", {
      method: "PATCH",
      body: {
        updates: {
          [CURRENT_ENVIRONMENT.id]: {
            key: CURRENT_ENVIRONMENT.key,
            value: currentValue,
            comment: "Current Grainline cron bearer",
          },
          [previousId]: {
            key: PREVIOUS_KEY,
            value: previousValue,
            comment: "Temporary dual-verify secret for 2026-09-02 exposure recovery",
          },
        },
      },
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      snapshot = dualCredentialSnapshot(previousId);
      classification = classifyDualCredentialState(snapshot, hashes);
      if (classification === "shared-converged-shadowed") break;
      if (!["pre-convergence", "shared-convergence-partial"].includes(classification)) {
        throw new Error("cron shared convergence changed outside the reviewed sequence");
      }
      await pause(1_500);
    }
    if (classification !== "shared-converged-shadowed") {
      throw new Error("Vercel shared cron values did not converge before the shadow fence");
    }
  }

  if (classification === "shared-converged-shadowed") {
    vercelApi(CURRENT_PROJECT_SHADOW_ROUTE, { method: "DELETE" });
  } else if (!["shadow-removed-propagating", "dual-converged"].includes(classification)) {
    throw new Error("cron dual convergence did not reach the project-shadow boundary");
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    snapshot = dualCredentialSnapshot(previousId);
    classification = classifyDualCredentialState(snapshot, hashes);
    if (classification === "dual-converged") return snapshot;
    if (classification !== "shadow-removed-propagating") {
      throw new Error("cron effective convergence changed outside the reviewed sequence");
    }
    await pause(1_500);
  }
  throw new Error("Vercel effective cron values did not converge after shadow removal");
}

async function deletePreviousSecret(previousId, expectedCurrentHash, expectedPreviousHash) {
  const inventory = sharedInventory(null, { allowAnyPrevious: true });
  if (inventory.previousId !== null && inventory.previousId !== previousId) {
    throw new Error("Vercel previous cron environment identity drifted");
  }
  if (inventory.previousId !== null) {
    projectEnvironmentInventory("none");
    vercelApi("/v1/env", { method: "DELETE", body: { ids: [previousId] } });
  }
  sharedInventory(null);
  projectEnvironmentInventory("none");
  await waitForResolvedHashes({
    expectedCurrent: expectedCurrentHash,
    expectedPrevious: "absent",
    allowedCurrent: [expectedCurrentHash],
    allowedPrevious: [expectedPreviousHash, "absent"],
    failure: "Vercel final cron environment",
  });
}

export function normalizeResolvedCronHashes(output) {
  if (typeof output !== "string") throw new Error("Vercel cron hash output is invalid");
  const find = (prefix) => output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
  const current = find(CURRENT_HASH_PREFIX);
  const previous = find(PREVIOUS_HASH_PREFIX);
  if (current.length !== 1 || previous.length !== 1) {
    throw new Error("Vercel cron hash markers are not unique");
  }
  const currentHash = current[0].slice(CURRENT_HASH_PREFIX.length);
  const previousHash = previous[0].slice(PREVIOUS_HASH_PREFIX.length);
  if (!SHA256.test(currentHash) || (previousHash !== "absent" && !SHA256.test(previousHash))) {
    throw new Error("Vercel cron hash marker is malformed");
  }
  return Object.freeze({ current: currentHash, previous: previousHash });
}

function resolvedVercelHashes() {
  const script = [
    "const c=require('node:crypto');",
    "const h=v=>c.createHash('sha256').update(v).digest('hex');",
    "const a=process.env.CRON_SECRET;if(!a)process.exit(42);",
    `process.stdout.write('${CURRENT_HASH_PREFIX}'+h(a)+'\\n');`,
    "const b=process.env.CRON_SECRET_PREVIOUS;",
    `process.stdout.write('${PREVIOUS_HASH_PREFIX}'+(b?h(b):'absent'));`,
  ].join("");
  return normalizeResolvedCronHashes(run(process.execPath, [
    VERCEL_CLI,
    "env", "run", "--environment", "production",
    "--project", PROJECT.name, "--scope", PROJECT.scope, "--no-color",
    "--", process.execPath, "-e", script,
  ], { cwd: SOURCE }));
}

export function normalizeProjectProtection(payload) {
  if (
    payload?.id !== PROJECT.id
    || payload.name !== PROJECT.name
    || payload.ssoProtection?.deploymentType !== "all_except_custom_domains"
  ) throw new Error("Vercel deployment protection posture drifted");
  return Object.freeze({ deploymentType: payload.ssoProtection.deploymentType });
}

function projectProtection() {
  return normalizeProjectProtection(vercelApi(`/v9/projects/${PROJECT.id}`));
}

function readDeployment(idOrUrl) {
  const payload = vercelApi(`/v13/deployments/${idOrUrl}`);
  return Object.freeze({
    id: payload.id,
    url: payload.url,
    projectId: payload.projectId,
    readyState: payload.readyState,
    target: payload.target,
    sourceCommit: payload.meta?.gitCommitSha,
    marker: payload.meta?.grainlineCronCredentialRecovery,
    phase: payload.meta?.grainlineCronCredentialRecoveryPhase,
  });
}

export function normalizeDeployment(value, marker, phase, distinctFrom) {
  if (
    !DEPLOYMENT.test(value?.id)
    || typeof value.url !== "string"
    || !value.url.endsWith(".vercel.app")
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.sourceCommit !== SOURCE_COMMIT
    || value.marker !== marker
    || value.phase !== phase
    || value.id === distinctFrom
  ) throw new Error("cron replacement deployment is invalid");
  return Object.freeze({ ...value });
}

function deployReplacement(state, phase, distinctFrom) {
  const marker = sha256(`cron-secret-recovery:${state.createdAt}:${phase}`).slice(0, 32);
  const existing = findMarkedDeployment(state, marker, phase, distinctFrom);
  if (existing) return existing;
  const output = run(process.execPath, [
    VERCEL_CLI,
    "deploy", SOURCE,
    "--prod", "--skip-domain", "--force", "--yes",
    "--project", PROJECT.name, "--scope", PROJECT.scope,
    "--meta", `gitCommitSha=${SOURCE_COMMIT}`,
    "--meta", "gitCommitRef=HEAD",
    "--meta", `grainlineCronCredentialRecovery=${marker}`,
    "--meta", `grainlineCronCredentialRecoveryPhase=${phase}`,
    "--no-color",
  ], { cwd: SOURCE, timeout: 15 * 60_000 });
  const url = output.split(/\r?\n/).find((line) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line.trim()))?.trim();
  if (!url) throw new Error("cron replacement deployment URL was not returned");
  const created = findMarkedDeployment(state, marker, phase, distinctFrom);
  if (!created || created.url !== new URL(url).hostname) {
    throw new Error("cron replacement deployment creation was ambiguous");
  }
  return created;
}

export function normalizeMarkedDeploymentInventory(payload, stateCreatedAt, marker, phase, distinctFrom) {
  if (!Array.isArray(payload?.deployments) || !Number.isFinite(Date.parse(stateCreatedAt))) {
    throw new Error("Vercel deployment inventory is incomplete");
  }
  const matching = payload.deployments.filter((row) => row?.meta?.grainlineCronCredentialRecovery === marker);
  if (matching.length > 1) throw new Error("multiple marked cron deployments exist");
  if (matching.length === 0) {
    if (Number.isFinite(payload.pagination?.next) && payload.pagination.next >= Date.parse(stateCreatedAt)) {
      throw new Error("Vercel deployment inventory does not cover the recovery window");
    }
    return null;
  }
  const row = matching[0];
  return normalizeDeployment({
    id: row.uid ?? row.id,
    url: row.url,
    projectId: row.projectId ?? PROJECT.id,
    readyState: row.readyState ?? row.state,
    target: row.target,
    sourceCommit: row.meta?.gitCommitSha,
    marker: row.meta?.grainlineCronCredentialRecovery,
    phase: row.meta?.grainlineCronCredentialRecoveryPhase,
  }, marker, phase, distinctFrom);
}

function findMarkedDeployment(state, marker, phase, distinctFrom) {
  const query = `/v6/deployments?projectId=${PROJECT.id}&target=production&limit=100`;
  return normalizeMarkedDeploymentInventory(
    vercelApi(query),
    state.createdAt,
    marker,
    phase,
    distinctFrom,
  );
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

export function normalizeAliasPosition(targets, fromId, toId) {
  const ids = new Set(targets.map((entry) => entry?.deployment?.id));
  if (ids.size !== 1) throw new Error("canonical aliases are partially promoted");
  const observed = [...ids][0];
  if (observed === fromId) {
    normalizeAliasTargets(targets, fromId);
    return "from";
  }
  if (observed === toId) {
    normalizeAliasTargets(targets, toId);
    return "to";
  }
  throw new Error("canonical aliases moved to an unreviewed deployment");
}

function promote(url, fromId, toId) {
  const position = normalizeAliasPosition(aliasTargets(), fromId, toId);
  if (position === "to") return;
  run(process.execPath, [
    VERCEL_CLI,
    "promote", url,
    "--scope", PROJECT.scope, "--yes", "--no-color",
  ], { timeout: 5 * 60_000 });
  normalizeAliasTargets(aliasTargets(), toId);
}

export function normalizeProbeResults(results, mode) {
  const expected = mode === "dual"
    ? { current: 404, previous: 404, wrong: 401 }
    : { current: 404, previous: 401, wrong: 401 };
  if (
    !["dual", "final"].includes(mode)
    || results?.current !== expected.current
    || results.previous !== expected.previous
    || results.wrong !== expected.wrong
  ) throw new Error(`cron ${mode} authentication proof failed`);
  return Object.freeze({ ...results });
}

async function probeCanonical(current, previous, mode) {
  const request = async (value) => {
    const response = await fetch(`https://thegrainline.com${PROBE_PATH}`, {
      headers: { authorization: `Bearer ${value}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    return response.status;
  };
  return normalizeProbeResults({
    current: await request(current),
    previous: await request(previous),
    wrong: await request(crypto.randomBytes(48).toString("hex")),
  }, mode);
}

async function liveRoutes() {
  const rows = [];
  for (const route of ["/", "/api/health"]) {
    const response = await fetch(`https://thegrainline.com${route}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200) throw new Error("canonical route failed after cron recovery");
    rows.push(Object.freeze({ route, status: response.status }));
  }
  return Object.freeze(rows);
}

export function validateState(value, config) {
  const hasPreviousOperatorCommit = value?.previousOperatorCommit !== undefined;
  const hasPreviousOperatorCiRunId = value?.previousOperatorCiRunId !== undefined;
  if (
    value?.schemaVersion !== 1
    || value.operation !== "cron-secret-credential-exposure-recovery"
    || !STAGES.includes(value.stage)
    || value.operatorCommit !== config.operatorCommit
    || value.operatorCiRunId !== config.operatorCiRunId
    || value.sourceCommit !== SOURCE_COMMIT
    || value.predecessorDeploymentId !== PREDECESSOR_DEPLOYMENT
    || typeof value.oldSecret !== "string"
    || typeof value.newSecret !== "string"
    || value.oldSecret.length < 32
    || value.newSecret.length < 64
    || value.oldSecret === value.newSecret
    || value.oldSecretSha256 !== sha256(value.oldSecret)
    || value.newSecretSha256 !== sha256(value.newSecret)
    || Number.isNaN(Date.parse(value.createdAt))
    || ![null, undefined].includes(value.previousEnvironmentId)
      && !/^env_[A-Za-z0-9]+$/.test(value.previousEnvironmentId)
    || ![null, undefined].includes(value.bridgeDeploymentId)
      && !DEPLOYMENT.test(value.bridgeDeploymentId)
    || ![null, undefined].includes(value.bridgeDeploymentUrl)
      && !DEPLOYMENT_URL.test(value.bridgeDeploymentUrl)
    || ![null, undefined].includes(value.dualDeploymentId)
      && !DEPLOYMENT.test(value.dualDeploymentId)
    || ![null, undefined].includes(value.dualDeploymentUrl)
      && !DEPLOYMENT_URL.test(value.dualDeploymentUrl)
    || ![null, undefined].includes(value.finalDeploymentId)
      && !DEPLOYMENT.test(value.finalDeploymentId)
    || ![null, undefined].includes(value.finalDeploymentUrl)
      && !DEPLOYMENT_URL.test(value.finalDeploymentUrl)
    || value.bridgeDeploymentId && value.bridgeDeploymentId === value.dualDeploymentId
    || value.bridgeDeploymentId && value.bridgeDeploymentId === value.finalDeploymentId
    || value.dualDeploymentId && value.dualDeploymentId === value.finalDeploymentId
    || hasPreviousOperatorCommit !== hasPreviousOperatorCiRunId
    || hasPreviousOperatorCommit && (
      !COMMIT.test(value.previousOperatorCommit)
      || !Number.isSafeInteger(value.previousOperatorCiRunId)
      || value.previousOperatorCommit === value.operatorCommit
      || value.previousOperatorCiRunId === value.operatorCiRunId
    )
  ) throw new Error("private cron recovery state drifted");
  if (STAGES.indexOf(value.stage) >= STAGES.indexOf("bridge-previous-created")
    && !value.previousEnvironmentId) {
    throw new Error("private cron recovery previous environment is missing");
  }
  if (STAGES.indexOf(value.stage) >= STAGES.indexOf("bridge-ready")
    && (!value.bridgeDeploymentId || !value.bridgeDeploymentUrl)) {
    throw new Error("private cron recovery bridge deployment is missing");
  }
  if (STAGES.indexOf(value.stage) >= STAGES.indexOf("dual-ready")
    && (!value.dualDeploymentId || !value.dualDeploymentUrl)) {
    throw new Error("private cron recovery dual deployment is missing");
  }
  if (STAGES.indexOf(value.stage) >= STAGES.indexOf("dual-promoted")
    && Number.isNaN(Date.parse(value.dualPromotedAt))) {
    throw new Error("private cron recovery drain boundary is missing");
  }
  if (STAGES.indexOf(value.stage) >= STAGES.indexOf("final-ready")
    && (!value.finalDeploymentId || !value.finalDeploymentUrl)) {
    throw new Error("private cron recovery final deployment is missing");
  }
  return Object.freeze(value);
}

export function rebindRecoverableBridgeState(
  value,
  config,
  recoverable = RECOVERABLE_BRIDGE_STATE,
) {
  if (!COMMIT.test(config?.operatorCommit ?? "") || !Number.isSafeInteger(config?.operatorCiRunId)) {
    throw new Error("private cron bridge rebind target is invalid");
  }
  const prior = validateState(value, {
    operatorCommit: recoverable.operatorCommit,
    operatorCiRunId: recoverable.operatorCiRunId,
  });
  if (
    prior.stage !== "bridge-promoted"
    || prior.previousEnvironmentId !== recoverable.previousEnvironmentId
    || prior.bridgeDeploymentId !== recoverable.bridgeDeploymentId
    || prior.bridgeDeploymentUrl !== recoverable.bridgeDeploymentUrl
    || prior.oldSecretSha256 !== recoverable.oldSecretSha256
    || prior.newSecretSha256 !== recoverable.newSecretSha256
    || prior.previousOperatorCommit !== undefined
    || prior.previousOperatorCiRunId !== undefined
    || config.operatorCommit === prior.operatorCommit
    || config.operatorCiRunId === prior.operatorCiRunId
  ) throw new Error("private cron bridge state is not eligible for exact recovery rebind");
  return validateState({
    ...prior,
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    previousOperatorCommit: prior.operatorCommit,
    previousOperatorCiRunId: prior.operatorCiRunId,
    updatedAt: new Date().toISOString(),
  }, config);
}

function readState(config) {
  assertPrivateFile(JOURNAL, "cron recovery journal");
  const value = JSON.parse(readFileSync(JOURNAL, "utf8"));
  if (
    value?.operatorCommit === config.operatorCommit
    && value.operatorCiRunId === config.operatorCiRunId
  ) return validateState(value, config);
  const rebound = rebindRecoverableBridgeState(value, config);
  writePrivate(JOURNAL, `${JSON.stringify(rebound, null, 2)}\n`, { replace: true });
  return rebound;
}

function writeState(state, stage, patch = {}) {
  const next = { ...state, ...patch, stage, updatedAt: new Date().toISOString() };
  writePrivate(JOURNAL, `${JSON.stringify(next, null, 2)}\n`, { replace: existsSync(JOURNAL) });
  return Object.freeze(next);
}

function createState(config, oldSecret) {
  const createdAt = new Date().toISOString();
  const newSecret = crypto.randomBytes(48).toString("hex");
  return writeState({
    schemaVersion: 1,
    operation: "cron-secret-credential-exposure-recovery",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    oldSecret,
    newSecret,
    oldSecretSha256: sha256(oldSecret),
    newSecretSha256: sha256(newSecret),
    previousEnvironmentId: null,
    bridgeDeploymentId: null,
    bridgeDeploymentUrl: null,
    dualDeploymentId: null,
    dualDeploymentUrl: null,
    dualPromotedAt: null,
    finalDeploymentId: null,
    finalDeploymentUrl: null,
    createdAt,
    updatedAt: createdAt,
  }, "preflight");
}

export function sanitizedEvidence(config, state, routes, github) {
  if (
    !COMMIT.test(config?.operatorCommit ?? "")
    || !Number.isSafeInteger(config?.operatorCiRunId)
    || !DEPLOYMENT.test(state?.finalDeploymentId ?? "")
    || !Array.isArray(routes)
    || routes.length !== 2
    || Number.isNaN(Date.parse(github?.currentUpdatedAt))
    || Date.parse(github.currentUpdatedAt) < Date.parse(state.createdAt)
  ) throw new Error("cron recovery evidence input drifted");
  return Object.freeze({
    schemaVersion: 1,
    operation: "cron-secret-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    completedAt: new Date().toISOString(),
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    credentials: {
      oldSecretSha256: state.oldSecretSha256,
      replacementSecretSha256: state.newSecretSha256,
      replacementAccepted: true,
      oldCredentialRejectedOnCanonicalProduction: true,
      wrongCredentialRejected: true,
    },
    consumers: {
      localCurrentUpdated: true,
      localPreviousRemoved: true,
      githubRepositorySecretUpdatedAt: github.currentUpdatedAt,
      vercelSharedCurrentUpdated: true,
      vercelSharedPreviousRemoved: true,
    },
    deployment: {
      sourceCommit: SOURCE_COMMIT,
      predecessorId: PREDECESSOR_DEPLOYMENT,
      bridgeDeploymentId: state.bridgeDeploymentId,
      dualDeploymentId: state.dualDeploymentId,
      finalDeploymentId: state.finalDeploymentId,
      canonicalRoutes: routes,
      deploymentProtection: "all_except_custom_domains",
      historicalGeneratedArtifactsPubliclyCallable: false,
      historicalArtifactsRemoved: false,
      rollbackRequiresRebuildWithCurrentCredentials: true,
    },
    migrationsApplied: [],
    rlsChanged: false,
    providerStateOutsideVercelAndGithubChanged: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  if (
    value?.schemaVersion !== 1
    || value.operation !== "cron-secret-credential-exposure-recovery"
    || value.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || Number.isNaN(Date.parse(value.completedAt))
    || value.operator?.commit !== config.operatorCommit
    || value.operator?.ciRunId !== config.operatorCiRunId
    || !SHA256.test(value.credentials?.oldSecretSha256 ?? "")
    || !SHA256.test(value.credentials?.replacementSecretSha256 ?? "")
    || value.credentials.oldSecretSha256 === value.credentials.replacementSecretSha256
    || value.credentials.replacementAccepted !== true
    || value.credentials.oldCredentialRejectedOnCanonicalProduction !== true
    || value.credentials.wrongCredentialRejected !== true
    || value.consumers?.localCurrentUpdated !== true
    || value.consumers.localPreviousRemoved !== true
    || Number.isNaN(Date.parse(value.consumers.githubRepositorySecretUpdatedAt))
    || value.consumers.vercelSharedCurrentUpdated !== true
    || value.consumers.vercelSharedPreviousRemoved !== true
    || value.deployment?.sourceCommit !== SOURCE_COMMIT
    || value.deployment.predecessorId !== PREDECESSOR_DEPLOYMENT
    || !DEPLOYMENT.test(value.deployment.dualDeploymentId ?? "")
    || !DEPLOYMENT.test(value.deployment.bridgeDeploymentId ?? "")
    || !DEPLOYMENT.test(value.deployment.finalDeploymentId ?? "")
    || value.deployment.bridgeDeploymentId === value.deployment.dualDeploymentId
    || value.deployment.bridgeDeploymentId === value.deployment.finalDeploymentId
    || value.deployment.dualDeploymentId === value.deployment.finalDeploymentId
    || value.deployment.deploymentProtection !== "all_except_custom_domains"
    || value.deployment.historicalGeneratedArtifactsPubliclyCallable !== false
    || value.deployment.historicalArtifactsRemoved !== false
    || value.deployment.rollbackRequiresRebuildWithCurrentCredentials !== true
    || JSON.stringify(value.deployment.canonicalRoutes) !== JSON.stringify([
      { route: "/", status: 200 },
      { route: "/api/health", status: 200 },
    ])
    || value.migrationsApplied?.length !== 0
    || value.rlsChanged !== false
    || value.providerStateOutsideVercelAndGithubChanged !== false
  ) throw new Error("accepted cron recovery evidence drifted");
  return Object.freeze(value);
}

export async function runRecovery(config) {
  if (!COMMIT.test(config?.operatorCommit) || !Number.isSafeInteger(config?.operatorCiRunId)) {
    throw new Error("cron recovery requires an exact operator commit and CI run");
  }
  assertExactGitState(gitState(process.cwd()), config.operatorCommit);
  assertExactGitState(gitState(SOURCE), SOURCE_COMMIT);
  githubRun(config.operatorCiRunId, config.operatorCommit);
  projectProtection();

  if (existsSync(EVIDENCE)) {
    assertPrivateFile(EVIDENCE, "cron recovery evidence");
    const raw = readFileSync(EVIDENCE, "utf8");
    validateAcceptedEvidence(JSON.parse(raw), config);
    if (existsSync(JOURNAL)) rmSync(JOURNAL);
    return Object.freeze({ status: "passed", evidenceSha256: sha256(raw) });
  }

  let state;
  if (existsSync(JOURNAL)) {
    state = readState(config);
  } else {
    const local = readLocal();
    const oldSecret = local.CRON_SECRET;
    if (typeof oldSecret !== "string" || oldSecret.length < 32 || local.CRON_SECRET_PREVIOUS !== undefined) {
      throw new Error("local cron recovery preflight failed");
    }
    githubSecretMetadata();
    sharedInventory(null);
    projectEnvironmentInventory("shadow");
    const resolved = resolvedVercelHashes();
    if (resolved.current !== sha256(oldSecret) || resolved.previous !== "absent") {
      throw new Error("resolved Vercel cron preflight did not match local state");
    }
    normalizeAliasTargets(aliasTargets(), PREDECESSOR_DEPLOYMENT);
    await probeCanonical(oldSecret, oldSecret, "dual");
    state = validateState(createState(config, oldSecret), config);
  }

  if (state.stage === "preflight") {
    const previous = await createPreviousSecret(
      state.newSecret,
      state.oldSecretSha256,
      state.newSecretSha256,
    );
    state = writeState(state, "bridge-previous-created", {
      previousEnvironmentId: previous.sharedId,
    });
  }
  if (state.stage === "bridge-previous-created") {
    const deployment = deployReplacement(state, "bridge", PREDECESSOR_DEPLOYMENT);
    state = writeState(state, "bridge-ready", {
      bridgeDeploymentId: deployment.id,
      bridgeDeploymentUrl: deployment.url,
    });
  }
  if (state.stage === "bridge-ready") {
    promote(state.bridgeDeploymentUrl, PREDECESSOR_DEPLOYMENT, state.bridgeDeploymentId);
    await probeCanonical(state.oldSecret, state.newSecret, "dual");
    state = writeState(state, "bridge-promoted");
  }
  if (state.stage === "bridge-promoted") {
    normalizeAliasTargets(aliasTargets(), state.bridgeDeploymentId);
    await probeCanonical(state.oldSecret, state.newSecret, "dual");
    await updateDualSecrets(
      state.newSecret,
      state.oldSecret,
      state.previousEnvironmentId,
      { old: state.oldSecretSha256, replacement: state.newSecretSha256 },
    );
    updateGithubSecret(state.newSecret);
    setLocalValues(state.newSecret, state.oldSecret);
    const resolved = resolvedVercelHashes();
    if (resolved.current !== state.newSecretSha256 || resolved.previous !== state.oldSecretSha256) {
      throw new Error("dual cron environment did not converge");
    }
    state = writeState(state, "consumers-updated");
  }
  if (state.stage === "consumers-updated") {
    const deployment = deployReplacement(state, "dual", state.bridgeDeploymentId);
    state = writeState(state, "dual-ready", {
      dualDeploymentId: deployment.id,
      dualDeploymentUrl: deployment.url,
    });
  }
  if (state.stage === "dual-ready") {
    promote(state.dualDeploymentUrl, state.bridgeDeploymentId, state.dualDeploymentId);
    await probeCanonical(state.newSecret, state.oldSecret, "dual");
    state = writeState(state, "dual-promoted", { dualPromotedAt: new Date().toISOString() });
  }
  if (state.stage === "dual-promoted") {
    normalizeAliasTargets(aliasTargets(), state.dualDeploymentId);
    await probeCanonical(state.newSecret, state.oldSecret, "dual");
    const elapsedMs = Date.now() - Date.parse(state.dualPromotedAt);
    if (elapsedMs < MAX_REQUEST_DRAIN_MS) {
      return Object.freeze({
        status: "drain-wait",
        waitSeconds: Math.ceil((MAX_REQUEST_DRAIN_MS - elapsedMs) / 1000),
        dualDeploymentId: state.dualDeploymentId,
      });
    }
    await deletePreviousSecret(
      state.previousEnvironmentId,
      state.newSecretSha256,
      state.oldSecretSha256,
    );
    setLocalValues(state.newSecret, null);
    const resolved = resolvedVercelHashes();
    if (resolved.current !== state.newSecretSha256 || resolved.previous !== "absent") {
      throw new Error("final cron environment did not converge");
    }
    state = writeState(state, "previous-removed");
  }
  if (state.stage === "previous-removed") {
    const deployment = deployReplacement(state, "final", state.dualDeploymentId);
    state = writeState(state, "final-ready", {
      finalDeploymentId: deployment.id,
      finalDeploymentUrl: deployment.url,
    });
  }
  if (state.stage === "final-ready") {
    promote(state.finalDeploymentUrl, state.dualDeploymentId, state.finalDeploymentId);
    try {
      await probeCanonical(state.newSecret, state.oldSecret, "final");
    } catch {
      promote(state.dualDeploymentUrl, state.finalDeploymentId, state.dualDeploymentId);
      throw new Error("final cron proof failed and canonical aliases were restored to the dual deployment");
    }
    state = writeState(state, "final-promoted");
  }
  if (state.stage === "final-promoted") {
    projectProtection();
    sharedInventory(null);
    projectEnvironmentInventory("none");
    normalizeAliasTargets(aliasTargets(), state.finalDeploymentId);
    const resolved = resolvedVercelHashes();
    if (resolved.current !== state.newSecretSha256 || resolved.previous !== "absent") {
      throw new Error("final Vercel cron environment drifted");
    }
    const local = readLocal();
    if (sha256(local.CRON_SECRET ?? "") !== state.newSecretSha256 || local.CRON_SECRET_PREVIOUS !== undefined) {
      throw new Error("final local cron environment drifted");
    }
    await probeCanonical(state.newSecret, state.oldSecret, "final");
    const routes = await liveRoutes();
    const github = githubSecretMetadata();
    const evidence = sanitizedEvidence(config, state, routes, github);
    writePrivate(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { replace: false });
    rmSync(JOURNAL);
    return Object.freeze({
      status: "passed",
      acceptanceEligible: true,
      finalDeploymentId: state.finalDeploymentId,
      oldCredentialRejected: true,
      evidenceSha256: sha256(readFileSync(EVIDENCE)),
    });
  }
  throw new Error("cron recovery reached an unknown stage");
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  if (values.get("--confirm") !== "rotate-exposed-cron-secret-20260902") {
    throw new Error("cron recovery confirmation mismatch");
  }
  return {
    operatorCommit: values.get("--operator-commit"),
    operatorCiRunId: Number(values.get("--operator-ci-run-id")),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRecovery(parseArguments(process.argv.slice(2))).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => {
      process.stderr.write("Cron secret credential recovery stopped fail-closed; inspect the private journal.\n");
      process.exitCode = 1;
    },
  );
}
