#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
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
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClerkClient } from "@clerk/backend";
import dotenv from "dotenv";

import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";

const OPERATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/Users/drewyoung/grainline";
const DEPLOY_SOURCE = "/private/tmp/grainline-order-shipping-production-deploy-20260902";
const LOCAL_ENV = path.join(ROOT, ".env.local");
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const JOURNAL = path.join(
  EVIDENCE_DIRECTORY,
  ".clerk-server-key-credential-recovery-20260903.private.json",
);
const EVIDENCE = path.join(
  EVIDENCE_DIRECTORY,
  "clerk-server-key-credential-recovery-20260903.json",
);
const SHIPPO_EVIDENCE = path.join(
  EVIDENCE_DIRECTORY,
  "shippo-api-credential-recovery-20260903.json",
);
const VERCEL_CLI = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";

const REPOSITORY = "Drewyoung910/grainline";
const PRODUCTION_ORIGIN = "https://thegrainline.com";
const CLERK_FRONTEND_API = "clerk.thegrainline.com";
const CANARY_PURPOSE = "notification-rls-route-and-production-canary";
const RUNTIME_ENVIRONMENT_COMMENT = "Grainline production runtime Clerk key";

export const PROJECT = Object.freeze({
  id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  name: "grainline",
  scope: "drew-youngs-projects",
  teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
});
export const SOURCE_COMMIT = "82f58889b12095d21449494a036a327cc9feb9b1";
export const SOURCE_CI_RUN_ID = 33702373864;
export const CURRENT_DEPLOYMENT = Object.freeze({
  id: "dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz",
  url: "grainline-gjyx6izkn-drew-youngs-projects.vercel.app",
  createdAt: 1788403585649,
  sourceCommit: SOURCE_COMMIT,
});
export const SHARED_ENVIRONMENT = Object.freeze({
  id: "env_VXNad7lOhIh6x3YXnULLncRW",
  key: "CLERK_SECRET_KEY",
  type: "encrypted",
  ownerId: PROJECT.teamId,
  projectId: Object.freeze([PROJECT.id]),
  target: Object.freeze(["development", "preview", "production"]),
});
export const OLD_KEY_SHA256 = "3049c74f9158f6e79ba645b6250ecb7eef8c3f0a0dbbbfbc5f683be9192b500a";
export const EXPECTED_INSTANCE = Object.freeze({
  id: "ins_3BYdVgH643MVFsiKPloUw9GUYQK",
  environmentType: "production",
});
export const RUNTIME_KEY_NAME = "grainline-production-runtime-20260903";
export const OPERATIONS_KEY_NAME = "grainline-production-operations-20260903";
export const SHIPPO_EVIDENCE_SHA256 = "ebcd62085d611bc09e6b4d4ee8e3f4dc38c9c1cf31cb6ba51e1dd68bff6e3f66";
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const MAX_REQUEST_DRAIN_MS = 330_000;

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const ENVIRONMENT_ID = /^env_[A-Za-z0-9]+$/;
const SECRET_KEY = /^sk_live_[A-Za-z0-9_-]{20,256}$/;
const SESSION_ID = /^sess_[A-Za-z0-9]+$/;
const SIGN_IN_TOKEN_ID = /^sit_[A-Za-z0-9]+$/;
const STAGES = Object.freeze([
  "provider-runtime-create-required",
  "provider-operations-create-required",
  "operations-captured",
  "vercel-runtime-created",
  "github-operations-updated",
  "local-operations-updated",
  "candidate-ready",
  "promoted",
  "runtime-proven",
  "predecessor-removed",
  "shared-row-deleted",
  "provider-revocation-required",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEnvironment(extra = {}) {
  const env = {};
  for (const key of [
    "HOME", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS", "PATH",
    "SSL_CERT_DIR", "SSL_CERT_FILE", "TMPDIR", "USER",
  ]) {
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
    throw new Error("Clerk credential recovery dependency failed");
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Clerk credential recovery dependency returned invalid JSON");
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

function removePrivate(file) {
  assertPrivateFile(file, "private Clerk recovery journal");
  rmSync(file);
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
    throw new Error("Clerk credential recovery Git state is not exact and clean");
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
    || payload.event !== "push"
  ) throw new Error("Clerk credential recovery CI binding failed");
  return true;
}

export function normalizeClerkSecretKey(value, label = "Clerk secret key") {
  if (typeof value !== "string" || value !== value.trim() || !SECRET_KEY.test(value)) {
    throw new Error(`${label} is not an exact production Clerk secret key`);
  }
  return value;
}

export function normalizeClerkInstance(payload) {
  if (
    payload?.id !== EXPECTED_INSTANCE.id
    || payload.environment_type !== EXPECTED_INSTANCE.environmentType
  ) throw new Error("Clerk key reaches an unreviewed instance");
  return Object.freeze({
    id: payload.id,
    environmentType: payload.environment_type,
  });
}

async function clerkFetch(key, route) {
  normalizeClerkSecretKey(key);
  const response = await fetch(`https://api.clerk.com${route}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = new Error(`Clerk request rejected with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function clerkIdentity(key) {
  return normalizeClerkInstance(await clerkFetch(key, "/v1/instance"));
}

export function normalizeRejectedKeyStatus(status) {
  if (![401, 403].includes(status)) {
    throw new Error("superseded Clerk key did not return authentication rejection");
  }
  return true;
}

async function expectOldRejected(key) {
  try {
    await clerkIdentity(key);
  } catch (error) {
    return normalizeRejectedKeyStatus(error?.status);
  }
  throw new Error("superseded Clerk key still authenticates");
}

function vercelApi(route, { method, body } = {}) {
  const args = [VERCEL_CLI, "api", route, "--raw", "--scope", PROJECT.scope, "--no-color"];
  if (method) args.push("--method", method);
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

export function normalizeSharedEnvironmentInventory(payload, { deleted = false } = {}) {
  if (
    !Array.isArray(payload?.data)
    || payload.pagination?.next !== null
    || payload.pagination?.count !== payload.data.length
  ) throw new Error("Vercel shared environment inventory is incomplete");
  const rows = payload.data.filter((row) => (
    row?.key === SHARED_ENVIRONMENT.key || row?.key === "CLERK_SECRET_KEY_PREVIOUS"
  ));
  if (deleted) {
    if (rows.length !== 0) throw new Error("compromised shared Clerk row remains");
    return Object.freeze({ deleted: true });
  }
  const row = rows[0];
  if (
    rows.length !== 1
    || row.id !== SHARED_ENVIRONMENT.id
    || row.type !== SHARED_ENVIRONMENT.type
    || row.ownerId !== SHARED_ENVIRONMENT.ownerId
    || JSON.stringify(row.projectId) !== JSON.stringify(SHARED_ENVIRONMENT.projectId)
    || JSON.stringify(row.target) !== JSON.stringify(SHARED_ENVIRONMENT.target)
    || (row.gitBranch ?? null) !== null
    || (row.deletedAt ?? null) !== null
    || Object.hasOwn(row, "value")
  ) throw new Error("Vercel shared Clerk environment metadata drifted");
  return Object.freeze({ id: row.id, updatedAt: row.updatedAt });
}

export function normalizeSharedSecretHash(payload) {
  if (
    payload?.id !== SHARED_ENVIRONMENT.id
    || payload.key !== SHARED_ENVIRONMENT.key
    || payload.type !== SHARED_ENVIRONMENT.type
    || payload.ownerId !== SHARED_ENVIRONMENT.ownerId
    || payload.decrypted !== true
    || JSON.stringify(payload.projectId) !== JSON.stringify(SHARED_ENVIRONMENT.projectId)
    || JSON.stringify(payload.target) !== JSON.stringify(SHARED_ENVIRONMENT.target)
    || (payload.deletedAt ?? null) !== null
    || typeof payload.value !== "string"
  ) throw new Error("Vercel shared Clerk value response drifted");
  return sha256(normalizeClerkSecretKey(payload.value, "Vercel Clerk key"));
}

function sharedEnvironmentHash() {
  normalizeSharedEnvironmentInventory(vercelApi("/v1/env"));
  return normalizeSharedSecretHash(vercelApi(`/v1/env/${SHARED_ENVIRONMENT.id}`));
}

function projectEnvironmentPayload() {
  return vercelApi(`/v10/projects/${PROJECT.id}/env?decrypt=false`);
}

export function normalizeProjectEnvironmentInventory(payload, expectedId = null) {
  if (!Array.isArray(payload?.envs)) {
    throw new Error("Vercel project environment inventory is incomplete");
  }
  const rows = payload.envs.filter((row) => (
    row?.key === SHARED_ENVIRONMENT.key || row?.key === "CLERK_SECRET_KEY_PREVIOUS"
  ));
  if (expectedId === null) {
    if (rows.length !== 0) throw new Error("project-local Clerk environment shadow exists");
    return Object.freeze({ state: "absent" });
  }
  const row = rows[0];
  if (
    rows.length !== 1
    || row.id !== expectedId
    || !ENVIRONMENT_ID.test(row.id)
    || row.key !== SHARED_ENVIRONMENT.key
    || row.type !== "sensitive"
    || JSON.stringify(row.target) !== JSON.stringify(["production"])
    || (row.gitBranch ?? null) !== null
    || row.comment !== RUNTIME_ENVIRONMENT_COMMENT
    || (row.decrypted ?? false) !== false
    || Object.hasOwn(row, "value")
  ) throw new Error("project-local Clerk runtime environment drifted");
  return Object.freeze({ state: "runtime-only", id: row.id });
}

function createProjectRuntimeEnvironment(key, recoveryCreatedAt) {
  let inventory = projectEnvironmentPayload();
  const existing = inventory.envs?.filter((row) => row?.key === SHARED_ENVIRONMENT.key) ?? [];
  let id = null;
  if (existing.length === 0) {
    const response = vercelApi(`/v10/projects/${PROJECT.id}/env`, {
      method: "POST",
      body: {
        key: SHARED_ENVIRONMENT.key,
        value: key,
        type: "sensitive",
        target: ["production"],
        comment: RUNTIME_ENVIRONMENT_COMMENT,
      },
    });
    inventory = projectEnvironmentPayload();
    const created = inventory.envs?.filter((row) => row?.key === SHARED_ENVIRONMENT.key) ?? [];
    if (created.length !== 1) {
      throw new Error("Vercel Clerk runtime environment creation was ambiguous");
    }
    id = created[0].id;
    const responseId = response?.created?.id ?? response?.id ?? response?.envs?.[0]?.id ?? id;
    if (responseId !== id) throw new Error("Vercel Clerk runtime environment identity drifted");
  } else if (existing.length === 1) {
    id = existing[0]?.id;
    const createdAt = typeof existing[0]?.createdAt === "string"
      ? Date.parse(existing[0].createdAt)
      : existing[0]?.createdAt;
    if (
      !Number.isFinite(createdAt)
      || createdAt < Date.parse(recoveryCreatedAt)
    ) throw new Error("pre-existing project-local Clerk environment is not recoverable");
  }
  if (!ENVIRONMENT_ID.test(id ?? "")) {
    throw new Error("Vercel Clerk runtime environment creation was ambiguous");
  }
  normalizeProjectEnvironmentInventory(inventory, id);
  return id;
}

function deleteSharedEnvironment() {
  const before = vercelApi("/v1/env");
  const matches = before.data?.filter((row) => (
    row?.key === SHARED_ENVIRONMENT.key || row?.key === "CLERK_SECRET_KEY_PREVIOUS"
  )) ?? [];
  if (matches.length === 0) {
    normalizeSharedEnvironmentInventory(before, { deleted: true });
    return;
  }
  normalizeSharedEnvironmentInventory(before);
  vercelApi("/v1/env", { method: "DELETE", body: { ids: [SHARED_ENVIRONMENT.id] } });
  normalizeSharedEnvironmentInventory(vercelApi("/v1/env"), { deleted: true });
}

function githubSecretMetadata() {
  const rows = run(
    "gh",
    ["secret", "list", "--repo", REPOSITORY, "--json", "name,updatedAt"],
    { json: true },
  );
  const exact = rows.filter((row) => row?.name === SHARED_ENVIRONMENT.key);
  if (exact.length !== 1 || !Number.isFinite(Date.parse(exact[0].updatedAt))) {
    throw new Error("GitHub Clerk secret metadata drifted");
  }
  return Object.freeze({ updatedAt: exact[0].updatedAt });
}

function updateGithubSecret(value) {
  run("gh", ["secret", "set", SHARED_ENVIRONMENT.key, "--repo", REPOSITORY], {
    input: `${value}\n`,
  });
}

async function waitForGithubMetadataAfter(timestamp) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = githubSecretMetadata();
    if (Date.parse(current.updatedAt) > Date.parse(timestamp)) return current;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("GitHub Clerk secret timestamp did not advance");
}

function readLocal() {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  if (
    (source.match(/^CLERK_SECRET_KEY=.*$/gm) ?? []).length !== 1
    || (source.match(/^CLERK_SECRET_KEY_PREVIOUS=.*$/gm) ?? []).length !== 0
  ) throw new Error("local Clerk environment shape drifted");
  return dotenv.parse(source);
}

function setLocalKey(value) {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  if (
    (source.match(/^CLERK_SECRET_KEY=.*$/gm) ?? []).length !== 1
    || (source.match(/^CLERK_SECRET_KEY_PREVIOUS=.*$/gm) ?? []).length !== 0
  ) throw new Error("local Clerk environment shape drifted");
  writePrivate(
    LOCAL_ENV,
    source.replace(/^CLERK_SECRET_KEY=.*$/m, `CLERK_SECRET_KEY=${value}`),
    { replace: true },
  );
  if (readLocal().CLERK_SECRET_KEY !== value) throw new Error("local Clerk key did not converge");
}

function readShippoEvidence() {
  assertPrivateFile(SHIPPO_EVIDENCE, "accepted Shippo recovery evidence");
  const raw = readFileSync(SHIPPO_EVIDENCE, "utf8");
  const value = JSON.parse(raw);
  if (
    sha256(raw) !== SHIPPO_EVIDENCE_SHA256
    || value?.operation !== "shippo-api-credential-exposure-recovery"
    || value.status !== "passed"
    || value.acceptanceEligible !== true
    || value.secretsRetained !== false
  ) throw new Error("accepted Shippo recovery evidence drifted");
  return true;
}

function readDeployment(idOrUrl) {
  const payload = vercelApi(`/v13/deployments/${idOrUrl}`);
  return Object.freeze({
    id: payload.id,
    url: payload.url,
    projectId: payload.projectId,
    readyState: payload.readyState,
    target: payload.target,
    createdAt: payload.createdAt,
    source: payload.source,
    sourceCommit: payload.meta?.gitCommitSha,
    sourceRef: payload.meta?.gitCommitRef,
    marker: payload.meta?.grainlineClerkServerKeyRecovery,
  });
}

function exactCurrentDeployment(value) {
  if (
    value?.id !== CURRENT_DEPLOYMENT.id
    || value.url !== CURRENT_DEPLOYMENT.url
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.createdAt !== CURRENT_DEPLOYMENT.createdAt
    || value.sourceCommit !== CURRENT_DEPLOYMENT.sourceCommit
  ) throw new Error("current Clerk predecessor deployment drifted");
  return true;
}

function deploymentMarker(createdAt) {
  return sha256(`grainline-clerk-server-key-recovery:${createdAt}`).slice(0, 32);
}

export function normalizeCandidateDeployment(value, createdAt) {
  if (
    !DEPLOYMENT.test(value?.id ?? "")
    || typeof value.url !== "string"
    || !value.url.endsWith(".vercel.app")
    || value.projectId !== PROJECT.id
    || value.readyState !== "READY"
    || value.target !== "production"
    || value.source !== "cli"
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceRef !== "main"
    || value.marker !== deploymentMarker(createdAt)
    || value.id === CURRENT_DEPLOYMENT.id
  ) throw new Error("Clerk replacement deployment drifted");
  return Object.freeze({ id: value.id, url: value.url, createdAt: value.createdAt });
}

function deploymentInventoryPayload() {
  return vercelApi(
    `/v6/deployments?projectId=${PROJECT.id}&target=production&limit=100&since=${CURRENT_DEPLOYMENT.createdAt}`,
  );
}

export function normalizeDeploymentInventory(payload, candidate = null, predecessorRemoved = false) {
  if (
    !Array.isArray(payload?.deployments)
    || payload.pagination?.next !== null
    || payload.pagination?.count !== payload.deployments.length
  ) throw new Error("Vercel Clerk deployment inventory is incomplete");
  const expected = [];
  if (!predecessorRemoved) expected.push(CURRENT_DEPLOYMENT);
  if (candidate) expected.push(candidate);
  const rows = payload.deployments.map((row) => ({
    id: row.id ?? row.uid,
    url: row.url,
    createdAt: row.createdAt ?? row.created,
    readyState: row.readyState,
    target: row.target,
    sourceCommit: row.meta?.gitCommitSha,
  }));
  if (rows.length !== expected.length) throw new Error("Vercel Clerk deployment count drifted");
  for (const item of expected) {
    const row = rows.find((entry) => entry.id === item.id);
    if (
      !row
      || row.url !== item.url
      || row.createdAt !== item.createdAt
      || row.readyState !== "READY"
      || row.target !== "production"
      || row.sourceCommit !== item.sourceCommit
    ) throw new Error("Vercel Clerk deployment identity drifted");
  }
  if (rows.some((row) => !expected.some((item) => item.id === row.id))) {
    throw new Error("unreviewed deployment entered the Clerk credential epoch");
  }
  return Object.freeze({ count: rows.length, ids: Object.freeze(rows.map((row) => row.id).sort()) });
}

export function classifyDeploymentInventory(payload, candidate) {
  try {
    normalizeDeploymentInventory(payload, candidate, false);
    return "current-and-candidate";
  } catch (withPredecessorError) {
    try {
      normalizeDeploymentInventory(payload, candidate, true);
      return "candidate-only";
    } catch {
      throw withPredecessorError;
    }
  }
}

function aliasTargets() {
  return CANONICAL_ALIASES.map((alias) => Object.freeze({ alias, deployment: readDeployment(alias) }));
}

export function normalizeAliasPosition(targets, currentId, candidateId = null) {
  if (
    !Array.isArray(targets)
    || targets.length !== CANONICAL_ALIASES.length
    || targets.some((row, index) => (
      row?.alias !== CANONICAL_ALIASES[index]
      || row.deployment?.projectId !== PROJECT.id
      || row.deployment.readyState !== "READY"
      || row.deployment.target !== "production"
      || ![currentId, candidateId].filter(Boolean).includes(row.deployment.id)
    ))
  ) throw new Error("canonical Clerk recovery alias state drifted");
  const ids = [...new Set(targets.map((row) => row.deployment.id))];
  if (ids.length > 1) return "mixed";
  if (ids[0] === currentId) return "current";
  if (candidateId !== null && ids[0] === candidateId) return "candidate";
  throw new Error("canonical aliases target an unreviewed deployment");
}

async function canonicalHealth() {
  const response = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (response.status !== 200 || body?.ok !== true || Object.keys(body).length !== 1) {
    throw new Error("canonical production health check failed");
  }
  return response.status;
}

function findCandidateId(state) {
  const payload = deploymentInventoryPayload();
  const marker = deploymentMarker(state.createdAt);
  const rows = payload.deployments.filter((row) => (
    row?.target === "production"
    && row.meta?.gitCommitSha === SOURCE_COMMIT
    && row.meta?.gitCommitRef === "main"
    && row.meta?.grainlineClerkServerKeyRecovery === marker
  ));
  if (rows.length > 1) throw new Error("Clerk replacement deployment is ambiguous");
  return rows.length === 0 ? null : (rows[0].id ?? rows[0].uid);
}

async function waitForCandidate(id, createdAt) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const deployment = readDeployment(id);
    if (deployment.readyState === "READY") return normalizeCandidateDeployment(deployment, createdAt);
    if (["ERROR", "CANCELED"].includes(deployment.readyState)) {
      throw new Error("Clerk replacement deployment entered a terminal state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Clerk replacement deployment did not become ready in time");
}

async function deployCandidate(state) {
  const existing = findCandidateId(state);
  if (existing) return waitForCandidate(existing, state.createdAt);
  normalizeDeploymentInventory(deploymentInventoryPayload());
  const output = run(process.execPath, [
    VERCEL_CLI,
    "deploy",
    DEPLOY_SOURCE,
    "--prod",
    "--skip-domain",
    "--force",
    "--yes",
    "--project",
    PROJECT.name,
    "--scope",
    PROJECT.scope,
    "--meta",
    `gitCommitSha=${SOURCE_COMMIT}`,
    "--meta",
    "gitCommitRef=main",
    "--meta",
    `grainlineClerkServerKeyRecovery=${deploymentMarker(state.createdAt)}`,
    "--no-color",
  ], { cwd: DEPLOY_SOURCE, timeout: 15 * 60_000 });
  const url = output.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line));
  if (!url) throw new Error("Clerk replacement deployment URL was not returned");
  return waitForCandidate(readDeployment(new URL(url).hostname).id, state.createdAt);
}

function promoteCandidate(state) {
  const position = normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId);
  if (position !== "candidate") {
    run(process.execPath, [
      VERCEL_CLI,
      "promote",
      state.candidateDeploymentUrl,
      "--scope",
      PROJECT.scope,
      "--yes",
      "--no-color",
    ], { timeout: 5 * 60_000 });
  }
  assert.equal(
    normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId),
    "candidate",
  );
}

function removePredecessor() {
  exactCurrentDeployment(readDeployment(CURRENT_DEPLOYMENT.id));
  run(process.execPath, [
    VERCEL_CLI,
    "remove",
    CURRENT_DEPLOYMENT.id,
    "--yes",
    "--scope",
    PROJECT.scope,
    "--no-color",
  ]);
}

function readClipboardKey() {
  const result = spawnSync("/usr/bin/pbpaste", [], {
    env: safeEnvironment(),
    encoding: "utf8",
    maxBuffer: 8 * 1024,
  });
  try {
    if (result.error || result.status !== 0) throw new Error("clipboard read failed");
    return normalizeClerkSecretKey(result.stdout, "clipboard Clerk key");
  } finally {
    const cleared = spawnSync("/usr/bin/pbcopy", [], {
      env: safeEnvironment(),
      input: "",
      encoding: "utf8",
    });
    if (cleared.error || cleared.status !== 0) {
      throw new Error("clipboard could not be cleared after Clerk key capture");
    }
  }
}

async function waitForDrain(promotedAt) {
  const deadline = Date.parse(promotedAt) + MAX_REQUEST_DRAIN_MS;
  if (!Number.isFinite(deadline)) throw new Error("Clerk drain deadline is invalid");
  let remaining = deadline - Date.now();
  while (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 30_000)));
    remaining = deadline - Date.now();
  }
  return Math.max(0, Math.floor((Date.now() - Date.parse(promotedAt)) / 1000));
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("runtime witness response was too large");
  return value;
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) throw new Error("Clerk cookie response drifted");
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (separator <= 0 || !/^[A-Za-z0-9_]+$/.test(name) || !content || content.length > 8_192) {
      throw new Error("Clerk returned an invalid cookie shape");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) throw new Error("Clerk cookie jar drifted");
  return value;
}

async function selectCanary(clerk) {
  const users = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (users.totalCount !== 1 || users.data.length !== 1) {
    throw new Error("expected exactly one retained operational canary");
  }
  const user = users.data[0];
  if (
    user.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || user.banned
    || user.locked
    || user.publicMetadata?.grainlineOperationalCanary !== CANARY_PURPOSE
  ) throw new Error("operational canary identity drifted");
  return user;
}

async function revokeActiveCanarySessions(clerk, userId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId });
  if (active.totalCount !== active.data.length || active.data.length > 4) {
    throw new Error("operational canary session inventory drifted");
  }
  for (const session of active.data) {
    if (!SESSION_ID.test(session.id)) throw new Error("operational canary session identity drifted");
    const revoked = await clerk.sessions.revokeSession(session.id);
    if (revoked?.id !== session.id || revoked.status !== "revoked") {
      throw new Error("operational canary session revoke failed");
    }
  }
  const after = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId });
  if (after.totalCount !== 0 || after.data.length !== 0) {
    throw new Error("operational canary sessions remained after cleanup");
  }
  return active.data.length;
}

async function createCanarySession(clerk, userId) {
  const signInToken = await clerk.signInTokens.createSignInToken({
    expiresInSeconds: 60,
    userId,
  });
  if (
    !SIGN_IN_TOKEN_ID.test(signInToken?.id ?? "")
    || signInToken.userId !== userId
    || typeof signInToken.token !== "string"
    || signInToken.token.length < 32
    || signInToken.token.length > 4_096
  ) throw new Error("Clerk did not create the bounded sign-in token");

  const jar = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: PRODUCTION_ORIGIN },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = JSON.parse(await boundedText(clientResponse, 128 * 1024));
  if (clientResponse.status !== 200 || (clientPayload.response ?? clientPayload).object !== "client") {
    throw new Error("Clerk client handshake failed");
  }
  const exchange = await fetch(`https://${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: clerkCookieHeader(jar),
      origin: PRODUCTION_ORIGIN,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchange, jar);
  const payload = JSON.parse(await boundedText(exchange, 128 * 1024));
  const attempt = payload.response ?? payload;
  if (
    exchange.status !== 200
    || attempt.object !== "sign_in_attempt"
    || attempt.status !== "complete"
    || !SESSION_ID.test(attempt.created_session_id ?? "")
  ) throw new Error("Clerk sign-in token exchange failed");
  const token = await clerk.sessions.getToken(attempt.created_session_id, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Clerk session token shape drifted");
  }
  return Object.freeze({
    jwt: token.jwt,
    sessionId: attempt.created_session_id,
    signInTokenId: signInToken.id,
  });
}

async function runtimeWitness(operationsKey) {
  const clerk = createClerkClient({ secretKey: operationsKey });
  const canary = await selectCanary(clerk);
  await revokeActiveCanarySessions(clerk, canary.id);
  const session = await createCanarySession(clerk, canary.id);
  try {
    const account = await fetch(`${PRODUCTION_ORIGIN}/account`, {
      headers: {
        Authorization: `Bearer ${session.jwt}`,
        Cookie: `__session=${session.jwt}`,
        "cache-control": "no-store",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const accountBody = await boundedText(account, 2 * 1024 * 1024);
    if (account.status !== 200 || !account.headers.get("content-type")?.startsWith("text/html") || accountBody === "") {
      throw new Error("deployed Clerk runtime account witness failed");
    }
    return Object.freeze({ accountStatus: account.status });
  } finally {
    await revokeActiveCanarySessions(clerk, canary.id);
  }
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateState(value, expectedOldKeySha256 = OLD_KEY_SHA256) {
  if (
    !exactKeys(value, [
      "schemaVersion", "operation", "stage", "operatorCommit", "operatorCiRunId",
      "sourceCommit", "sourceCiRunId", "createdAt", "updatedAt", "oldKey",
      "oldKeySha256", "runtimeKey", "runtimeKeySha256", "operationsKey",
      "operationsKeySha256", "providerInstanceId", "githubUpdatedAtBefore",
      "githubUpdatedAt", "projectEnvironmentId", "candidateDeploymentId",
      "candidateDeploymentUrl", "promotedAt", "runtimeProofCount",
      "predecessorRemoved", "sharedEnvironmentDeleted",
    ])
    || value.schemaVersion !== 1
    || value.operation !== "clerk-server-key-credential-exposure-recovery"
    || !STAGES.includes(value.stage)
    || !COMMIT.test(value.operatorCommit ?? "")
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceCiRunId !== SOURCE_CI_RUN_ID
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.updatedAt))
    || sha256(normalizeClerkSecretKey(value.oldKey, "journal predecessor Clerk key")) !== value.oldKeySha256
    || value.oldKeySha256 !== expectedOldKeySha256
    || value.providerInstanceId !== EXPECTED_INSTANCE.id
    || !Number.isFinite(Date.parse(value.githubUpdatedAtBefore))
    || !Number.isSafeInteger(value.runtimeProofCount)
    || value.runtimeProofCount < 0
    || value.runtimeProofCount > 2
    || typeof value.predecessorRemoved !== "boolean"
    || typeof value.sharedEnvironmentDeleted !== "boolean"
  ) throw new Error("private Clerk recovery journal drifted");

  const runtimeRequired = STAGES.indexOf(value.stage) >= STAGES.indexOf("provider-operations-create-required");
  const operationsRequired = STAGES.indexOf(value.stage) >= STAGES.indexOf("operations-captured");
  if (
    (runtimeRequired && (
      sha256(normalizeClerkSecretKey(value.runtimeKey, "journal runtime Clerk key")) !== value.runtimeKeySha256
      || value.runtimeKeySha256 === value.oldKeySha256
    ))
    || (!runtimeRequired && (value.runtimeKey !== null || value.runtimeKeySha256 !== null))
    || (operationsRequired && (
      sha256(normalizeClerkSecretKey(value.operationsKey, "journal operations Clerk key"))
        !== value.operationsKeySha256
      || value.operationsKeySha256 === value.oldKeySha256
      || value.operationsKeySha256 === value.runtimeKeySha256
    ))
    || (!operationsRequired && (value.operationsKey !== null || value.operationsKeySha256 !== null))
  ) throw new Error("private Clerk replacement-key state drifted");

  if (
    (value.projectEnvironmentId !== null && !ENVIRONMENT_ID.test(value.projectEnvironmentId))
    || (value.candidateDeploymentId !== null && !DEPLOYMENT.test(value.candidateDeploymentId))
    || (value.candidateDeploymentUrl !== null
      && (typeof value.candidateDeploymentUrl !== "string" || !value.candidateDeploymentUrl.endsWith(".vercel.app")))
    || (value.promotedAt !== null && !Number.isFinite(Date.parse(value.promotedAt)))
    || (value.githubUpdatedAt !== null && !Number.isFinite(Date.parse(value.githubUpdatedAt)))
  ) throw new Error("private Clerk provider state drifted");

  const stageIndex = STAGES.indexOf(value.stage);
  const requiresProjectEnvironment = stageIndex >= STAGES.indexOf("vercel-runtime-created");
  const requiresGithubUpdate = stageIndex >= STAGES.indexOf("github-operations-updated");
  const requiresCandidate = stageIndex >= STAGES.indexOf("candidate-ready");
  const requiresPromotion = stageIndex >= STAGES.indexOf("promoted");
  const requiresRuntimeProof = stageIndex >= STAGES.indexOf("runtime-proven");
  const requiresPredecessorRemoval = stageIndex >= STAGES.indexOf("predecessor-removed");
  const requiresSharedDeletion = stageIndex >= STAGES.indexOf("shared-row-deleted");
  if (
    requiresProjectEnvironment !== (value.projectEnvironmentId !== null)
    || requiresGithubUpdate !== (value.githubUpdatedAt !== null)
    || requiresCandidate !== (
      value.candidateDeploymentId !== null && value.candidateDeploymentUrl !== null
    )
    || requiresPromotion !== (value.promotedAt !== null)
    || requiresRuntimeProof !== (value.runtimeProofCount > 0)
    || requiresPredecessorRemoval !== value.predecessorRemoved
    || requiresSharedDeletion !== value.sharedEnvironmentDeleted
  ) throw new Error("private Clerk recovery stage is inconsistent");

  return Object.freeze(value);
}

function createState(config, oldKey, github) {
  const now = new Date().toISOString();
  const value = {
    schemaVersion: 1,
    operation: "clerk-server-key-credential-exposure-recovery",
    stage: "provider-runtime-create-required",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    createdAt: now,
    updatedAt: now,
    oldKey,
    oldKeySha256: sha256(oldKey),
    runtimeKey: null,
    runtimeKeySha256: null,
    operationsKey: null,
    operationsKeySha256: null,
    providerInstanceId: EXPECTED_INSTANCE.id,
    githubUpdatedAtBefore: github.updatedAt,
    githubUpdatedAt: null,
    projectEnvironmentId: null,
    candidateDeploymentId: null,
    candidateDeploymentUrl: null,
    promotedAt: null,
    runtimeProofCount: 0,
    predecessorRemoved: false,
    sharedEnvironmentDeleted: false,
  };
  validateState(value);
  writePrivate(JOURNAL, `${JSON.stringify(value, null, 2)}\n`);
  return Object.freeze(value);
}

function stateFromDisk() {
  assertPrivateFile(JOURNAL, "private Clerk recovery journal");
  return validateState(JSON.parse(readFileSync(JOURNAL, "utf8")));
}

function writeState(state, stage, patch = {}) {
  const next = validateState({
    ...state,
    ...patch,
    stage,
    updatedAt: new Date().toISOString(),
  });
  writePrivate(JOURNAL, `${JSON.stringify(next, null, 2)}\n`, { replace: true });
  return next;
}

export function sanitizedEvidence(config, state, witness, drainSeconds) {
  if (
    witness?.accountStatus !== 200
    || state.runtimeProofCount !== 2
    || state.predecessorRemoved !== true
    || state.sharedEnvironmentDeleted !== true
    || drainSeconds < MAX_REQUEST_DRAIN_MS / 1000
  ) throw new Error("Clerk accepted evidence inputs drifted");
  return Object.freeze({
    schemaVersion: 1,
    operation: "clerk-server-key-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    generatedAt: new Date().toISOString(),
    operator: Object.freeze({ commit: config.operatorCommit, ciRunId: config.operatorCiRunId }),
    application: Object.freeze({ sourceCommit: SOURCE_COMMIT, sourceCiRunId: SOURCE_CI_RUN_ID }),
    provider: Object.freeze({
      instanceId: EXPECTED_INSTANCE.id,
      environmentType: EXPECTED_INSTANCE.environmentType,
      runtimeKeyName: RUNTIME_KEY_NAME,
      operationsKeyName: OPERATIONS_KEY_NAME,
      predecessorKeySha256: state.oldKeySha256,
      runtimeKeySha256: state.runtimeKeySha256,
      operationsKeySha256: state.operationsKeySha256,
      predecessorRejected: true,
      replacementsAuthenticated: true,
    }),
    consumers: Object.freeze({
      deletedSharedEnvironmentId: SHARED_ENVIRONMENT.id,
      productionRuntimeEnvironmentId: state.projectEnvironmentId,
      runtimeTarget: "production",
      runtimeSensitive: true,
      previewCredentialPresent: false,
      developmentCredentialPresent: false,
      githubRepositorySecretUpdated: true,
      localUpdated: true,
    }),
    deployment: Object.freeze({
      replacementId: state.candidateDeploymentId,
      removedPredecessorId: CURRENT_DEPLOYMENT.id,
      sourceCommit: SOURCE_COMMIT,
      drainSeconds,
      canonicalAliasCount: CANONICAL_ALIASES.length,
      healthStatus: 200,
    }),
    runtimeProof: Object.freeze({
      count: state.runtimeProofCount,
      accountStatus: witness.accountStatus,
      temporarySessionsRemaining: 0,
    }),
    migrationsRun: false,
    rlsChanged: false,
    clerkWebhookChanged: false,
    ordinaryUsersChanged: false,
    secretsRetained: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  const serialized = JSON.stringify(value);
  if (
    !exactKeys(value, [
      "schemaVersion", "operation", "status", "acceptanceEligible", "issueCount", "generatedAt",
      "operator", "application", "provider", "consumers", "deployment", "runtimeProof",
      "migrationsRun", "rlsChanged", "clerkWebhookChanged", "ordinaryUsersChanged", "secretsRetained",
    ])
    || !exactKeys(value.operator, ["commit", "ciRunId"])
    || !exactKeys(value.application, ["sourceCommit", "sourceCiRunId"])
    || !exactKeys(value.provider, [
      "instanceId", "environmentType", "runtimeKeyName", "operationsKeyName",
      "predecessorKeySha256", "runtimeKeySha256", "operationsKeySha256",
      "predecessorRejected", "replacementsAuthenticated",
    ])
    || !exactKeys(value.consumers, [
      "deletedSharedEnvironmentId", "productionRuntimeEnvironmentId", "runtimeTarget",
      "runtimeSensitive", "previewCredentialPresent", "developmentCredentialPresent",
      "githubRepositorySecretUpdated", "localUpdated",
    ])
    || !exactKeys(value.deployment, [
      "replacementId", "removedPredecessorId", "sourceCommit", "drainSeconds",
      "canonicalAliasCount", "healthStatus",
    ])
    || !exactKeys(value.runtimeProof, [
      "count", "accountStatus", "temporarySessionsRemaining",
    ])
    || value.schemaVersion !== 1
    || value.operation !== "clerk-server-key-credential-exposure-recovery"
    || value.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || !Number.isFinite(Date.parse(value.generatedAt))
    || value.operator?.commit !== config.operatorCommit
    || value.operator.ciRunId !== config.operatorCiRunId
    || value.application?.sourceCommit !== SOURCE_COMMIT
    || value.application.sourceCiRunId !== SOURCE_CI_RUN_ID
    || value.provider?.instanceId !== EXPECTED_INSTANCE.id
    || value.provider.environmentType !== EXPECTED_INSTANCE.environmentType
    || value.provider.runtimeKeyName !== RUNTIME_KEY_NAME
    || value.provider.operationsKeyName !== OPERATIONS_KEY_NAME
    || value.provider.predecessorKeySha256 !== OLD_KEY_SHA256
    || !SHA256.test(value.provider.runtimeKeySha256 ?? "")
    || !SHA256.test(value.provider.operationsKeySha256 ?? "")
    || new Set([
      value.provider.predecessorKeySha256,
      value.provider.runtimeKeySha256,
      value.provider.operationsKeySha256,
    ]).size !== 3
    || value.provider.predecessorRejected !== true
    || value.provider.replacementsAuthenticated !== true
    || value.consumers?.deletedSharedEnvironmentId !== SHARED_ENVIRONMENT.id
    || !ENVIRONMENT_ID.test(value.consumers.productionRuntimeEnvironmentId ?? "")
    || value.consumers.runtimeTarget !== "production"
    || value.consumers.runtimeSensitive !== true
    || value.consumers.previewCredentialPresent !== false
    || value.consumers.developmentCredentialPresent !== false
    || value.consumers.githubRepositorySecretUpdated !== true
    || value.consumers.localUpdated !== true
    || !DEPLOYMENT.test(value.deployment?.replacementId ?? "")
    || value.deployment.removedPredecessorId !== CURRENT_DEPLOYMENT.id
    || value.deployment.sourceCommit !== SOURCE_COMMIT
    || !Number.isSafeInteger(value.deployment.drainSeconds)
    || value.deployment.drainSeconds < MAX_REQUEST_DRAIN_MS / 1000
    || value.deployment.canonicalAliasCount !== CANONICAL_ALIASES.length
    || value.deployment.healthStatus !== 200
    || value.runtimeProof?.count !== 2
    || value.runtimeProof.accountStatus !== 200
    || value.runtimeProof.temporarySessionsRemaining !== 0
    || value.migrationsRun !== false
    || value.rlsChanged !== false
    || value.clerkWebhookChanged !== false
    || value.ordinaryUsersChanged !== false
    || value.secretsRetained !== false
    || /sk_live_|__session|user_[A-Za-z0-9]+|sess_[A-Za-z0-9]+|sit_[A-Za-z0-9]+/.test(serialized)
  ) throw new Error("accepted Clerk credential evidence drifted");
  return Object.freeze(value);
}

function parseArguments(args) {
  const value = {
    captureRuntimeFromClipboard: false,
    captureOperationsFromClipboard: false,
    confirmPredecessorDeleted: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--operator-commit") value.operatorCommit = args[++index];
    else if (arg === "--operator-ci-run") value.operatorCiRunId = Number(args[++index]);
    else if (arg === "--capture-runtime-from-clipboard") value.captureRuntimeFromClipboard = true;
    else if (arg === "--capture-operations-from-clipboard") value.captureOperationsFromClipboard = true;
    else if (arg === "--confirm-predecessor-deleted") value.confirmPredecessorDeleted = true;
    else throw new Error(`unknown Clerk credential recovery argument: ${arg}`);
  }
  if (!COMMIT.test(value.operatorCommit ?? "") || !Number.isSafeInteger(value.operatorCiRunId)) {
    throw new Error("Clerk recovery requires an exact operator commit and CI run");
  }
  const boundaries = [
    value.captureRuntimeFromClipboard,
    value.captureOperationsFromClipboard,
    value.confirmPredecessorDeleted,
  ].filter(Boolean).length;
  if (boundaries > 1) throw new Error("Clerk capture and revocation boundaries are separate");
  return Object.freeze(value);
}

export async function runRecovery(config) {
  if (run(process.execPath, [VERCEL_CLI, "--version"]) !== "59.11.2") {
    throw new Error("reviewed Vercel CLI version drifted");
  }
  assertExactGitState(gitState(OPERATOR_ROOT), config.operatorCommit);
  assertExactGitState(gitState(DEPLOY_SOURCE), SOURCE_COMMIT);
  githubRun(config.operatorCiRunId, config.operatorCommit);
  githubRun(SOURCE_CI_RUN_ID, SOURCE_COMMIT);
  readShippoEvidence();

  if (existsSync(EVIDENCE)) {
    assertPrivateFile(EVIDENCE, "accepted Clerk recovery evidence");
    const value = validateAcceptedEvidence(JSON.parse(readFileSync(EVIDENCE, "utf8")), config);
    if (existsSync(JOURNAL)) {
      const completed = stateFromDisk();
      if (
        completed.operatorCommit !== config.operatorCommit
        || completed.operatorCiRunId !== config.operatorCiRunId
        || completed.stage !== "provider-revocation-required"
        || completed.runtimeProofCount !== 2
        || completed.oldKeySha256 !== value.provider.predecessorKeySha256
        || completed.runtimeKeySha256 !== value.provider.runtimeKeySha256
        || completed.operationsKeySha256 !== value.provider.operationsKeySha256
        || completed.projectEnvironmentId !== value.consumers.productionRuntimeEnvironmentId
        || completed.candidateDeploymentId !== value.deployment.replacementId
      ) throw new Error("accepted Clerk evidence does not match its retained journal");
      await expectOldRejected(completed.oldKey);
      await Promise.all([clerkIdentity(completed.runtimeKey), clerkIdentity(completed.operationsKey)]);
      normalizeSharedEnvironmentInventory(vercelApi("/v1/env"), { deleted: true });
      normalizeProjectEnvironmentInventory(projectEnvironmentPayload(), completed.projectEnvironmentId);
      if (sha256(normalizeClerkSecretKey(readLocal().CLERK_SECRET_KEY)) !== completed.operationsKeySha256) {
        throw new Error("completed local Clerk consumer drifted");
      }
      const candidate = normalizeCandidateDeployment(
        readDeployment(completed.candidateDeploymentId),
        completed.createdAt,
      );
      normalizeDeploymentInventory(deploymentInventoryPayload(), {
        id: candidate.id,
        url: candidate.url,
        createdAt: candidate.createdAt,
        sourceCommit: SOURCE_COMMIT,
      }, true);
      assert.equal(
        normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, completed.candidateDeploymentId),
        "candidate",
      );
      await canonicalHealth();
      await runtimeWitness(completed.operationsKey);
      removePrivate(JOURNAL);
    }
    return value;
  }

  let state;
  if (existsSync(JOURNAL)) {
    state = stateFromDisk();
    if (state.operatorCommit !== config.operatorCommit || state.operatorCiRunId !== config.operatorCiRunId) {
      throw new Error("private Clerk journal belongs to another operator");
    }
  } else {
    const oldKey = normalizeClerkSecretKey(readLocal().CLERK_SECRET_KEY, "local predecessor Clerk key");
    if (sha256(oldKey) !== OLD_KEY_SHA256 || sharedEnvironmentHash() !== OLD_KEY_SHA256) {
      throw new Error("predecessor Clerk consumer digest drifted");
    }
    normalizeProjectEnvironmentInventory(projectEnvironmentPayload());
    const github = githubSecretMetadata();
    exactCurrentDeployment(readDeployment(CURRENT_DEPLOYMENT.id));
    normalizeDeploymentInventory(deploymentInventoryPayload());
    assert.equal(normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id), "current");
    await canonicalHealth();
    await clerkIdentity(oldKey);
    state = createState(config, oldKey, github);
  }

  if (state.stage === "provider-runtime-create-required") {
    if (!config.captureRuntimeFromClipboard) {
      return Object.freeze({
        status: "provider-runtime-key-create-required",
        keyName: RUNTIME_KEY_NAME,
        captureCommandFlag: "--capture-runtime-from-clipboard",
      });
    }
    const runtimeKey = readClipboardKey();
    const runtimeKeySha256 = sha256(runtimeKey);
    if (runtimeKeySha256 === state.oldKeySha256) throw new Error("clipboard contains predecessor Clerk key");
    await clerkIdentity(runtimeKey);
    state = writeState(state, "provider-operations-create-required", { runtimeKey, runtimeKeySha256 });
  }

  if (state.stage === "provider-operations-create-required") {
    if (!config.captureOperationsFromClipboard) {
      return Object.freeze({
        status: "provider-operations-key-create-required",
        keyName: OPERATIONS_KEY_NAME,
        captureCommandFlag: "--capture-operations-from-clipboard",
      });
    }
    const operationsKey = readClipboardKey();
    const operationsKeySha256 = sha256(operationsKey);
    if ([state.oldKeySha256, state.runtimeKeySha256].includes(operationsKeySha256)) {
      throw new Error("clipboard Clerk key is not a distinct operations key");
    }
    await Promise.all([clerkIdentity(state.oldKey), clerkIdentity(state.runtimeKey), clerkIdentity(operationsKey)]);
    state = writeState(state, "operations-captured", { operationsKey, operationsKeySha256 });
  }

  if (state.stage === "operations-captured") {
    const projectEnvironmentId = createProjectRuntimeEnvironment(state.runtimeKey, state.createdAt);
    state = writeState(state, "vercel-runtime-created", { projectEnvironmentId });
  }
  if (state.stage === "vercel-runtime-created") {
    updateGithubSecret(state.operationsKey);
    const github = await waitForGithubMetadataAfter(state.githubUpdatedAtBefore);
    state = writeState(state, "github-operations-updated", { githubUpdatedAt: github.updatedAt });
  }
  if (state.stage === "github-operations-updated") {
    const localHash = sha256(normalizeClerkSecretKey(readLocal().CLERK_SECRET_KEY, "local Clerk key"));
    if (localHash === state.oldKeySha256) setLocalKey(state.operationsKey);
    else if (localHash !== state.operationsKeySha256) throw new Error("local Clerk key changed outside reviewed pair");
    state = writeState(state, "local-operations-updated");
  }
  if (state.stage === "local-operations-updated") {
    const candidate = await deployCandidate(state);
    state = writeState(state, "candidate-ready", {
      candidateDeploymentId: candidate.id,
      candidateDeploymentUrl: candidate.url,
    });
  }
  if (state.stage === "candidate-ready") {
    const candidate = normalizeCandidateDeployment(readDeployment(state.candidateDeploymentId), state.createdAt);
    normalizeDeploymentInventory(deploymentInventoryPayload(), {
      id: candidate.id,
      url: candidate.url,
      createdAt: candidate.createdAt,
      sourceCommit: SOURCE_COMMIT,
    });
    promoteCandidate(state);
    await canonicalHealth();
    state = writeState(state, "promoted", { promotedAt: new Date().toISOString() });
  }
  if (state.stage === "promoted") {
    await Promise.all([clerkIdentity(state.runtimeKey), clerkIdentity(state.operationsKey)]);
    await runtimeWitness(state.operationsKey);
    state = writeState(state, "runtime-proven", { runtimeProofCount: 1 });
  }
  if (state.stage === "runtime-proven") {
    await waitForDrain(state.promotedAt);
    const candidate = normalizeCandidateDeployment(readDeployment(state.candidateDeploymentId), state.createdAt);
    const expectedCandidate = {
      id: candidate.id,
      url: candidate.url,
      createdAt: candidate.createdAt,
      sourceCommit: SOURCE_COMMIT,
    };
    const inventoryState = classifyDeploymentInventory(
      deploymentInventoryPayload(),
      expectedCandidate,
    );
    if (inventoryState === "current-and-candidate") removePredecessor();
    normalizeDeploymentInventory(deploymentInventoryPayload(), expectedCandidate, true);
    state = writeState(state, "predecessor-removed", { predecessorRemoved: true });
  }
  if (state.stage === "predecessor-removed") {
    if (!state.sharedEnvironmentDeleted) deleteSharedEnvironment();
    normalizeProjectEnvironmentInventory(projectEnvironmentPayload(), state.projectEnvironmentId);
    state = writeState(state, "shared-row-deleted", { sharedEnvironmentDeleted: true });
  }
  if (state.stage === "shared-row-deleted") {
    state = writeState(state, "provider-revocation-required");
  }
  if (state.stage === "provider-revocation-required") {
    if (!config.confirmPredecessorDeleted) {
      return Object.freeze({
        status: "provider-predecessor-key-deletion-required",
        keyName: "exposed predecessor only",
        confirmCommandFlag: "--confirm-predecessor-deleted",
      });
    }
    await expectOldRejected(state.oldKey);
    await Promise.all([clerkIdentity(state.runtimeKey), clerkIdentity(state.operationsKey)]);
    normalizeSharedEnvironmentInventory(vercelApi("/v1/env"), { deleted: true });
    normalizeProjectEnvironmentInventory(projectEnvironmentPayload(), state.projectEnvironmentId);
    if (sha256(normalizeClerkSecretKey(readLocal().CLERK_SECRET_KEY)) !== state.operationsKeySha256) {
      throw new Error("local Clerk operations key drifted before acceptance");
    }
    if (Date.parse(githubSecretMetadata().updatedAt) < Date.parse(state.githubUpdatedAt)) {
      throw new Error("GitHub Clerk operations secret metadata drifted");
    }
    const candidate = normalizeCandidateDeployment(readDeployment(state.candidateDeploymentId), state.createdAt);
    normalizeDeploymentInventory(deploymentInventoryPayload(), {
      id: candidate.id,
      url: candidate.url,
      createdAt: candidate.createdAt,
      sourceCommit: SOURCE_COMMIT,
    }, true);
    assert.equal(
      normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId),
      "candidate",
    );
    await canonicalHealth();
    const witness = await runtimeWitness(state.operationsKey);
    state = writeState(state, "provider-revocation-required", { runtimeProofCount: 2 });
    const drainSeconds = Math.floor((Date.now() - Date.parse(state.promotedAt)) / 1000);
    const evidence = sanitizedEvidence(config, state, witness, drainSeconds);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (/sk_live_|__session|user_[A-Za-z0-9]+|sess_[A-Za-z0-9]+|sit_[A-Za-z0-9]+/.test(serialized)) {
      throw new Error("sanitized Clerk evidence retained a secret or identity");
    }
    writePrivate(EVIDENCE, serialized);
    removePrivate(JOURNAL);
    return evidence;
  }
  throw new Error("Clerk recovery did not reach a recognized boundary");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecovery(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.replace(/sk_live_[A-Za-z0-9_-]+/g, "[redacted-clerk-key]"));
      process.exitCode = 1;
    });
}
