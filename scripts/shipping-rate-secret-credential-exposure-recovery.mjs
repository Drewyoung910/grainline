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
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { signRate, verifyRate } from "../src/lib/shipping-token.ts";

const OPERATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/Users/drewyoung/grainline";
const SOURCE = "/private/tmp/grainline-order-shipping-production-deploy-20260902";
const LOCAL_ENV = path.join(ROOT, ".env.local");
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const JOURNAL = path.join(
  EVIDENCE_DIRECTORY,
  ".shipping-rate-secret-credential-recovery-20260902.private.json",
);
const EVIDENCE = path.join(
  EVIDENCE_DIRECTORY,
  "shipping-rate-secret-credential-recovery-20260902.json",
);
const VERCEL_CLI = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";

const REPOSITORY = "Drewyoung910/grainline";
export const PROJECT = Object.freeze({
  id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  name: "grainline",
  scope: "drew-youngs-projects",
});
export const SOURCE_COMMIT = "a4c74bbaeded1e347ec582289a226eae24763faf";
export const SOURCE_CI_RUN_ID = 33683844324;
export const PREDECESSOR_DEPLOYMENT = "dpl_GfJdUoqm6gCMGi8CMEExWVEN5xRC";
export const COMPATIBILITY_DEPLOYMENT = "dpl_Ec5mLGwhv3jXWEa88z2BeUs5N3j7";
export const OLD_SECRET_SHA256 = "8522a90d56d50b66d35a58d6bf2d7486f17b884fbbd58a649e38c796ce8b9975";
export const CURRENT_ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id: "QtdQdIWG7kRGIfU4",
    key: "SHIPPING_RATE_SECRET",
    type: "encrypted",
    target: Object.freeze(["preview"]),
  }),
  Object.freeze({
    id: "Qr10JAPww1OXr8JX",
    key: "SHIPPING_RATE_SECRET",
    type: "encrypted",
    target: Object.freeze(["development"]),
  }),
  Object.freeze({
    id: "Sux1asRFN0hfoiok",
    key: "SHIPPING_RATE_SECRET",
    type: "encrypted",
    target: Object.freeze(["production"]),
  }),
]);
export const PREVIOUS_KEY = "SHIPPING_RATE_SECRET_PREVIOUS";
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const MAX_REQUEST_DRAIN_MS = 35 * 60 * 1_000;

const COMMIT = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const ENVIRONMENT_ID = /^[A-Za-z0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STAGES = Object.freeze([
  "preflight",
  "previous-created",
  "vercel-updated",
  "github-updated",
  "local-updated",
  "dual-ready",
  "dual-promoted",
  "drain-complete",
  "previous-removed",
  "final-ready",
  "final-promoted",
]);

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

function run(command, args, { cwd = OPERATOR_ROOT, input, json = false, timeout = 90_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeEnvironment(),
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("shipping-rate credential recovery dependency failed");
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("shipping-rate credential recovery dependency returned invalid JSON");
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
  if (!COMMIT.test(expected ?? "") || state?.head !== expected || state.status !== "") {
    throw new Error("shipping-rate recovery Git state is not exact and clean");
  }
  return true;
}

function githubRun(id, commit, expectedEvent = "push") {
  const payload = run("gh", ["api", `repos/${REPOSITORY}/actions/runs/${id}`], { json: true });
  if (
    payload?.id !== id
    || payload.head_sha !== commit
    || payload.status !== "completed"
    || payload.conclusion !== "success"
    || payload.name !== "CI"
    || payload.event !== expectedEvent
  ) throw new Error("shipping-rate recovery CI binding failed");
  return true;
}

function githubSecretMetadata() {
  const rows = run(
    "gh",
    ["secret", "list", "--repo", REPOSITORY, "--json", "name,updatedAt"],
    { json: true },
  );
  const current = rows.filter((row) => row?.name === "SHIPPING_RATE_SECRET");
  const previous = rows.filter((row) => row?.name === PREVIOUS_KEY);
  if (current.length !== 1 || previous.length !== 0) {
    throw new Error("GitHub shipping-rate secret inventory drifted");
  }
  return Object.freeze({ currentUpdatedAt: current[0].updatedAt });
}

function updateGithubSecret(value) {
  run("gh", ["secret", "set", "SHIPPING_RATE_SECRET", "--repo", REPOSITORY], {
    input: `${value}\n`,
  });
}

function readLocal() {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  return dotenv.parse(readFileSync(LOCAL_ENV, "utf8"));
}

function setLocalCurrent(value) {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  const currentPattern = /^SHIPPING_RATE_SECRET=.*$/m;
  if (!currentPattern.test(source)) {
    throw new Error("SHIPPING_RATE_SECRET is missing from local environment");
  }
  let next = source.replace(currentPattern, `SHIPPING_RATE_SECRET=${value}`);
  next = next.replace(/^SHIPPING_RATE_SECRET_PREVIOUS=.*(?:\n|$)/m, "");
  writePrivate(LOCAL_ENV, next, { replace: true });
  const parsed = readLocal();
  if (parsed.SHIPPING_RATE_SECRET !== value || parsed.SHIPPING_RATE_SECRET_PREVIOUS !== undefined) {
    throw new Error("local shipping-rate secret convergence failed");
  }
}

function vercelApi(route, { method, body } = {}) {
  const args = [VERCEL_CLI, "api", route, "--raw", "--scope", PROJECT.scope, "--no-color"];
  if (method) args.push("--method", method);
  if (method === "DELETE") {
    const match = route.match(
      new RegExp(`^/v9/projects/${PROJECT.id}/env/([A-Za-z0-9]+)$`),
    );
    if (!match || !ENVIRONMENT_ID.test(match[1])) {
      throw new Error("Vercel destructive request is outside the exact shipping environment fence");
    }
    args.push("--dangerously-skip-permissions");
  }
  if (body !== undefined) args.push("--input", "-", "--silent");
  const output = run(process.execPath, args, {
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (output === "" && ["DELETE", "PATCH"].includes(method)) return Object.freeze({});
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Vercel API returned invalid JSON");
  }
}

function exactEnvironmentMetadata(row, expected) {
  return (
    row?.id === expected.id
    && row.key === expected.key
    && row.type === expected.type
    && row.gitBranch == null
    && row.configurationId == null
    && Array.isArray(row.customEnvironmentIds)
    && row.customEnvironmentIds.length === 0
    && JSON.stringify(row.target) === JSON.stringify(expected.target)
  );
}

export function normalizeEnvironmentInventory(
  payload,
  previousId = null,
  { allowAnyPrevious = false } = {},
) {
  if (!Array.isArray(payload?.envs)) {
    throw new Error("Vercel shipping environment inventory is incomplete");
  }
  const currentRows = payload.envs.filter((row) => row?.key === "SHIPPING_RATE_SECRET");
  const previousRows = payload.envs.filter((row) => row?.key === PREVIOUS_KEY);
  if (currentRows.length !== CURRENT_ENVIRONMENTS.length) {
    throw new Error("Vercel current shipping environment count drifted");
  }
  for (const expected of CURRENT_ENVIRONMENTS) {
    const rows = currentRows.filter((row) => row?.id === expected.id);
    if (rows.length !== 1 || !exactEnvironmentMetadata(rows[0], expected)) {
      throw new Error("Vercel current shipping environment metadata drifted");
    }
  }
  const expectedPrevious = (id) => Object.freeze({
    id,
    key: PREVIOUS_KEY,
    type: "encrypted",
    target: Object.freeze(["production"]),
  });
  if (allowAnyPrevious) {
    if (
      previousRows.length > 1
      || (previousRows.length === 1 && (
        !ENVIRONMENT_ID.test(previousRows[0]?.id ?? "")
        || !exactEnvironmentMetadata(previousRows[0], expectedPrevious(previousRows[0].id))
      ))
    ) throw new Error("Vercel previous shipping environment metadata drifted");
  } else if (previousId === null) {
    if (previousRows.length !== 0) throw new Error("unexpected previous shipping environment exists");
  } else if (
    previousRows.length !== 1
    || !exactEnvironmentMetadata(previousRows[0], expectedPrevious(previousId))
  ) {
    throw new Error("Vercel previous shipping environment metadata drifted");
  }
  return Object.freeze({
    currentIds: Object.freeze(CURRENT_ENVIRONMENTS.map((row) => row.id)),
    previousId: allowAnyPrevious ? previousRows[0]?.id ?? null : previousId,
  });
}

function environmentInventory(previousId = null, options = {}) {
  return normalizeEnvironmentInventory(
    vercelApi(`/v10/projects/${PROJECT.id}/env?decrypt=false`),
    previousId,
    options,
  );
}

export function normalizeEnvironmentValue(payload, expected) {
  if (
    !exactEnvironmentMetadata(payload, expected)
    || payload.decrypted !== true
    || typeof payload.value !== "string"
    || payload.value.length < 32
  ) throw new Error("Vercel shipping environment value response drifted");
  return payload.value;
}

function readEnvironmentValue(expected) {
  return normalizeEnvironmentValue(
    vercelApi(`/v1/projects/${PROJECT.id}/env/${expected.id}`),
    expected,
  );
}

function storedHashes(previousId = null) {
  const current = Object.fromEntries(
    CURRENT_ENVIRONMENTS.map((expected) => [expected.id, sha256(readEnvironmentValue(expected))]),
  );
  const previous = previousId === null
    ? "absent"
    : sha256(readEnvironmentValue({
      id: previousId,
      key: PREVIOUS_KEY,
      type: "encrypted",
      target: Object.freeze(["production"]),
    }));
  return Object.freeze({ current: Object.freeze(current), previous });
}

export function classifyStoredHashes(snapshot, hashes, previousRequired) {
  if (
    !SHA256.test(hashes?.old ?? "")
    || !SHA256.test(hashes?.replacement ?? "")
    || hashes.old === hashes.replacement
    || typeof snapshot?.current !== "object"
  ) throw new Error("shipping-rate hash classification input is invalid");
  const values = CURRENT_ENVIRONMENTS.map((row) => snapshot.current[row.id]);
  if (values.some((value) => ![hashes.old, hashes.replacement].includes(value))) {
    throw new Error("Vercel current shipping value changed outside the reviewed pair");
  }
  const expectedPrevious = previousRequired ? hashes.old : "absent";
  if (snapshot.previous !== expectedPrevious) {
    throw new Error("Vercel previous shipping value drifted");
  }
  if (values.every((value) => value === hashes.old)) return "old";
  if (values.every((value) => value === hashes.replacement)) return "replacement";
  return "partial";
}

async function createPreviousSecret(value, expectedOldHash) {
  let inventory = environmentInventory(null, { allowAnyPrevious: true });
  if (inventory.previousId === null) {
    vercelApi(`/v10/projects/${PROJECT.id}/env`, {
      method: "POST",
      body: {
        key: PREVIOUS_KEY,
        value,
        type: "encrypted",
        target: ["production"],
        comment: "Temporary shipping-rate verifier key for 2026-09-02 exposure recovery",
      },
    });
    inventory = environmentInventory(null, { allowAnyPrevious: true });
  }
  if (!inventory.previousId) {
    throw new Error("Vercel previous shipping environment creation was ambiguous");
  }
  environmentInventory(inventory.previousId);
  const valueHash = storedHashes(inventory.previousId).previous;
  if (valueHash !== expectedOldHash) {
    throw new Error("Vercel previous shipping value is not the reviewed old secret");
  }
  return Object.freeze({ id: inventory.previousId });
}

function updateCurrentEnvironments(value, hashes, previousId) {
  environmentInventory(previousId);
  let snapshot = storedHashes(previousId);
  classifyStoredHashes(snapshot, hashes, true);
  for (const expected of CURRENT_ENVIRONMENTS) {
    if (snapshot.current[expected.id] === hashes.replacement) continue;
    if (snapshot.current[expected.id] !== hashes.old) {
      throw new Error("Vercel current shipping value cannot be converged safely");
    }
    vercelApi(`/v9/projects/${PROJECT.id}/env/${expected.id}`, {
      method: "PATCH",
      body: {
        key: expected.key,
        value,
        type: expected.type,
        target: expected.target,
      },
    });
    environmentInventory(previousId);
    snapshot = storedHashes(previousId);
    classifyStoredHashes(snapshot, hashes, true);
  }
  if (classifyStoredHashes(snapshot, hashes, true) !== "replacement") {
    throw new Error("Vercel current shipping values did not converge");
  }
}

function deletePreviousSecret(previousId, hashes) {
  const inventory = environmentInventory(null, { allowAnyPrevious: true });
  if (inventory.previousId !== null && inventory.previousId !== previousId) {
    throw new Error("Vercel previous shipping environment identity drifted");
  }
  if (inventory.previousId !== null) {
    const snapshot = storedHashes(previousId);
    if (classifyStoredHashes(snapshot, hashes, true) !== "replacement") {
      throw new Error("Vercel shipping values are not final-ready");
    }
    vercelApi(`/v9/projects/${PROJECT.id}/env/${previousId}`, { method: "DELETE" });
  }
  environmentInventory(null);
  const finalSnapshot = storedHashes(null);
  if (classifyStoredHashes(finalSnapshot, hashes, false) !== "replacement") {
    throw new Error("Vercel final shipping values did not converge");
  }
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
    sourceRef: payload.meta?.gitCommitRef,
    marker: payload.meta?.grainlineShippingRateCredentialRecovery,
    phase: payload.meta?.grainlineShippingRateCredentialRecoveryPhase,
  });
}

export function normalizeCompatibilityDeployment(value) {
  if (
    value?.id !== COMPATIBILITY_DEPLOYMENT
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.sourceCommit !== SOURCE_COMMIT
  ) throw new Error("shipping-rate compatibility deployment drifted");
  return Object.freeze({ ...value });
}

export function normalizeRecoveryDeployment(value, marker, phase, distinctFrom) {
  if (
    !DEPLOYMENT.test(value?.id ?? "")
    || typeof value.url !== "string"
    || !value.url.endsWith(".vercel.app")
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceRef !== "main"
    || value.marker !== marker
    || value.phase !== phase
    || value.id === distinctFrom
  ) throw new Error("shipping-rate recovery deployment is invalid");
  return Object.freeze({ ...value });
}

function deploymentMarker(createdAt, phase) {
  return sha256(`shipping-rate-secret-recovery:${createdAt}:${phase}`).slice(0, 32);
}

export function normalizeMarkedDeploymentInventory(
  payload,
  createdAt,
  marker,
  phase,
  distinctFrom,
) {
  if (!Array.isArray(payload?.deployments)) {
    throw new Error("Vercel deployment inventory is incomplete");
  }
  const earliest = Date.parse(createdAt) - 60_000;
  const matches = payload.deployments.filter((row) => (
    row?.projectId === PROJECT.id
    && row.target === "production"
    && row.meta?.gitCommitSha === SOURCE_COMMIT
    && row.meta?.grainlineShippingRateCredentialRecovery === marker
    && row.meta?.grainlineShippingRateCredentialRecoveryPhase === phase
    && Number(row.createdAt) >= earliest
  ));
  if (matches.length > 1) throw new Error("shipping-rate recovery deployment is ambiguous");
  return matches.length === 0
    ? null
    : normalizeRecoveryDeployment({
      id: matches[0].uid ?? matches[0].id,
      url: matches[0].url,
      projectId: matches[0].projectId,
      readyState: matches[0].readyState,
      target: matches[0].target,
      sourceCommit: matches[0].meta?.gitCommitSha,
      sourceRef: matches[0].meta?.gitCommitRef,
      marker: matches[0].meta?.grainlineShippingRateCredentialRecovery,
      phase: matches[0].meta?.grainlineShippingRateCredentialRecoveryPhase,
    }, marker, phase, distinctFrom);
}

function findMarkedDeployment(state, phase, distinctFrom) {
  const marker = deploymentMarker(state.createdAt, phase);
  return normalizeMarkedDeploymentInventory(
    vercelApi(`/v6/deployments?projectId=${PROJECT.id}&target=production&limit=100`),
    state.createdAt,
    marker,
    phase,
    distinctFrom,
  );
}

function deployReplacement(state, phase, distinctFrom) {
  const marker = deploymentMarker(state.createdAt, phase);
  const existing = findMarkedDeployment(state, phase, distinctFrom);
  if (existing) return existing;
  const output = run(process.execPath, [
    VERCEL_CLI,
    "deploy", SOURCE,
    "--prod", "--skip-domain", "--force", "--yes",
    "--project", PROJECT.name, "--scope", PROJECT.scope,
    "--meta", `gitCommitSha=${SOURCE_COMMIT}`,
    "--meta", "gitCommitRef=main",
    "--meta", `grainlineShippingRateCredentialRecovery=${marker}`,
    "--meta", `grainlineShippingRateCredentialRecoveryPhase=${phase}`,
    "--no-color",
  ], { cwd: SOURCE, timeout: 15 * 60_000 });
  const url = output.split(/\r?\n/)
    .find((line) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line.trim()))?.trim();
  if (!url) throw new Error("shipping-rate recovery deployment URL was not returned");
  const created = findMarkedDeployment(state, phase, distinctFrom);
  if (!created || created.url !== new URL(url).hostname) {
    throw new Error("shipping-rate recovery deployment creation was ambiguous");
  }
  return created;
}

function aliasTargets() {
  return CANONICAL_ALIASES.map((alias) => Object.freeze({ alias, deployment: readDeployment(alias) }));
}

export function normalizeAliasTargets(targets, expectedId) {
  if (
    !DEPLOYMENT.test(expectedId ?? "")
    || !Array.isArray(targets)
    || targets.length !== CANONICAL_ALIASES.length
    || targets.some((entry, index) => (
      entry?.alias !== CANONICAL_ALIASES[index]
      || entry.deployment?.id !== expectedId
      || entry.deployment.projectId !== PROJECT.id
      || entry.deployment.readyState !== "READY"
      || entry.deployment.target !== "production"
    ))
  ) throw new Error("canonical shipping alias state drifted");
  return true;
}

export function normalizeAliasPosition(targets, fromId, toId) {
  const ids = new Set(targets.map((entry) => entry?.deployment?.id));
  if (ids.size !== 1) throw new Error("canonical shipping aliases are partially promoted");
  const observed = [...ids][0];
  if (observed === fromId) {
    normalizeAliasTargets(targets, fromId);
    return "from";
  }
  if (observed === toId) {
    normalizeAliasTargets(targets, toId);
    return "to";
  }
  throw new Error("canonical shipping aliases moved to an unreviewed deployment");
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

async function canonicalHealth() {
  const response = await fetch("https://thegrainline.com/api/health", {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200) throw new Error("canonical health check failed");
  const body = await response.json();
  if (body?.ok !== true) throw new Error("canonical health payload drifted");
  return true;
}

function canonicalV2Input(fields, expiresAt) {
  const normalize = (value, casing) => {
    const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return casing === "upper" ? text.toUpperCase() : text.toLowerCase();
  };
  return JSON.stringify([
    "shipping-rate-v2",
    fields.objectId,
    fields.amountCents,
    fields.currency.toLowerCase(),
    fields.displayName,
    fields.carrier,
    fields.estDays,
    fields.contextId,
    fields.buyerId,
    normalize(fields.buyerCity, "lower"),
    normalize(fields.buyerState, "upper"),
    normalize(fields.buyerPostal, "upper"),
    normalize(fields.buyerCountry, "upper"),
    fields.subjectHash ?? "",
    expiresAt,
  ]);
}

export function proveLocalVerifier(oldSecret, replacementSecret, mode) {
  if (
    !["dual", "final"].includes(mode)
    || typeof oldSecret !== "string"
    || typeof replacementSecret !== "string"
    || oldSecret === replacementSecret
  ) throw new Error("shipping-rate verifier proof input is invalid");
  const fields = {
    objectId: "shipping-rate-recovery-proof",
    amountCents: 1234,
    currency: "usd",
    displayName: "Recovery Ground",
    carrier: "Recovery Carrier",
    estDays: 3,
    contextId: "shipping-rate-recovery-context",
    buyerId: "shipping-rate-recovery-buyer",
    buyerCity: "Austin",
    buyerState: "TX",
    buyerPostal: "78701",
    buyerCountry: "US",
    subjectHash: "shipping-rate-recovery-subject",
  };
  const previousCurrent = process.env.SHIPPING_RATE_SECRET;
  const previousPrevious = process.env.SHIPPING_RATE_SECRET_PREVIOUS;
  try {
    process.env.SHIPPING_RATE_SECRET = replacementSecret;
    if (mode === "dual") process.env.SHIPPING_RATE_SECRET_PREVIOUS = oldSecret;
    else delete process.env.SHIPPING_RATE_SECRET_PREVIOUS;
    const replacement = signRate(fields, 60);
    const oldExpiresAt = replacement.expiresAt;
    const oldToken = crypto.createHmac("sha256", oldSecret)
      .update(canonicalV2Input(fields, oldExpiresAt))
      .digest("hex");
    const replacementResult = verifyRate(fields, replacement.token, replacement.expiresAt);
    const oldResult = verifyRate(fields, oldToken, oldExpiresAt);
    const expectedOld = mode === "dual";
    if (replacementResult.ok !== true || oldResult.ok !== expectedOld) {
      throw new Error(`shipping-rate ${mode} verifier proof failed`);
    }
    return Object.freeze({ replacementAccepted: true, oldAccepted: expectedOld });
  } finally {
    if (previousCurrent === undefined) delete process.env.SHIPPING_RATE_SECRET;
    else process.env.SHIPPING_RATE_SECRET = previousCurrent;
    if (previousPrevious === undefined) delete process.env.SHIPPING_RATE_SECRET_PREVIOUS;
    else process.env.SHIPPING_RATE_SECRET_PREVIOUS = previousPrevious;
  }
}

export function validateState(value, expectedOldHash = OLD_SECRET_SHA256) {
  const stageIndex = STAGES.indexOf(value?.stage);
  if (
    !SHA256.test(expectedOldHash ?? "")
    ||
    value?.schemaVersion !== 1
    || value.operation !== "shipping-rate-secret-credential-exposure-recovery"
    || stageIndex < 0
    || !COMMIT.test(value.operatorCommit ?? "")
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.operatorCiRunId <= 0
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceCiRunId !== SOURCE_CI_RUN_ID
    || value.predecessorDeploymentId !== PREDECESSOR_DEPLOYMENT
    || value.compatibilityDeploymentId !== COMPATIBILITY_DEPLOYMENT
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.oldSecret !== "string"
    || value.oldSecret.length < 32
    || value.oldSecretSha256 !== expectedOldHash
    || sha256(value.oldSecret) !== value.oldSecretSha256
    || typeof value.replacementSecret !== "string"
    || value.replacementSecret.length < 32
    || !SHA256.test(value.replacementSecretSha256 ?? "")
    || sha256(value.replacementSecret) !== value.replacementSecretSha256
    || value.replacementSecretSha256 === value.oldSecretSha256
  ) throw new Error("private shipping-rate recovery state is invalid");
  if (stageIndex >= STAGES.indexOf("previous-created") && !ENVIRONMENT_ID.test(value.previousEnvironmentId ?? "")) {
    throw new Error("private shipping-rate previous environment state is incomplete");
  }
  if (stageIndex >= STAGES.indexOf("dual-ready")) {
    if (!DEPLOYMENT.test(value.dualDeploymentId ?? "") || typeof value.dualDeploymentUrl !== "string") {
      throw new Error("private shipping-rate dual deployment state is incomplete");
    }
  }
  if (stageIndex >= STAGES.indexOf("dual-promoted")) {
    if (typeof value.dualPromotedAt !== "string" || !Number.isFinite(Date.parse(value.dualPromotedAt))) {
      throw new Error("private shipping-rate drain timestamp is incomplete");
    }
  }
  if (stageIndex >= STAGES.indexOf("final-ready")) {
    if (!DEPLOYMENT.test(value.finalDeploymentId ?? "") || typeof value.finalDeploymentUrl !== "string") {
      throw new Error("private shipping-rate final deployment state is incomplete");
    }
  }
  return Object.freeze({ ...value });
}

function readState() {
  assertPrivateFile(JOURNAL, "private shipping-rate recovery journal");
  return validateState(JSON.parse(readFileSync(JOURNAL, "utf8")));
}

function writeState(state, stage, patch = {}) {
  const current = STAGES.indexOf(state.stage);
  const next = STAGES.indexOf(stage);
  if (next < current || next > current + 1) {
    throw new Error("shipping-rate recovery stage transition is invalid");
  }
  const value = validateState({
    ...state,
    ...patch,
    stage,
    updatedAt: new Date().toISOString(),
  });
  writePrivate(JOURNAL, `${JSON.stringify(value, null, 2)}\n`, { replace: true });
  return value;
}

function createState(config, oldSecret) {
  const now = new Date().toISOString();
  const replacementSecret = crypto.randomBytes(48).toString("base64url");
  const value = validateState({
    schemaVersion: 1,
    operation: "shipping-rate-secret-credential-exposure-recovery",
    stage: "preflight",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    compatibilityDeploymentId: COMPATIBILITY_DEPLOYMENT,
    previousEnvironmentId: null,
    dualDeploymentId: null,
    dualDeploymentUrl: null,
    dualPromotedAt: null,
    finalDeploymentId: null,
    finalDeploymentUrl: null,
    oldSecret,
    oldSecretSha256: sha256(oldSecret),
    replacementSecret,
    replacementSecretSha256: sha256(replacementSecret),
    createdAt: now,
    updatedAt: now,
  });
  writePrivate(JOURNAL, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("shipping-rate recovery arguments are malformed");
    }
    if (Object.hasOwn(values, key)) throw new Error("shipping-rate recovery argument is duplicated");
    values[key] = value;
  }
  const operatorCommit = values["--operator-commit"];
  const operatorCiRunId = Number(values["--operator-ci-run"]);
  if (
    Object.keys(values).length !== 2
    || !COMMIT.test(operatorCommit ?? "")
    || !Number.isSafeInteger(operatorCiRunId)
    || operatorCiRunId <= 0
  ) throw new Error("shipping-rate recovery binding arguments are invalid");
  return Object.freeze({ operatorCommit, operatorCiRunId });
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDrain(promotedAt) {
  const deadline = Date.parse(promotedAt) + MAX_REQUEST_DRAIN_MS;
  if (!Number.isFinite(deadline)) throw new Error("shipping-rate drain timestamp is invalid");
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    process.stdout.write(`shipping-rate token drain remaining: ${Math.ceil(remaining / 1_000)}s\n`);
    await pause(Math.min(30_000, remaining));
  }
}

export function validateAcceptedEvidence(value) {
  if (
    value?.schemaVersion !== 1
    || value.operation !== "shipping-rate-secret-credential-exposure-recovery"
    || value.accepted !== true
    || typeof value.generatedAt !== "string"
    || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.recoveryCreatedAt !== "string"
    || !Number.isFinite(Date.parse(value.recoveryCreatedAt))
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceCiRunId !== SOURCE_CI_RUN_ID
    || value.compatibilityDeploymentId !== COMPATIBILITY_DEPLOYMENT
    || !COMMIT.test(value.operatorCommit ?? "")
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.operatorCiRunId <= 0
    || !DEPLOYMENT.test(value.dualDeploymentId ?? "")
    || !DEPLOYMENT.test(value.finalDeploymentId ?? "")
    || value.dualDeploymentId === value.finalDeploymentId
    || !ENVIRONMENT_ID.test(value.previousEnvironmentId ?? "")
    || JSON.stringify(value.currentEnvironmentIds) !== JSON.stringify(
      CURRENT_ENVIRONMENTS.map((row) => row.id),
    )
    || typeof value.githubCurrentUpdatedAt !== "string"
    || !Number.isFinite(Date.parse(value.githubCurrentUpdatedAt))
    || !SHA256.test(value.oldSecretSha256 ?? "")
    || value.oldSecretSha256 !== OLD_SECRET_SHA256
    || !SHA256.test(value.replacementSecretSha256 ?? "")
    || value.oldSecretSha256 === value.replacementSecretSha256
    || value.drainSeconds !== MAX_REQUEST_DRAIN_MS / 1_000
    || value.previousEnvironmentPresent !== false
    || value.oldSecretAcceptedAfterDrain !== false
    || value.replacementSecretAccepted !== true
    || value.productionHealth !== 200
    || JSON.stringify(value.canonicalAliases) !== JSON.stringify(CANONICAL_ALIASES)
  ) throw new Error("accepted shipping-rate recovery evidence is invalid");
  return Object.freeze({ ...value });
}

export function validateCompletedRestart(evidence, state, config) {
  if (
    evidence?.operatorCommit !== config?.operatorCommit
    || evidence.operatorCiRunId !== config.operatorCiRunId
    || (state !== null && (
      state.stage !== "final-promoted"
      || state.operatorCommit !== evidence.operatorCommit
      || state.operatorCiRunId !== evidence.operatorCiRunId
      || state.createdAt !== evidence.recoveryCreatedAt
      || state.dualDeploymentId !== evidence.dualDeploymentId
      || state.finalDeploymentId !== evidence.finalDeploymentId
      || state.previousEnvironmentId !== evidence.previousEnvironmentId
      || state.oldSecretSha256 !== evidence.oldSecretSha256
      || state.replacementSecretSha256 !== evidence.replacementSecretSha256
    ))
  ) throw new Error("completed shipping-rate recovery binding drifted");
  return true;
}

async function verifyCompletedEvidence() {
  assertPrivateFile(EVIDENCE, "shipping-rate recovery evidence");
  const evidence = validateAcceptedEvidence(JSON.parse(readFileSync(EVIDENCE, "utf8")));
  environmentInventory(null);
  const snapshot = storedHashes(null);
  if (snapshot.previous !== "absent") throw new Error("completed shipping-rate previous secret reappeared");
  if (Object.values(snapshot.current).some((value) => value !== evidence.replacementSecretSha256)) {
    throw new Error("completed shipping-rate current secret drifted");
  }
  const local = readLocal();
  if (
    typeof local.SHIPPING_RATE_SECRET !== "string"
    || sha256(local.SHIPPING_RATE_SECRET) !== evidence.replacementSecretSha256
    || local.SHIPPING_RATE_SECRET_PREVIOUS !== undefined
  ) throw new Error("completed local shipping-rate secret drifted");
  const github = githubSecretMetadata();
  if (github.currentUpdatedAt !== evidence.githubCurrentUpdatedAt) {
    throw new Error("completed GitHub shipping-rate secret metadata drifted");
  }
  normalizeRecoveryDeployment(
    readDeployment(evidence.finalDeploymentId),
    deploymentMarker(evidence.recoveryCreatedAt, "final"),
    "final",
    evidence.dualDeploymentId,
  );
  normalizeAliasTargets(aliasTargets(), evidence.finalDeploymentId);
  await canonicalHealth();
  return evidence;
}

function writeAcceptedEvidence(state, github) {
  const value = validateAcceptedEvidence({
    schemaVersion: 1,
    operation: "shipping-rate-secret-credential-exposure-recovery",
    accepted: true,
    generatedAt: new Date().toISOString(),
    recoveryCreatedAt: state.createdAt,
    operatorCommit: state.operatorCommit,
    operatorCiRunId: state.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    predecessorDeploymentId: PREDECESSOR_DEPLOYMENT,
    compatibilityDeploymentId: COMPATIBILITY_DEPLOYMENT,
    dualDeploymentId: state.dualDeploymentId,
    finalDeploymentId: state.finalDeploymentId,
    previousEnvironmentId: state.previousEnvironmentId,
    currentEnvironmentIds: CURRENT_ENVIRONMENTS.map((row) => row.id),
    githubCurrentUpdatedAt: github.currentUpdatedAt,
    oldSecretSha256: state.oldSecretSha256,
    replacementSecretSha256: state.replacementSecretSha256,
    dualPromotedAt: state.dualPromotedAt,
    drainSeconds: MAX_REQUEST_DRAIN_MS / 1_000,
    previousEnvironmentPresent: false,
    replacementSecretAccepted: true,
    oldSecretAcceptedAfterDrain: false,
    productionHealth: 200,
    canonicalAliases: CANONICAL_ALIASES,
    providerMutations: Object.freeze([
      "created one temporary Production-only SHIPPING_RATE_SECRET_PREVIOUS",
      "updated the three exact current Vercel rows",
      "updated the GitHub repository secret and mode-0600 local current value",
      "deleted only the temporary previous Vercel row after the token drain",
    ]),
  });
  writePrivate(EVIDENCE, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

async function main() {
  const config = parseArguments(process.argv.slice(2));
  if (existsSync(EVIDENCE)) {
    const accepted = await verifyCompletedEvidence();
    assertExactGitState(gitState(OPERATOR_ROOT), config.operatorCommit);
    assertExactGitState(gitState(SOURCE), SOURCE_COMMIT);
    githubRun(config.operatorCiRunId, config.operatorCommit, "push");
    githubRun(SOURCE_CI_RUN_ID, SOURCE_COMMIT, "push");
    projectProtection();
    const state = existsSync(JOURNAL) ? readState() : null;
    validateCompletedRestart(accepted, state, config);
    if (state !== null) rmSync(JOURNAL);
    process.stdout.write(`${JSON.stringify({
      accepted: true,
      finalDeploymentId: accepted.finalDeploymentId,
      evidence: EVIDENCE,
    })}\n`);
    return;
  }

  assertExactGitState(gitState(OPERATOR_ROOT), config.operatorCommit);
  assertExactGitState(gitState(SOURCE), SOURCE_COMMIT);
  githubRun(config.operatorCiRunId, config.operatorCommit, "push");
  githubRun(SOURCE_CI_RUN_ID, SOURCE_COMMIT, "push");
  projectProtection();
  normalizeCompatibilityDeployment(readDeployment(COMPATIBILITY_DEPLOYMENT));
  githubSecretMetadata();

  let state;
  if (existsSync(JOURNAL)) {
    state = readState();
    if (
      state.operatorCommit !== config.operatorCommit
      || state.operatorCiRunId !== config.operatorCiRunId
    ) throw new Error("private shipping-rate recovery journal binding drifted");
  } else {
    normalizeAliasTargets(aliasTargets(), COMPATIBILITY_DEPLOYMENT);
    environmentInventory(null);
    const initialHashes = storedHashes(null);
    const allOld = Object.values(initialHashes.current).every((value) => value === OLD_SECRET_SHA256);
    if (!allOld || initialHashes.previous !== "absent") {
      throw new Error("initial Vercel shipping secret state drifted");
    }
    const local = readLocal();
    if (
      typeof local.SHIPPING_RATE_SECRET !== "string"
      || sha256(local.SHIPPING_RATE_SECRET) !== OLD_SECRET_SHA256
      || local.SHIPPING_RATE_SECRET_PREVIOUS !== undefined
    ) throw new Error("initial local shipping secret state drifted");
    state = createState(config, local.SHIPPING_RATE_SECRET);
  }

  const hashes = Object.freeze({
    old: state.oldSecretSha256,
    replacement: state.replacementSecretSha256,
  });

  if (state.stage === "preflight") {
    const previous = await createPreviousSecret(state.oldSecret, hashes.old);
    state = writeState(state, "previous-created", { previousEnvironmentId: previous.id });
  }

  if (state.stage === "previous-created") {
    updateCurrentEnvironments(state.replacementSecret, hashes, state.previousEnvironmentId);
    state = writeState(state, "vercel-updated");
  }

  if (state.stage === "vercel-updated") {
    updateGithubSecret(state.replacementSecret);
    githubSecretMetadata();
    state = writeState(state, "github-updated");
  }

  if (state.stage === "github-updated") {
    setLocalCurrent(state.replacementSecret);
    state = writeState(state, "local-updated");
  }

  if (state.stage === "local-updated") {
    environmentInventory(state.previousEnvironmentId);
    if (classifyStoredHashes(storedHashes(state.previousEnvironmentId), hashes, true) !== "replacement") {
      throw new Error("shipping-rate dual provider state drifted before deployment");
    }
    proveLocalVerifier(state.oldSecret, state.replacementSecret, "dual");
    const dual = deployReplacement(state, "dual", COMPATIBILITY_DEPLOYMENT);
    state = writeState(state, "dual-ready", {
      dualDeploymentId: dual.id,
      dualDeploymentUrl: dual.url,
    });
  }

  if (state.stage === "dual-ready") {
    normalizeRecoveryDeployment(
      readDeployment(state.dualDeploymentId),
      deploymentMarker(state.createdAt, "dual"),
      "dual",
      COMPATIBILITY_DEPLOYMENT,
    );
    proveLocalVerifier(state.oldSecret, state.replacementSecret, "dual");
    promote(state.dualDeploymentUrl, COMPATIBILITY_DEPLOYMENT, state.dualDeploymentId);
    await canonicalHealth();
    state = writeState(state, "dual-promoted", { dualPromotedAt: new Date().toISOString() });
  }

  if (state.stage === "dual-promoted") {
    normalizeAliasTargets(aliasTargets(), state.dualDeploymentId);
    await canonicalHealth();
    await waitForDrain(state.dualPromotedAt);
    state = writeState(state, "drain-complete");
  }

  if (state.stage === "drain-complete") {
    deletePreviousSecret(state.previousEnvironmentId, hashes);
    state = writeState(state, "previous-removed");
  }

  if (state.stage === "previous-removed") {
    proveLocalVerifier(state.oldSecret, state.replacementSecret, "final");
    const final = deployReplacement(state, "final", state.dualDeploymentId);
    state = writeState(state, "final-ready", {
      finalDeploymentId: final.id,
      finalDeploymentUrl: final.url,
    });
  }

  if (state.stage === "final-ready") {
    normalizeRecoveryDeployment(
      readDeployment(state.finalDeploymentId),
      deploymentMarker(state.createdAt, "final"),
      "final",
      state.dualDeploymentId,
    );
    promote(state.finalDeploymentUrl, state.dualDeploymentId, state.finalDeploymentId);
    await canonicalHealth();
    state = writeState(state, "final-promoted");
  }

  if (state.stage !== "final-promoted") {
    throw new Error("shipping-rate recovery stopped before final acceptance");
  }

  environmentInventory(null);
  if (classifyStoredHashes(storedHashes(null), hashes, false) !== "replacement") {
    throw new Error("shipping-rate final provider state drifted");
  }
  const local = readLocal();
  if (
    local.SHIPPING_RATE_SECRET !== state.replacementSecret
    || local.SHIPPING_RATE_SECRET_PREVIOUS !== undefined
  ) throw new Error("shipping-rate final local state drifted");
  normalizeAliasTargets(aliasTargets(), state.finalDeploymentId);
  proveLocalVerifier(state.oldSecret, state.replacementSecret, "final");
  await canonicalHealth();
  const github = githubSecretMetadata();
  const accepted = writeAcceptedEvidence(state, github);
  rmSync(JOURNAL);
  process.stdout.write(`${JSON.stringify({
    accepted: true,
    finalDeploymentId: accepted.finalDeploymentId,
    evidence: EVIDENCE,
  })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("Shipping-rate credential recovery failed closed.\n");
    process.exitCode = 1;
  });
}
