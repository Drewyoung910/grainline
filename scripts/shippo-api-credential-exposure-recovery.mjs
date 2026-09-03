#!/usr/bin/env node

import assert from "node:assert/strict";
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
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { buildShippoCheckoutQuoteShipment } from "../src/lib/shippingQuoteProvider.ts";

const OPERATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/Users/drewyoung/grainline";
const DEPLOY_SOURCE = "/private/tmp/grainline-order-shipping-production-deploy-20260902";
const LOCAL_ENV = path.join(ROOT, ".env.local");
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const JOURNAL = path.join(EVIDENCE_DIRECTORY, ".shippo-api-credential-recovery-20260903.private.json");
const EVIDENCE = path.join(EVIDENCE_DIRECTORY, "shippo-api-credential-recovery-20260903.json");
const SHIPPING_EVIDENCE = path.join(
  EVIDENCE_DIRECTORY,
  "shipping-rate-secret-credential-recovery-20260902.json",
);
const VERCEL_CLI = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";

const REPOSITORY = "Drewyoung910/grainline";
export const PROJECT = Object.freeze({
  id: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  name: "grainline",
  scope: "drew-youngs-projects",
  teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
});
export const SOURCE_COMMIT = "82f58889b12095d21449494a036a327cc9feb9b1";
export const SOURCE_CI_RUN_ID = 33702373864;
export const CURRENT_DEPLOYMENT = Object.freeze({
  id: "dpl_4La1GXphy21feYp4AdYgT7Q2Zs7f",
  url: "grainline-igekn1uiv-drew-youngs-projects.vercel.app",
  createdAt: 1788398482101,
  sourceCommit: "a4c74bbaeded1e347ec582289a226eae24763faf",
});
export const DATABASE_CREDENTIAL_EPOCH_CUTOFF = 1788356660587;
export const PREDECESSOR_DEPLOYMENTS = Object.freeze([
  Object.freeze({
    id: "dpl_AmW64aR14Yk47HK54kwiMSiKwkJD",
    url: "grainline-q0xx90wyf-drew-youngs-projects.vercel.app",
    createdAt: 1788356660587,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  }),
  Object.freeze({
    id: "dpl_7DA9fNtQZV27smqAvSEJ6RrjtnC9",
    url: "grainline-6wle6dva4-drew-youngs-projects.vercel.app",
    createdAt: 1788362822872,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  }),
  Object.freeze({
    id: "dpl_CkSvMUPv3w7bWC7g4iZaiMMJ34Dy",
    url: "grainline-q32rcdq9o-drew-youngs-projects.vercel.app",
    createdAt: 1788377692211,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  }),
  Object.freeze({
    id: "dpl_Eco3YiDjSFFwLKiS534ZVYRTszMY",
    url: "grainline-ax9cajad9-drew-youngs-projects.vercel.app",
    createdAt: 1788380354267,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  }),
  Object.freeze({
    id: "dpl_GfJdUoqm6gCMGi8CMEExWVEN5xRC",
    url: "grainline-jhwwl01gl-drew-youngs-projects.vercel.app",
    createdAt: 1788380904019,
    sourceCommit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  }),
  Object.freeze({
    id: "dpl_Ec5mLGwhv3jXWEa88z2BeUs5N3j7",
    url: "grainline-7u3jqx7vl-drew-youngs-projects.vercel.app",
    createdAt: 1788384349008,
    sourceCommit: "a4c74bbaeded1e347ec582289a226eae24763faf",
  }),
  Object.freeze({
    id: "dpl_C9K42kdtuY2W74xPWZsZowkYwP94",
    url: "grainline-cmj2i8j7p-drew-youngs-projects.vercel.app",
    createdAt: 1788393633479,
    sourceCommit: "a4c74bbaeded1e347ec582289a226eae24763faf",
  }),
  CURRENT_DEPLOYMENT,
]);
export const SHARED_ENVIRONMENT = Object.freeze({
  id: "env_374M3muVPW3jIKBS8X4Q7kqI",
  key: "SHIPPO_API_KEY",
  type: "encrypted",
  ownerId: PROJECT.teamId,
  projectId: Object.freeze([PROJECT.id]),
  target: Object.freeze(["development", "preview", "production"]),
  createdAt: 1774667874732,
  initialUpdatedAt: 1774668420283,
});
export const OLD_TOKEN_SHA256 = "cc498a2dc7c6c24f866fed067485b2c6a0fb101b61abc39008ccb0dc3676d5eb";
export const REPLACEMENT_TOKEN_NAME = "grainline-test-recovery-20260903";
export const SHIPPING_EVIDENCE_SHA256 = "c9c79ae60656de78365276f1ddd83796958391a26493817fae61376367284161";
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const MAX_REQUEST_DRAIN_MS = 35 * 60 * 1_000;

const COMMIT = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^shippo_test_[A-Za-z0-9_-]{40}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{8,128}$/;
const STAGES = Object.freeze([
  "provider-create-required",
  "replacement-captured",
  "vercel-updated",
  "github-updated",
  "local-updated",
  "candidate-ready",
  "promoted",
  "quotes-proven",
  "predecessors-removed",
  "provider-revocation-required",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEnvironment(extra = {}) {
  const env = {};
  for (const key of [
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TMPDIR",
    "USER",
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
    throw new Error("Shippo credential recovery dependency failed");
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Shippo credential recovery dependency returned invalid JSON");
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
  assertPrivateFile(file, "private Shippo recovery journal");
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
    throw new Error("Shippo credential recovery Git state is not exact and clean");
  }
  return true;
}

function githubRun(id, commit, event = "push") {
  const payload = run("gh", ["api", `repos/${REPOSITORY}/actions/runs/${id}`], { json: true });
  if (
    payload?.id !== id
    || payload.head_sha !== commit
    || payload.status !== "completed"
    || payload.conclusion !== "success"
    || payload.name !== "CI"
    || payload.event !== event
  ) throw new Error("Shippo credential recovery CI binding failed");
  return true;
}

export function normalizeShippoToken(value, label = "Shippo token") {
  if (typeof value !== "string" || value !== value.trim() || !TOKEN.test(value)) {
    throw new Error(`${label} is not an exact Shippo test token`);
  }
  return value;
}

export function normalizeCarrierAccountIdentity(payload) {
  if (
    !payload
    || !Array.isArray(payload.results)
    || payload.next !== null
    || (payload.previous ?? null) !== null
    || payload.results.length === 0
    || payload.results.length > 100
  ) throw new Error("Shippo carrier-account inventory is incomplete");
  const normalized = payload.results.map((row) => {
    if (
      typeof row?.object_id !== "string"
      || !PROVIDER_ID.test(row.object_id)
      || typeof row.carrier !== "string"
      || row.carrier.trim() === ""
      || typeof row.active !== "boolean"
      || typeof row.test !== "boolean"
      || typeof row.is_shippo_account !== "boolean"
    ) throw new Error("Shippo carrier-account inventory contains an invalid row");
    return Object.freeze({
      objectId: row.object_id,
      carrier: row.carrier.trim().toLowerCase(),
      active: row.active,
      test: row.test,
      shippoAccount: row.is_shippo_account,
    });
  }).sort((a, b) => a.objectId.localeCompare(b.objectId));
  if (new Set(normalized.map((row) => row.objectId)).size !== normalized.length) {
    throw new Error("Shippo carrier-account inventory contains duplicate identities");
  }
  return Object.freeze({
    count: normalized.length,
    sha256: sha256(JSON.stringify(normalized)),
  });
}

async function shippoFetch(token, route, init = {}) {
  normalizeShippoToken(token);
  const response = await fetch(`https://api.goshippo.com${route}`, {
    ...init,
    headers: {
      Authorization: `ShippoToken ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = new Error(`Shippo request rejected with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function carrierIdentity(token) {
  return normalizeCarrierAccountIdentity(
    await shippoFetch(token, "/carrier_accounts?results=100&service_levels=false"),
  );
}

export function normalizeRejectedTokenStatus(status) {
  if (![401, 403].includes(status)) {
    throw new Error("superseded Shippo token did not return authentication rejection");
  }
  return true;
}

async function expectOldRejected(token) {
  try {
    await shippoFetch(token, "/carrier_accounts?results=1");
  } catch (error) {
    return normalizeRejectedTokenStatus(error?.status);
  }
  throw new Error("superseded Shippo token still authenticates");
}

function usableRates(shipment) {
  if (shipment?.test !== true || !Array.isArray(shipment.rates) || shipment.rates.length === 0) {
    throw new Error("Shippo quote response was not an explicit test-mode rate set");
  }
  const rows = shipment.rates.flatMap((rate) => {
    const amountText = String(rate?.amount ?? "").trim();
    const currency = String(rate?.currency ?? "").toLowerCase();
    if (
      rate?.test !== true
      || !/^\d+(?:\.\d{1,2})?$/.test(amountText)
      || currency !== "usd"
      || typeof rate?.object_id !== "string"
      || !PROVIDER_ID.test(rate.object_id)
    ) return [];
    const [whole, fraction = ""] = amountText.split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return [];
    return [{ amountCents, estimatedDays: rate.estimated_days ?? null }];
  });
  if (rows.length === 0) throw new Error("Shippo returned no checkout-usable USD test rates");
  return rows;
}

export function summarizeShippoCredentialQuotes(buyerShipment, sellerShipment) {
  const buyerRates = usableRates(buyerShipment);
  const sellerRates = usableRates(sellerShipment);
  const sellerEstimatedDays = sellerRates.filter((rate) => Number.isFinite(rate.estimatedDays));
  if (sellerEstimatedDays.length === 0) {
    throw new Error("Shippo seller re-quote returned no estimated_days witness");
  }
  return Object.freeze({
    buyer: Object.freeze({
      usableRateCount: buyerRates.length,
      minimumAmountCents: Math.min(...buyerRates.map((rate) => rate.amountCents)),
      maximumAmountCents: Math.max(...buyerRates.map((rate) => rate.amountCents)),
    }),
    seller: Object.freeze({
      usableRateCount: sellerRates.length,
      estimatedDaysWitnessCount: sellerEstimatedDays.length,
      minimumAmountCents: Math.min(...sellerRates.map((rate) => rate.amountCents)),
      maximumAmountCents: Math.max(...sellerRates.map((rate) => rate.amountCents)),
    }),
    labelPurchased: false,
    transactionCreated: false,
  });
}

async function proveQuotes(token) {
  const buyerPayload = buildShippoCheckoutQuoteShipment({
    from: {
      name: "Grainline Shippo Test",
      line1: "215 Clayton St",
      city: "San Francisco",
      state: "CA",
      postal: "94117",
      country: "US",
    },
    to: { city: "San Francisco", state: "CA", postal: "94103", country: "US" },
    parcel: { lengthCm: 25, widthCm: 20, heightCm: 15, weightGrams: 900 },
  });
  const sellerPayload = {
    address_from: {
      name: "Grainline Shippo Test",
      street1: "215 Clayton St",
      city: "San Francisco",
      state: "CA",
      zip: "94117",
      country: "US",
    },
    address_to: {
      name: "Grainline Shippo Test Buyer",
      street1: "731 Market St",
      city: "San Francisco",
      state: "CA",
      zip: "94103",
      country: "US",
    },
    parcels: [{
      length: 25,
      width: 20,
      height: 15,
      distance_unit: "cm",
      weight: 900,
      mass_unit: "g",
    }],
    async: false,
  };
  const [buyer, seller] = await Promise.all([
    shippoFetch(token, "/shipments/", { method: "POST", body: JSON.stringify(buyerPayload) }),
    shippoFetch(token, "/shipments/", { method: "POST", body: JSON.stringify(sellerPayload) }),
  ]);
  return summarizeShippoCredentialQuotes(buyer, seller);
}

function vercelApi(route, { method, body } = {}) {
  const args = [VERCEL_CLI, "api", route, "--raw", "--scope", PROJECT.scope, "--no-color"];
  if (method) args.push("--method", method);
  if (body !== undefined) args.push("--input", "-", "--silent");
  const output = run(process.execPath, args, {
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (output === "" && method === "PATCH") return Object.freeze({});
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Vercel API returned invalid JSON");
  }
}

export function normalizeSharedEnvironmentInventory(payload) {
  if (
    !Array.isArray(payload?.data)
    || payload.pagination?.next !== null
    || payload.pagination?.count !== payload.data.length
  ) throw new Error("Vercel shared environment inventory is incomplete");
  const rows = payload.data.filter((row) => row?.key === SHARED_ENVIRONMENT.key);
  const row = rows[0];
  if (
    rows.length !== 1
    || row.id !== SHARED_ENVIRONMENT.id
    || row.type !== SHARED_ENVIRONMENT.type
    || row.ownerId !== SHARED_ENVIRONMENT.ownerId
    || JSON.stringify(row.projectId) !== JSON.stringify(SHARED_ENVIRONMENT.projectId)
    || JSON.stringify(row.target) !== JSON.stringify(SHARED_ENVIRONMENT.target)
    || (row.gitBranch ?? null) !== null
    || row.createdAt !== SHARED_ENVIRONMENT.createdAt
    || !Number.isFinite(row.updatedAt)
    || row.updatedAt < SHARED_ENVIRONMENT.initialUpdatedAt
    || (row.deletedAt ?? null) !== null
    || Object.hasOwn(row, "value")
  ) throw new Error("Vercel shared Shippo environment metadata drifted");
  return Object.freeze({ id: row.id, updatedAt: row.updatedAt });
}

export function normalizeProjectEnvironmentInventory(payload) {
  if (!Array.isArray(payload?.envs)) {
    throw new Error("Vercel project environment inventory is incomplete");
  }
  const rows = payload.envs.filter((row) => (
    row?.key === SHARED_ENVIRONMENT.key || row?.key === "SHIPPO_API_KEY_PREVIOUS"
  ));
  if (rows.length !== 0) throw new Error("project-local Shippo environment shadow exists");
  return true;
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
  ) throw new Error("Vercel shared Shippo value response drifted");
  return sha256(normalizeShippoToken(payload.value, "Vercel Shippo token"));
}

function sharedEnvironmentHash() {
  normalizeSharedEnvironmentInventory(vercelApi("/v1/env"));
  normalizeProjectEnvironmentInventory(vercelApi(`/v10/projects/${PROJECT.id}/env?decrypt=false`));
  return normalizeSharedSecretHash(vercelApi(`/v1/env/${SHARED_ENVIRONMENT.id}`));
}

function updateSharedEnvironment(value) {
  vercelApi("/v1/env", {
    method: "PATCH",
    body: {
      updates: {
        [SHARED_ENVIRONMENT.id]: {
          key: SHARED_ENVIRONMENT.key,
          value,
          comment: "Grainline Shippo test-mode API token",
        },
      },
    },
  });
}

function updateGithubSecret(value) {
  run("gh", ["secret", "set", SHARED_ENVIRONMENT.key, "--repo", REPOSITORY], {
    input: `${value}\n`,
  });
}

function githubSecretMetadata() {
  const rows = run(
    "gh",
    ["secret", "list", "--repo", REPOSITORY, "--json", "name,updatedAt"],
    { json: true },
  );
  const exact = rows.filter((row) => row?.name === SHARED_ENVIRONMENT.key);
  if (exact.length !== 1 || !Number.isFinite(Date.parse(exact[0].updatedAt))) {
    throw new Error("GitHub Shippo secret metadata drifted");
  }
  return Object.freeze({ updatedAt: exact[0].updatedAt });
}

function readLocal() {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  if (
    (source.match(/^SHIPPO_API_KEY=.*$/gm) ?? []).length !== 1
    || (source.match(/^SHIPPO_API_KEY_PREVIOUS=.*$/gm) ?? []).length !== 0
  ) throw new Error("local Shippo environment shape drifted");
  return dotenv.parse(source);
}

function setLocalToken(value) {
  assertPrivateFile(LOCAL_ENV, "local environment file");
  const source = readFileSync(LOCAL_ENV, "utf8");
  const currentPattern = /^SHIPPO_API_KEY=.*$/m;
  if (
    (source.match(/^SHIPPO_API_KEY=.*$/gm) ?? []).length !== 1
    || (source.match(/^SHIPPO_API_KEY_PREVIOUS=.*$/gm) ?? []).length !== 0
  ) throw new Error("local Shippo environment shape drifted");
  const next = source.replace(currentPattern, `SHIPPO_API_KEY=${value}`);
  writePrivate(LOCAL_ENV, next, { replace: true });
  const parsed = readLocal();
  if (parsed.SHIPPO_API_KEY !== value || parsed.SHIPPO_API_KEY_PREVIOUS !== undefined) {
    throw new Error("local Shippo token convergence failed");
  }
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
    marker: payload.meta?.grainlineShippoCredentialRecovery,
  });
}

function exactDeployment(row, expected) {
  return (
    row?.id === expected.id
    && row.url === expected.url
    && row.projectId === PROJECT.id
    && row.readyState === "READY"
    && row.target === "production"
    && row.createdAt === expected.createdAt
    && row.sourceCommit === expected.sourceCommit
  );
}

export function normalizePredecessorDeployment(value, expected) {
  if (!exactDeployment(value, expected)) {
    throw new Error(`Shippo predecessor ${expected.id} drifted`);
  }
  return Object.freeze({ ...value });
}

function deploymentMarker(createdAt) {
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Shippo recovery marker time is invalid");
  return sha256(`grainline-shippo-api-credential-recovery:${createdAt}`).slice(0, 32);
}

export function normalizeCandidateDeployment(value, createdAt) {
  const marker = deploymentMarker(createdAt);
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
    || value.marker !== marker
    || PREDECESSOR_DEPLOYMENTS.some((row) => row.id === value.id)
  ) throw new Error("Shippo replacement deployment drifted");
  return Object.freeze({ id: value.id, url: value.url, createdAt: value.createdAt });
}

function deploymentInventory() {
  return vercelApi(
    `/v6/deployments?projectId=${PROJECT.id}&target=production&limit=100&since=${DATABASE_CREDENTIAL_EPOCH_CUTOFF}`,
  );
}

export function normalizeDeploymentInventory(payload, candidate = null, removedIds = []) {
  if (
    !Array.isArray(payload?.deployments)
    || payload.pagination?.next !== null
    || payload.pagination?.count !== payload.deployments.length
  ) throw new Error("Vercel Shippo credential-epoch inventory is incomplete");
  const removed = new Set(removedIds);
  if (removed.size !== removedIds.length) throw new Error("Shippo removed-deployment state contains duplicates");
  const expected = PREDECESSOR_DEPLOYMENTS.filter((row) => !removed.has(row.id));
  if (candidate !== null) expected.push(candidate);
  const observed = payload.deployments.map((row) => ({
    id: row.id ?? row.uid,
    url: row.url,
    createdAt: row.createdAt ?? row.created,
    readyState: row.readyState,
    target: row.target,
    sourceCommit: row.meta?.gitCommitSha,
  }));
  if (observed.length !== expected.length) {
    throw new Error("Vercel Shippo credential-epoch deployment count drifted");
  }
  const byId = new Map(observed.map((row) => [row.id, row]));
  for (const row of expected) {
    const actual = byId.get(row.id);
    if (
      !actual
      || actual.url !== row.url
      || actual.createdAt !== row.createdAt
      || actual.readyState !== "READY"
      || actual.target !== "production"
      || actual.sourceCommit !== row.sourceCommit
    ) throw new Error("Vercel Shippo credential-epoch deployment identity drifted");
  }
  if (observed.some((row) => !expected.some((item) => item.id === row.id))) {
    throw new Error("unreviewed deployment entered the Shippo credential epoch");
  }
  return Object.freeze({ count: observed.length, ids: Object.freeze(observed.map((row) => row.id)) });
}

export function reconcileRemovedDeploymentIds(payload, candidate, recordedIds = []) {
  if (
    !Array.isArray(payload?.deployments)
    || payload.pagination?.next !== null
    || payload.pagination?.count !== payload.deployments.length
    || !candidate
  ) throw new Error("Vercel Shippo restart inventory is incomplete");
  const rows = payload.deployments.map((row) => ({
    id: row.id ?? row.uid,
    url: row.url,
    createdAt: row.createdAt ?? row.created,
    readyState: row.readyState,
    target: row.target,
    sourceCommit: row.meta?.gitCommitSha,
  }));
  const candidateRow = rows.filter((row) => row.id === candidate.id);
  if (
    candidateRow.length !== 1
    || candidateRow[0].url !== candidate.url
    || candidateRow[0].createdAt !== candidate.createdAt
    || candidateRow[0].readyState !== "READY"
    || candidateRow[0].target !== "production"
    || candidateRow[0].sourceCommit !== candidate.sourceCommit
  ) throw new Error("Shippo restart candidate deployment drifted");
  const predecessorById = new Map(PREDECESSOR_DEPLOYMENTS.map((row) => [row.id, row]));
  for (const row of rows.filter((item) => item.id !== candidate.id)) {
    const expected = predecessorById.get(row.id);
    if (
      !expected
      || row.url !== expected.url
      || row.createdAt !== expected.createdAt
      || row.readyState !== "READY"
      || row.target !== "production"
      || row.sourceCommit !== expected.sourceCommit
    ) throw new Error("unreviewed deployment entered the Shippo restart inventory");
  }
  const present = new Set(rows.map((row) => row.id));
  const missing = PREDECESSOR_DEPLOYMENTS
    .filter((row) => !present.has(row.id))
    .map((row) => row.id);
  const expectedPrefix = PREDECESSOR_DEPLOYMENTS.slice(0, missing.length).map((row) => row.id);
  if (JSON.stringify(missing) !== JSON.stringify(expectedPrefix)) {
    throw new Error("Shippo predecessor deletion order drifted");
  }
  if (recordedIds.some((id, index) => id !== missing[index])) {
    throw new Error("Shippo restart journal is ahead of provider deletion state");
  }
  return Object.freeze([...missing]);
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
  ) throw new Error("canonical Shippo recovery alias state drifted");
  const ids = [...new Set(targets.map((row) => row.deployment.id))];
  if (ids.length > 1) return "mixed";
  if (ids[0] === currentId) return "current";
  if (candidateId !== null && ids[0] === candidateId) return "candidate";
  throw new Error("canonical aliases target an unreviewed deployment");
}

async function canonicalHealth() {
  const response = await fetch("https://thegrainline.com/api/health", {
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
  const payload = deploymentInventory();
  const marker = deploymentMarker(state.createdAt);
  const candidates = payload.deployments.filter((row) => (
    row?.target === "production"
    && row.meta?.gitCommitSha === SOURCE_COMMIT
    && row.meta?.gitCommitRef === "main"
    && row.meta?.grainlineShippoCredentialRecovery === marker
  ));
  if (candidates.length > 1) throw new Error("Shippo replacement deployment is ambiguous");
  if (candidates.length === 0) return null;
  return candidates[0].id ?? candidates[0].uid;
}

async function waitForCandidate(id, createdAt) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const deployment = readDeployment(id);
    if (deployment.readyState === "READY") {
      return normalizeCandidateDeployment(deployment, createdAt);
    }
    if (["ERROR", "CANCELED"].includes(deployment.readyState)) {
      throw new Error("Shippo replacement deployment entered a terminal state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Shippo replacement deployment did not become ready in time");
}

async function deployCandidate(state) {
  const existing = findCandidateId(state);
  if (existing) return waitForCandidate(existing, state.createdAt);
  normalizeDeploymentInventory(deploymentInventory());
  const marker = deploymentMarker(state.createdAt);
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
    `grainlineShippoCredentialRecovery=${marker}`,
    "--no-color",
  ], { cwd: DEPLOY_SOURCE, timeout: 15 * 60_000 });
  const url = output.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(line));
  if (!url) throw new Error("Shippo replacement deployment URL was not returned");
  const deployment = readDeployment(new URL(url).hostname);
  return waitForCandidate(deployment.id, state.createdAt);
}

function promoteCandidate(state) {
  const position = normalizeAliasPosition(
    aliasTargets(),
    CURRENT_DEPLOYMENT.id,
    state.candidateDeploymentId,
  );
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

function removeDeployment(expected) {
  normalizePredecessorDeployment(readDeployment(expected.id), expected);
  run(process.execPath, [
    VERCEL_CLI,
    "remove",
    expected.id,
    "--yes",
    "--scope",
    PROJECT.scope,
    "--no-color",
  ]);
}

function readShippingEvidence() {
  assertPrivateFile(SHIPPING_EVIDENCE, "accepted shipping-rate evidence");
  const raw = readFileSync(SHIPPING_EVIDENCE, "utf8");
  const value = JSON.parse(raw);
  if (
    sha256(raw) !== SHIPPING_EVIDENCE_SHA256
    || value?.accepted !== true
    || value.operation !== "shipping-rate-secret-credential-exposure-recovery"
    || value.finalDeploymentId !== CURRENT_DEPLOYMENT.id
    || value.previousEnvironmentPresent !== false
    || value.replacementSecretAccepted !== true
    || value.oldSecretAcceptedAfterDrain !== false
    || value.productionHealth !== 200
  ) throw new Error("accepted shipping-rate credential evidence drifted");
  return true;
}

function stateFromDisk() {
  assertPrivateFile(JOURNAL, "private Shippo recovery journal");
  return validateState(JSON.parse(readFileSync(JOURNAL, "utf8")));
}

export function validateState(value, expectedOldTokenSha256 = OLD_TOKEN_SHA256) {
  const stage = STAGES.indexOf(value?.stage);
  if (
    value?.schemaVersion !== 1
    || value.operation !== "shippo-api-credential-exposure-recovery"
    || stage < 0
    || !COMMIT.test(value.operatorCommit ?? "")
    || !Number.isSafeInteger(value.operatorCiRunId)
    || value.operatorCiRunId <= 0
    || value.sourceCommit !== SOURCE_COMMIT
    || value.sourceCiRunId !== SOURCE_CI_RUN_ID
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.updatedAt))
    || !Number.isFinite(Date.parse(value.githubUpdatedAtBefore))
    || normalizeShippoToken(value.oldToken, "journal predecessor Shippo token") !== value.oldToken
    || value.oldTokenSha256 !== sha256(value.oldToken)
    || value.oldTokenSha256 !== expectedOldTokenSha256
    || !SHA256.test(value.providerIdentitySha256 ?? "")
    || !Number.isSafeInteger(value.providerIdentityCount)
    || value.providerIdentityCount <= 0
    || !Array.isArray(value.removedDeploymentIds)
    || new Set(value.removedDeploymentIds).size !== value.removedDeploymentIds.length
    || value.removedDeploymentIds.some((id, index) => id !== PREDECESSOR_DEPLOYMENTS[index]?.id)
  ) throw new Error("private Shippo credential recovery state drifted");
  const replacementRequired = stage >= STAGES.indexOf("replacement-captured");
  if (replacementRequired) {
    normalizeShippoToken(value.newToken, "journal replacement Shippo token");
    if (
      value.newTokenSha256 !== sha256(value.newToken)
      || value.newTokenSha256 === value.oldTokenSha256
    ) throw new Error("private Shippo replacement credential state drifted");
  } else if (value.newToken !== null || value.newTokenSha256 !== null) {
    throw new Error("private Shippo state captured a replacement before its stage");
  }
  if (stage >= STAGES.indexOf("candidate-ready")) {
    if (
      !DEPLOYMENT.test(value.candidateDeploymentId ?? "")
      || typeof value.candidateDeploymentUrl !== "string"
      || !value.candidateDeploymentUrl.endsWith(".vercel.app")
    ) throw new Error("private Shippo candidate deployment state drifted");
  }
  if (
    stage >= STAGES.indexOf("github-updated")
    && (
      !Number.isFinite(Date.parse(value.githubUpdatedAt))
      || Date.parse(value.githubUpdatedAt) <= Date.parse(value.githubUpdatedAtBefore)
    )
  ) throw new Error("private Shippo GitHub update witness drifted");
  if (stage >= STAGES.indexOf("promoted") && !Number.isFinite(Date.parse(value.promotedAt))) {
    throw new Error("private Shippo promotion time drifted");
  }
  return Object.freeze(value);
}

function writeState(state, stage, patch = {}) {
  if (!STAGES.includes(stage)) throw new Error("Shippo recovery stage is invalid");
  const next = validateState({
    ...state,
    ...patch,
    stage,
    updatedAt: new Date().toISOString(),
  });
  writePrivate(JOURNAL, `${JSON.stringify(next, null, 2)}\n`, { replace: true });
  return next;
}

function createState(config, oldToken, identity, github) {
  const now = new Date().toISOString();
  const value = {
    schemaVersion: 1,
    operation: "shippo-api-credential-exposure-recovery",
    stage: "provider-create-required",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    sourceCommit: SOURCE_COMMIT,
    sourceCiRunId: SOURCE_CI_RUN_ID,
    createdAt: now,
    updatedAt: now,
    oldToken,
    oldTokenSha256: sha256(oldToken),
    newToken: null,
    newTokenSha256: null,
    providerIdentitySha256: identity.sha256,
    providerIdentityCount: identity.count,
    githubUpdatedAtBefore: github.updatedAt,
    githubUpdatedAt: null,
    candidateDeploymentId: null,
    candidateDeploymentUrl: null,
    promotedAt: null,
    quoteProof: null,
    removedDeploymentIds: [],
  };
  writePrivate(JOURNAL, `${JSON.stringify(validateState(value), null, 2)}\n`);
  return validateState(value);
}

function readReplacementFromClipboard() {
  let value;
  try {
    const pasted = spawnSync("/usr/bin/pbpaste", [], {
      env: safeEnvironment(),
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
    if (pasted.error || pasted.status !== 0) {
      throw new Error("Shippo replacement token could not be read from the clipboard");
    }
    value = pasted.stdout;
    return normalizeShippoToken(value, "clipboard Shippo replacement token");
  } finally {
    const cleared = spawnSync("/usr/bin/pbcopy", [], {
      env: safeEnvironment(),
      input: "",
      encoding: "utf8",
    });
    if (cleared.error || cleared.status !== 0) {
      throw new Error("clipboard could not be cleared after Shippo token capture");
    }
  }
}

async function waitForDrain(promotedAt) {
  const deadline = Date.parse(promotedAt) + MAX_REQUEST_DRAIN_MS;
  if (!Number.isFinite(deadline)) throw new Error("Shippo drain deadline is invalid");
  let remaining = deadline - Date.now();
  while (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 30_000)));
    remaining = deadline - Date.now();
  }
  return Math.max(0, Math.floor((Date.now() - Date.parse(promotedAt)) / 1000));
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validQuoteEvidence(value) {
  return exactKeys(value, ["buyer", "seller", "labelPurchased", "transactionCreated"])
    && exactKeys(value.buyer, ["usableRateCount", "minimumAmountCents", "maximumAmountCents"])
    && exactKeys(value.seller, [
      "usableRateCount",
      "estimatedDaysWitnessCount",
      "minimumAmountCents",
      "maximumAmountCents",
    ])
    && Number.isSafeInteger(value.buyer.usableRateCount)
    && value.buyer.usableRateCount > 0
    && Number.isSafeInteger(value.buyer.minimumAmountCents)
    && value.buyer.minimumAmountCents > 0
    && Number.isSafeInteger(value.buyer.maximumAmountCents)
    && value.buyer.maximumAmountCents >= value.buyer.minimumAmountCents
    && Number.isSafeInteger(value.seller.usableRateCount)
    && value.seller.usableRateCount > 0
    && Number.isSafeInteger(value.seller.estimatedDaysWitnessCount)
    && value.seller.estimatedDaysWitnessCount > 0
    && value.seller.estimatedDaysWitnessCount <= value.seller.usableRateCount
    && Number.isSafeInteger(value.seller.minimumAmountCents)
    && value.seller.minimumAmountCents > 0
    && Number.isSafeInteger(value.seller.maximumAmountCents)
    && value.seller.maximumAmountCents >= value.seller.minimumAmountCents
    && value.labelPurchased === false
    && value.transactionCreated === false;
}

export function sanitizedEvidence(config, state, finalIdentity, finalQuote, health) {
  if (
    finalIdentity?.sha256 !== state.providerIdentitySha256
    || finalIdentity.count !== state.providerIdentityCount
    || health !== 200
    || state.removedDeploymentIds.length !== PREDECESSOR_DEPLOYMENTS.length
  ) throw new Error("Shippo accepted evidence inputs drifted");
  return Object.freeze({
    schemaVersion: 1,
    operation: "shippo-api-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    generatedAt: new Date().toISOString(),
    operator: Object.freeze({ commit: config.operatorCommit, ciRunId: config.operatorCiRunId }),
    application: Object.freeze({ sourceCommit: SOURCE_COMMIT, sourceCiRunId: SOURCE_CI_RUN_ID }),
    provider: Object.freeze({
      mode: "test",
      replacementTokenName: REPLACEMENT_TOKEN_NAME,
      predecessorTokenSha256: state.oldTokenSha256,
      replacementTokenSha256: state.newTokenSha256,
      carrierIdentitySha256: finalIdentity.sha256,
      carrierAccountCount: finalIdentity.count,
      predecessorRejected: true,
      replacementAuthenticated: true,
    }),
    consumers: Object.freeze({
      sharedVercelEnvironmentId: SHARED_ENVIRONMENT.id,
      projectLocalShadowPresent: false,
      githubRepositorySecretUpdated: true,
      localUpdated: true,
    }),
    deployment: Object.freeze({
      replacementId: state.candidateDeploymentId,
      removedPredecessorIds: Object.freeze([...state.removedDeploymentIds]),
      drainSeconds: Math.floor((Date.now() - Date.parse(state.promotedAt)) / 1000),
      canonicalAliasCount: CANONICAL_ALIASES.length,
      healthStatus: health,
    }),
    quoteProof: finalQuote,
    labelPurchased: false,
    transactionCreated: false,
    migrationsRun: false,
    rlsChanged: false,
    otherProviderStateChanged: false,
    secretsRetained: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  const serialized = JSON.stringify(value);
  if (
    !exactKeys(value, [
      "schemaVersion", "operation", "status", "acceptanceEligible", "issueCount", "generatedAt",
      "operator", "application", "provider", "consumers", "deployment", "quoteProof",
      "labelPurchased", "transactionCreated", "migrationsRun", "rlsChanged",
      "otherProviderStateChanged", "secretsRetained",
    ])
    || !exactKeys(value.operator, ["commit", "ciRunId"])
    || !exactKeys(value.application, ["sourceCommit", "sourceCiRunId"])
    || !exactKeys(value.provider, [
      "mode", "replacementTokenName", "predecessorTokenSha256", "replacementTokenSha256",
      "carrierIdentitySha256", "carrierAccountCount", "predecessorRejected",
      "replacementAuthenticated",
    ])
    || !exactKeys(value.consumers, [
      "sharedVercelEnvironmentId", "projectLocalShadowPresent",
      "githubRepositorySecretUpdated", "localUpdated",
    ])
    || !exactKeys(value.deployment, [
      "replacementId", "removedPredecessorIds", "drainSeconds", "canonicalAliasCount",
      "healthStatus",
    ])
    || value.schemaVersion !== 1
    || value.operation !== "shippo-api-credential-exposure-recovery"
    || value.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || !Number.isFinite(Date.parse(value.generatedAt))
    || value.operator?.commit !== config.operatorCommit
    || value.operator.ciRunId !== config.operatorCiRunId
    || value.application?.sourceCommit !== SOURCE_COMMIT
    || value.application.sourceCiRunId !== SOURCE_CI_RUN_ID
    || value.provider?.mode !== "test"
    || value.provider.replacementTokenName !== REPLACEMENT_TOKEN_NAME
    || value.provider.predecessorTokenSha256 !== OLD_TOKEN_SHA256
    || !SHA256.test(value.provider.replacementTokenSha256 ?? "")
    || value.provider.replacementTokenSha256 === OLD_TOKEN_SHA256
    || !SHA256.test(value.provider.carrierIdentitySha256 ?? "")
    || !Number.isSafeInteger(value.provider.carrierAccountCount)
    || value.provider.carrierAccountCount <= 0
    || value.provider.predecessorRejected !== true
    || value.provider.replacementAuthenticated !== true
    || value.consumers?.sharedVercelEnvironmentId !== SHARED_ENVIRONMENT.id
    || value.consumers.projectLocalShadowPresent !== false
    || value.consumers.githubRepositorySecretUpdated !== true
    || value.consumers.localUpdated !== true
    || !DEPLOYMENT.test(value.deployment?.replacementId ?? "")
    || JSON.stringify(value.deployment.removedPredecessorIds)
      !== JSON.stringify(PREDECESSOR_DEPLOYMENTS.map((row) => row.id))
    || !Number.isSafeInteger(value.deployment.drainSeconds)
    || value.deployment.drainSeconds < MAX_REQUEST_DRAIN_MS / 1000
    || value.deployment.canonicalAliasCount !== CANONICAL_ALIASES.length
    || value.deployment.healthStatus !== 200
    || !validQuoteEvidence(value.quoteProof)
    || value.labelPurchased !== false
    || value.transactionCreated !== false
    || value.migrationsRun !== false
    || value.rlsChanged !== false
    || value.otherProviderStateChanged !== false
    || value.secretsRetained !== false
    || /shippo_(?:test|live)_/.test(serialized)
  ) throw new Error("accepted Shippo credential evidence drifted");
  return Object.freeze(value);
}

function parseArguments(args) {
  const value = { captureReplacementFromClipboard: false, confirmPredecessorDeleted: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--operator-commit") value.operatorCommit = args[++index];
    else if (arg === "--operator-ci-run") value.operatorCiRunId = Number(args[++index]);
    else if (arg === "--capture-replacement-from-clipboard") value.captureReplacementFromClipboard = true;
    else if (arg === "--confirm-predecessor-deleted") value.confirmPredecessorDeleted = true;
    else throw new Error(`unknown Shippo credential recovery argument: ${arg}`);
  }
  if (!COMMIT.test(value.operatorCommit ?? "") || !Number.isSafeInteger(value.operatorCiRunId)) {
    throw new Error("Shippo recovery requires an exact operator commit and CI run");
  }
  if (value.captureReplacementFromClipboard && value.confirmPredecessorDeleted) {
    throw new Error("Shippo capture and revocation confirmation are separate boundaries");
  }
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
  readShippingEvidence();

  if (existsSync(EVIDENCE)) {
    assertPrivateFile(EVIDENCE, "accepted Shippo credential evidence");
    const value = validateAcceptedEvidence(JSON.parse(readFileSync(EVIDENCE, "utf8")), config);
    if (existsSync(JOURNAL)) {
      const state = stateFromDisk();
      if (
        state.operatorCommit !== config.operatorCommit
        || state.operatorCiRunId !== config.operatorCiRunId
        || state.stage !== "provider-revocation-required"
        || state.oldTokenSha256 !== value.provider.predecessorTokenSha256
        || state.newTokenSha256 !== value.provider.replacementTokenSha256
        || state.providerIdentitySha256 !== value.provider.carrierIdentitySha256
        || state.providerIdentityCount !== value.provider.carrierAccountCount
        || JSON.stringify(state.removedDeploymentIds)
          !== JSON.stringify(PREDECESSOR_DEPLOYMENTS.map((row) => row.id))
      ) throw new Error("accepted Shippo evidence does not match its retained journal");
      await expectOldRejected(state.oldToken);
      const identity = await carrierIdentity(state.newToken);
      if (
        identity.sha256 !== state.providerIdentitySha256
        || identity.count !== state.providerIdentityCount
        || sharedEnvironmentHash() !== state.newTokenSha256
        || sha256(normalizeShippoToken(readLocal().SHIPPO_API_KEY)) !== state.newTokenSha256
        || Date.parse(githubSecretMetadata().updatedAt) < Date.parse(state.githubUpdatedAt)
      ) throw new Error("completed Shippo consumer state drifted before journal cleanup");
      const candidate = normalizeCandidateDeployment(
        readDeployment(state.candidateDeploymentId),
        state.createdAt,
      );
      normalizeDeploymentInventory(deploymentInventory(), {
        id: candidate.id,
        url: candidate.url,
        createdAt: candidate.createdAt,
        sourceCommit: SOURCE_COMMIT,
      }, PREDECESSOR_DEPLOYMENTS.map((row) => row.id));
      assert.equal(
        normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId),
        "candidate",
      );
      await canonicalHealth();
      removePrivate(JOURNAL);
    }
    return value;
  }

  let state;
  if (existsSync(JOURNAL)) {
    state = stateFromDisk();
    if (state.operatorCommit !== config.operatorCommit || state.operatorCiRunId !== config.operatorCiRunId) {
      throw new Error("private Shippo journal belongs to another operator");
    }
  } else {
    const oldToken = normalizeShippoToken(readLocal().SHIPPO_API_KEY, "local predecessor Shippo token");
    if (sha256(oldToken) !== OLD_TOKEN_SHA256) {
      throw new Error("local predecessor Shippo token digest drifted");
    }
    if (sharedEnvironmentHash() !== OLD_TOKEN_SHA256) {
      throw new Error("Vercel predecessor Shippo token digest drifted");
    }
    const github = githubSecretMetadata();
    normalizeDeploymentInventory(deploymentInventory());
    for (const deployment of PREDECESSOR_DEPLOYMENTS) {
      normalizePredecessorDeployment(readDeployment(deployment.id), deployment);
    }
    assert.equal(normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id), "current");
    await canonicalHealth();
    const identity = await carrierIdentity(oldToken);
    state = createState(config, oldToken, identity, github);
  }

  if (state.stage === "provider-create-required") {
    if (!config.captureReplacementFromClipboard) {
      return Object.freeze({
        status: "provider-token-create-required",
        providerMode: "test",
        replacementTokenName: REPLACEMENT_TOKEN_NAME,
        captureCommandFlag: "--capture-replacement-from-clipboard",
      });
    }
    const newToken = readReplacementFromClipboard();
    const newTokenSha256 = sha256(newToken);
    if (newTokenSha256 === state.oldTokenSha256) {
      throw new Error("clipboard contains the predecessor Shippo token");
    }
    const [oldIdentity, newIdentity] = await Promise.all([
      carrierIdentity(state.oldToken),
      carrierIdentity(newToken),
    ]);
    if (
      oldIdentity.sha256 !== state.providerIdentitySha256
      || oldIdentity.count !== state.providerIdentityCount
      || newIdentity.sha256 !== oldIdentity.sha256
      || newIdentity.count !== oldIdentity.count
    ) throw new Error("Shippo replacement token reaches a different account");
    state = writeState(state, "replacement-captured", { newToken, newTokenSha256 });
  }

  if (state.stage === "replacement-captured") {
    const currentHash = sharedEnvironmentHash();
    if (currentHash === state.oldTokenSha256) updateSharedEnvironment(state.newToken);
    else if (currentHash !== state.newTokenSha256) {
      throw new Error("Vercel Shippo token changed outside the reviewed pair");
    }
    let stored = sharedEnvironmentHash();
    for (let attempt = 0; stored !== state.newTokenSha256 && attempt < 7; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      stored = sharedEnvironmentHash();
    }
    if (stored !== state.newTokenSha256) throw new Error("Vercel Shippo replacement did not converge");
    state = writeState(state, "vercel-updated");
  }
  if (state.stage === "vercel-updated") {
    updateGithubSecret(state.newToken);
    const github = githubSecretMetadata();
    state = writeState(state, "github-updated", { githubUpdatedAt: github.updatedAt });
  }
  if (state.stage === "github-updated") {
    const local = readLocal();
    if (sha256(normalizeShippoToken(local.SHIPPO_API_KEY, "local Shippo token")) === state.oldTokenSha256) {
      setLocalToken(state.newToken);
    }
    if (sha256(normalizeShippoToken(readLocal().SHIPPO_API_KEY, "local Shippo token")) !== state.newTokenSha256) {
      throw new Error("local Shippo replacement did not converge");
    }
    state = writeState(state, "local-updated");
  }
  if (state.stage === "local-updated") {
    const candidate = await deployCandidate(state);
    state = writeState(state, "candidate-ready", {
      candidateDeploymentId: candidate.id,
      candidateDeploymentUrl: candidate.url,
    });
  }
  if (state.stage === "candidate-ready") {
    const candidate = normalizeCandidateDeployment(
      readDeployment(state.candidateDeploymentId),
      state.createdAt,
    );
    normalizeDeploymentInventory(deploymentInventory(), {
      id: candidate.id,
      url: candidate.url,
      createdAt: candidate.createdAt,
      sourceCommit: SOURCE_COMMIT,
    });
    promoteCandidate(state);
    const health = await canonicalHealth();
    state = writeState(state, "promoted", { promotedAt: new Date().toISOString(), promotionHealth: health });
  }
  if (state.stage === "promoted") {
    const identity = await carrierIdentity(state.newToken);
    if (identity.sha256 !== state.providerIdentitySha256 || identity.count !== state.providerIdentityCount) {
      throw new Error("Shippo replacement provider identity drifted after promotion");
    }
    const quoteProof = await proveQuotes(state.newToken);
    state = writeState(state, "quotes-proven", { quoteProof });
  }
  if (state.stage === "quotes-proven") {
    await waitForDrain(state.promotedAt);
    const candidate = {
      id: state.candidateDeploymentId,
      url: state.candidateDeploymentUrl,
      createdAt: readDeployment(state.candidateDeploymentId).createdAt,
      sourceCommit: SOURCE_COMMIT,
    };
    const reconciled = reconcileRemovedDeploymentIds(
      deploymentInventory(),
      candidate,
      state.removedDeploymentIds,
    );
    if (reconciled.length !== state.removedDeploymentIds.length) {
      state = writeState(state, "quotes-proven", { removedDeploymentIds: [...reconciled] });
    }
    for (const deployment of PREDECESSOR_DEPLOYMENTS) {
      if (state.removedDeploymentIds.includes(deployment.id)) continue;
      assert.equal(
        normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId),
        "candidate",
      );
      await canonicalHealth();
      normalizeDeploymentInventory(
        deploymentInventory(),
        candidate,
        state.removedDeploymentIds,
      );
      removeDeployment(deployment);
      const nextRemovedIds = [...state.removedDeploymentIds, deployment.id];
      const verifiedRemovedIds = reconcileRemovedDeploymentIds(
        deploymentInventory(),
        candidate,
        state.removedDeploymentIds,
      );
      if (JSON.stringify(verifiedRemovedIds) !== JSON.stringify(nextRemovedIds)) {
        throw new Error("Vercel did not remove the exact next Shippo predecessor");
      }
      state = writeState(state, "quotes-proven", {
        removedDeploymentIds: nextRemovedIds,
      });
    }
    state = writeState(state, "predecessors-removed");
  }
  if (state.stage === "predecessors-removed") {
    state = writeState(state, "provider-revocation-required");
  }
  if (state.stage === "provider-revocation-required") {
    if (!config.confirmPredecessorDeleted) {
      return Object.freeze({
        status: "provider-predecessor-deletion-required",
        providerMode: "test",
        replacementTokenName: REPLACEMENT_TOKEN_NAME,
        confirmCommandFlag: "--confirm-predecessor-deleted",
      });
    }
    await expectOldRejected(state.oldToken);
    const finalIdentity = await carrierIdentity(state.newToken);
    const finalQuote = await proveQuotes(state.newToken);
    const candidate = normalizeCandidateDeployment(
      readDeployment(state.candidateDeploymentId),
      state.createdAt,
    );
    normalizeDeploymentInventory(deploymentInventory(), {
      id: candidate.id,
      url: candidate.url,
      createdAt: candidate.createdAt,
      sourceCommit: SOURCE_COMMIT,
    }, PREDECESSOR_DEPLOYMENTS.map((row) => row.id));
    assert.equal(
      normalizeAliasPosition(aliasTargets(), CURRENT_DEPLOYMENT.id, state.candidateDeploymentId),
      "candidate",
    );
    if (sharedEnvironmentHash() !== state.newTokenSha256) {
      throw new Error("Vercel Shippo replacement digest drifted before acceptance");
    }
    if (sha256(normalizeShippoToken(readLocal().SHIPPO_API_KEY)) !== state.newTokenSha256) {
      throw new Error("local Shippo replacement digest drifted before acceptance");
    }
    const health = await canonicalHealth();
    const evidence = sanitizedEvidence(config, state, finalIdentity, finalQuote, health);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (/shippo_(?:test|live)_/.test(serialized)) {
      throw new Error("sanitized Shippo evidence retained a credential");
    }
    writePrivate(EVIDENCE, serialized);
    removePrivate(JOURNAL);
    return evidence;
  }
  throw new Error("Shippo recovery did not reach a recognized boundary");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecovery(parseArguments(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.replace(/shippo_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-shippo-token]"));
      process.exitCode = 1;
    });
}
