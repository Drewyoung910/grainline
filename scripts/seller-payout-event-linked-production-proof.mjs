#!/usr/bin/env node
// Restart-safe, test-mode-only linked SellerPayoutEvent production proof.
// This file may be reviewed and merged without authorizing its execution.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";
import {
  readProviderState,
} from "./stripe-connect-provider-cutover.mjs";
import { assertSensitiveProductionVariable } from "./stripe-connect-webhook-bootstrap.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CONFIRMATION = "reviewed-linked-seller-payout-production-proof";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const CONNECT_URL = `${PRODUCTION_ORIGIN}/api/stripe/webhook/connect`;
export const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
export const PRODUCTION_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
export const PRODUCTION_DATABASE_NAME = "neondb";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const REQUIRED_FAILURE_CODE = "no_account";
export const FUNDING_CHARGE_CENTS = 500;
export const PAYOUT_CENTS = 100;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "seller-payout-event-linked-production-proof-state.json",
);
const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_CLI_VERSION = "1.39.0";
const VERCEL_CLI_VERSION = "58.9.0";
const MAX_EVIDENCE_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{2,255}$/;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_PATTERN = /\b(?:acct|ch|evt|po|we)_[A-Za-z0-9_]+\b/g;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EXPECTED_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});

function required(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(env, key) {
  const value = required(env, key);
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} must be a positive integer`);
  return Number(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function redact(value) {
  return String(value ?? "")
    .replace(DATABASE_URL_PATTERN, "[redacted-database-url]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(STRIPE_OBJECT_PATTERN, "[redacted-stripe-object]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  return redact(error instanceof Error ? error.message || error.name : error);
}

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const stat = lstatSync(filePath);
  if (stat.size > MAX_EVIDENCE_BYTES) throw new Error(`${label} exceeded its size bound`);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return value;
}

function writePrivateJson(filePath, value) {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite ${filePath}`);
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function replacePrivateJson(filePath, value) {
  const nextPath = `${filePath}.next`;
  if (existsSync(nextPath)) throw new Error("stale payout proof state update exists");
  writePrivateJson(nextPath, value);
  renameSync(nextPath, filePath);
  chmodSync(filePath, 0o600);
}

function readPrivateEnvironment(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  return parseDotenv(readFileSync(filePath, "utf8"));
}

export function validateConfiguration(env = process.env) {
  if (env.SELLER_PAYOUT_LINKED_PROOF_CONFIRM !== CONFIRMATION) {
    throw new Error("linked payout proof confirmation is invalid");
  }
  const expectedCommit = required(env, "SELLER_PAYOUT_LINKED_PROOF_EXPECTED_COMMIT");
  const mainCiRunId = positiveInteger(env, "SELLER_PAYOUT_LINKED_PROOF_CI_RUN_ID");
  const deploymentId = required(env, "SELLER_PAYOUT_LINKED_PROOF_DEPLOYMENT_ID");
  if (!COMMIT_PATTERN.test(expectedCommit)) throw new Error("expected commit is invalid");
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("deployment ID is invalid");
  const evidencePath = path.resolve(required(env, "SELLER_PAYOUT_LINKED_PROOF_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `seller-payout-event-linked-production-proof-${expectedCommit}.json`
  ) {
    throw new Error("linked payout proof evidence path is not the fresh reviewed path");
  }
  const vercelProjectDirectory = path.resolve(
    required(env, "SELLER_PAYOUT_LINKED_PROOF_VERCEL_PROJECT_DIRECTORY"),
  );
  const stripeCliPath = path.resolve(
    env.SELLER_PAYOUT_LINKED_PROOF_STRIPE_CLI_PATH || "/opt/homebrew/bin/stripe",
  );
  return Object.freeze({
    deploymentId,
    evidencePath,
    expectedCommit,
    mainCiRunId,
    statePath: STATE_PATH,
    stripeCliPath,
    vercelProjectDirectory,
  });
}

export function parseDatabaseUrls(localValues, ownerValues) {
  const runtimeDatabaseUrl = required(localValues, "DATABASE_URL");
  const ownerDatabaseUrl = required(ownerValues, "DIRECT_URL");
  const runtime = new URL(runtimeDatabaseUrl);
  const owner = new URL(ownerDatabaseUrl);
  if (
    runtime.protocol !== "postgresql:"
    || runtime.username !== RUNTIME_ROLE
    || runtime.hostname !== `${PRODUCTION_ENDPOINT_ID}-pooler.westus3.azure.neon.tech`
    || runtime.pathname !== `/${PRODUCTION_DATABASE_NAME}`
    || runtime.searchParams.get("sslmode") !== "verify-full"
    || runtime.searchParams.get("channel_binding") !== "require"
    || !runtime.password
  ) throw new Error("linked payout proof runtime database identity drifted");
  if (
    owner.protocol !== "postgresql:"
    || owner.username !== "neondb_owner"
    || owner.hostname !== `${PRODUCTION_ENDPOINT_ID}.westus3.azure.neon.tech`
    || owner.pathname !== `/${PRODUCTION_DATABASE_NAME}`
    || owner.searchParams.get("sslmode") !== "verify-full"
    || owner.searchParams.get("channel_binding") !== "require"
    || !owner.password
  ) throw new Error("linked payout proof owner database identity drifted");
  return Object.freeze({ ownerDatabaseUrl, runtimeDatabaseUrl });
}

export function validateStripeSecret(localValues) {
  const secretKey = required(localValues, "STRIPE_SECRET_KEY");
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new Error("linked payout proof refuses any non-test Stripe secret");
  }
  return secretKey;
}

export function assertGitState(state, expectedCommit) {
  if (
    state?.branch !== "main"
    || state?.head !== expectedCommit
    || state?.status !== ""
    || !COMMIT_PATTERN.test(expectedCommit)
  ) throw new Error("linked payout proof requires exact clean reviewed main");
  return Object.freeze({ clean: true, head: expectedCommit });
}

export function parseGitHubCiRun(raw, expectedCommit, expectedRunId) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    value?.databaseId !== expectedRunId
    || value?.headSha !== expectedCommit
    || value?.conclusion !== "success"
    || value?.status !== "completed"
    || value?.workflowName !== "CI"
  ) throw new Error("linked payout proof exact-main CI binding did not pass");
  return Object.freeze({ passed: true, runId: expectedRunId });
}

export function assertSelectedSeller(candidate) {
  if (
    !candidate
    || !ID_PATTERN.test(String(candidate.sellerId ?? ""))
    || !ID_PATTERN.test(String(candidate.userId ?? ""))
    || !/^acct_[A-Za-z0-9_]+$/.test(String(candidate.stripeAccountId ?? ""))
    || candidate.databaseEligible !== true
    || candidate.stripeChargesEnabled !== true
    || candidate.stripePayoutsEnabled !== true
    || candidate.stripeFailureBankReady !== true
    || candidate.stripeDeleted !== false
  ) throw new Error("linked payout proof seller is not exactly eligible");
  return Object.freeze({ ...candidate });
}

export function hasRequiredPayoutFailureBank(externalAccounts) {
  return Array.isArray(externalAccounts) && externalAccounts.some((external) => (
    external?.object === "bank_account"
    && external?.currency === "usd"
    && external?.default_for_currency === true
    && external?.last4 === "1116"
  ));
}

export function assertAvailableUsdBalance(balance) {
  const available = Array.isArray(balance?.available) ? balance.available : [];
  const availableUsd = available
    .filter((row) => row?.currency === "usd")
    .reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
  if (!Number.isSafeInteger(availableUsd) || availableUsd < PAYOUT_CENTS) {
    throw new Error("linked payout account lacks reviewed available USD balance");
  }
  return availableUsd;
}

function exactString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

export function assertDeliverySnapshot(snapshot, expected = {}) {
  const normalized = {
    sellerCount: Number(snapshot?.sellerCount),
    webhookCount: Number(snapshot?.webhookCount),
    payoutCount: Number(snapshot?.payoutCount),
    notificationCount: Number(snapshot?.notificationCount),
    webhookType: snapshot?.webhookType,
    webhookProcessed: snapshot?.webhookProcessed,
    webhookErrorClear: snapshot?.webhookErrorClear,
    claimGeneration: String(snapshot?.claimGeneration ?? ""),
    webhookUpdatedEpoch: exactString(snapshot?.webhookUpdatedEpoch, "webhook update time"),
    payoutEventId: exactString(snapshot?.payoutEventId, "payout event id"),
    payoutUpdatedEpoch: exactString(snapshot?.payoutUpdatedEpoch, "payout update time"),
    notificationId: exactString(snapshot?.notificationId, "notification id"),
    notificationDedupKey: exactString(snapshot?.notificationDedupKey, "notification dedup key"),
    latestProjectionId: exactString(snapshot?.latestProjectionId, "latest projection id"),
    runtimeNotificationCount: Number(snapshot?.runtimeNotificationCount),
  };
  if (
    normalized.sellerCount !== 1
    || normalized.webhookCount !== 1
    || normalized.payoutCount !== 1
    || normalized.notificationCount !== 1
    || normalized.webhookType !== "payout.failed"
    || normalized.webhookProcessed !== true
    || normalized.webhookErrorClear !== true
    || normalized.claimGeneration !== "1"
    || normalized.latestProjectionId !== normalized.payoutEventId
    || normalized.runtimeNotificationCount !== 1
    || (expected.payoutEventId && normalized.payoutEventId !== expected.payoutEventId)
    || (expected.notificationId && normalized.notificationId !== expected.notificationId)
  ) throw new Error("linked payout delivery did not reach the exact reviewed state");
  return Object.freeze(normalized);
}

export function assertReplayUnchanged(before, after) {
  const first = assertDeliverySnapshot(before);
  const replay = assertDeliverySnapshot(after, {
    notificationId: first.notificationId,
    payoutEventId: first.payoutEventId,
  });
  for (const key of [
    "claimGeneration",
    "webhookUpdatedEpoch",
    "payoutUpdatedEpoch",
    "notificationDedupKey",
  ]) {
    if (first[key] !== replay[key]) throw new Error(`exact payout retry changed ${key}`);
  }
  return Object.freeze(replay);
}

export function assertCleanupSnapshot(snapshot) {
  const normalized = {
    sellerCount: Number(snapshot?.sellerCount),
    webhookCount: Number(snapshot?.webhookCount),
    webhookProcessed: snapshot?.webhookProcessed,
    payoutCount: Number(snapshot?.payoutCount),
    notificationCount: Number(snapshot?.notificationCount),
  };
  if (
    normalized.sellerCount !== 1
    || normalized.webhookCount !== 1
    || normalized.webhookProcessed !== true
    || normalized.payoutCount !== 0
    || normalized.notificationCount !== 0
  ) throw new Error("linked payout exact cleanup did not reach the reviewed state");
  return Object.freeze(normalized);
}

export function assertState(value, config) {
  const stages = new Set([
    "selected",
    "charged",
    "payout-created",
    "event-ready",
    "delivered",
    "replayed",
    "cleanup-started",
    "cleaned",
  ]);
  if (
    value?.phase !== "seller-payout-event-linked-production-proof-state"
    || !stages.has(value?.stage)
    || value?.commit !== config.expectedCommit
    || Number(value?.ciRunId) !== config.mainCiRunId
    || value?.deploymentId !== config.deploymentId
    || !UUID_V4_PATTERN.test(String(value?.attemptId ?? ""))
    || !Number.isSafeInteger(value?.startedSeconds)
    || value.startedSeconds <= 0
    || !ID_PATTERN.test(String(value?.sellerId ?? ""))
    || !ID_PATTERN.test(String(value?.sellerUserId ?? ""))
    || !/^acct_[A-Za-z0-9_]+$/.test(String(value?.stripeAccountId ?? ""))
  ) throw new Error("linked payout proof recovery state drifted");
  const requiredByStage = {
    charged: ["chargeId"],
    "payout-created": ["chargeId", "payoutId"],
    "event-ready": ["chargeId", "payoutId", "eventId", "eventCreated"],
    delivered: ["chargeId", "payoutId", "eventId", "eventCreated", "payoutEventId", "notificationId"],
    replayed: ["chargeId", "payoutId", "eventId", "eventCreated", "payoutEventId", "notificationId"],
    "cleanup-started": ["chargeId", "payoutId", "eventId", "eventCreated", "payoutEventId", "notificationId"],
    cleaned: ["chargeId", "payoutId", "eventId", "eventCreated", "payoutEventId", "notificationId"],
  };
  const order = [
    "selected",
    "charged",
    "payout-created",
    "event-ready",
    "delivered",
    "replayed",
    "cleanup-started",
    "cleaned",
  ];
  for (const stage of order.slice(1, order.indexOf(value.stage) + 1)) {
    for (const key of requiredByStage[stage] ?? []) exactString(value[key], `state ${key}`);
  }
  if (order.indexOf(value.stage) >= order.indexOf("event-ready")) {
    const eventCreated = Number(value.eventCreated);
    if (
      !/^\d{10}$/.test(value.eventCreated)
      || !Number.isSafeInteger(eventCreated)
      || eventCreated < value.startedSeconds
    ) throw new Error("linked payout proof event timestamp drifted");
  }
  return Object.freeze({ ...value });
}

function readGitState(cwd) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return {
    branch: run(["branch", "--show-current"]),
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  };
}

function verifyGitHubCi(config) {
  const raw = execFileSync("gh", [
    "run", "view", String(config.mainCiRunId), "--json",
    "databaseId,headSha,conclusion,status,workflowName",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parseGitHubCiRun(raw, config.expectedCommit, config.mainCiRunId);
}

function childEnvironment(extra = {}) {
  const environment = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function command(name, args, { cwd, env, label = name, timeout = 60_000 } = {}) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: "utf8",
    env: env ?? childEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

function readVercelEnvironment(config) {
  const raw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "env", "ls", "production", "--json",
    "--cwd", config.vercelProjectDirectory, "--no-color",
  ], {
    cwd: config.vercelProjectDirectory,
    env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}),
    label: "Vercel production environment lookup",
  });
  return JSON.parse(raw);
}

function assertVercelProject(config) {
  const project = JSON.parse(readFileSync(
    path.join(config.vercelProjectDirectory, ".vercel", "project.json"),
    "utf8",
  ));
  for (const [key, expected] of Object.entries(EXPECTED_PROJECT)) {
    if (project?.[key] !== expected) throw new Error("Vercel project identity drifted");
  }
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("production response exceeded bound");
  return value;
}

async function verifyDeployment(config) {
  const inspectRaw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "inspect", config.deploymentId,
    "--json", "--cwd", config.vercelProjectDirectory, "--no-color",
  ], {
    cwd: config.vercelProjectDirectory,
    env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}),
    label: "Vercel production deployment inspection",
  });
  const jsonStart = inspectRaw.indexOf("{");
  if (jsonStart < 0) throw new Error("Vercel deployment inspection returned no JSON");
  const deployment = JSON.parse(inspectRaw.slice(jsonStart));
  if (
    deployment?.id !== config.deploymentId
    || deployment?.target !== "production"
    || deployment?.readyState !== "READY"
    || (deployment?.meta?.githubCommitSha ?? deployment?.meta?.gitCommitSha)
      !== config.expectedCommit
    || !Array.isArray(deployment?.alias)
    || REQUIRED_ALIASES.some((alias) => !deployment.alias.includes(alias))
  ) throw new Error("Vercel production deployment identity drifted");
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const healthBody = JSON.parse(await boundedText(health, MAX_EVIDENCE_BYTES));
  if (health.status !== 200 || healthBody?.ok !== true) throw new Error("production health failed");
  const page = await fetch(PRODUCTION_ORIGIN, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const body = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("canonical alias is not the reviewed deployment");
  }
  return { canonicalDeploymentMarker: true, healthStatus: 200 };
}

function postgresClient(connectionString, applicationName) {
  const parsed = new URL(connectionString);
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
}

async function verifyDatabaseIdentity(owner, runtime) {
  const [ownerIdentity, runtimeIdentity] = await Promise.all([
    owner.query("SELECT current_user AS role, current_database() AS database"),
    runtime.query("SELECT current_user AS role, current_database() AS database"),
  ]);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
}

async function selectSeller(owner, stripe) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const readOnly = await owner.query("SELECT current_setting('transaction_read_only') AS value");
    assert.deepEqual(readOnly.rows, [{ value: "on" }]);
    const candidates = await owner.query(`
      SELECT seller.id AS "sellerId", seller."userId", seller."stripeAccountId"
        FROM public."SellerProfile" AS seller
        JOIN public."User" AS account ON account.id = seller."userId"
       WHERE seller."stripeAccountId" IS NOT NULL
         AND seller."chargesEnabled" = true
         AND seller."vacationMode" = false
         AND account.banned = false
         AND account."deletedAt" IS NULL
       ORDER BY seller.id
       LIMIT 5
    `);
    await owner.query("ROLLBACK");
    for (const row of candidates.rows) {
      try {
        const account = await stripe.accounts.retrieve(row.stripeAccountId, {
          expand: ["external_accounts"],
        });
        const externalAccounts = account?.external_accounts?.data ?? [];
        const candidate = {
          ...row,
          databaseEligible: true,
          stripeChargesEnabled: account?.charges_enabled === true,
          stripeDeleted: account?.deleted === true,
          stripeFailureBankReady: hasRequiredPayoutFailureBank(externalAccounts),
          stripePayoutsEnabled: account?.payouts_enabled === true,
        };
        if (
          candidate.stripeChargesEnabled
          && candidate.stripePayoutsEnabled
          && candidate.stripeFailureBankReady
          && !candidate.stripeDeleted
        ) return assertSelectedSeller(candidate);
      } catch {
        // Continue through the bounded candidate set without surfacing identifiers.
      }
    }
    throw new Error("no eligible linked Stripe test-mode seller was available");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function ownerSnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."SellerProfile"
          WHERE id = $1 AND "userId" = $2 AND "stripeAccountId" = $3) AS "sellerCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent"
          WHERE id = $4 AND type = 'payout.failed' AND "sourceObjectId" = $5) AS "webhookCount",
        (SELECT type FROM public."StripeWebhookEvent" WHERE id = $4) AS "webhookType",
        (SELECT "processedAt" IS NOT NULL FROM public."StripeWebhookEvent" WHERE id = $4) AS "webhookProcessed",
        (SELECT "lastError" IS NULL FROM public."StripeWebhookEvent" WHERE id = $4) AS "webhookErrorClear",
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id = $4) AS "claimGeneration",
        (SELECT extract(epoch FROM "updatedAt" AT TIME ZONE 'UTC')::text
           FROM public."StripeWebhookEvent" WHERE id = $4) AS "webhookUpdatedEpoch",
        (SELECT count(*)::integer FROM public."SellerPayoutEvent"
          WHERE "stripePayoutId" = $5 AND "sellerProfileId" = $1 AND "stripeEventId" = $4) AS "payoutCount",
        (SELECT id FROM public."SellerPayoutEvent" WHERE "stripePayoutId" = $5) AS "payoutEventId",
        (SELECT extract(epoch FROM "updatedAt" AT TIME ZONE 'UTC')::text
           FROM public."SellerPayoutEvent" WHERE "stripePayoutId" = $5) AS "payoutUpdatedEpoch",
        (SELECT count(*)::integer FROM public."Notification" AS notification
          JOIN public."SellerPayoutEvent" AS payout ON payout.id = notification."sourceId"
         WHERE payout."stripePayoutId" = $5
           AND notification."sourceType" = 'stripe_payout_failure'
           AND notification.type = 'PAYOUT_FAILED'
           AND notification."userId" = $2) AS "notificationCount",
        (SELECT notification.id FROM public."Notification" AS notification
          JOIN public."SellerPayoutEvent" AS payout ON payout.id = notification."sourceId"
         WHERE payout."stripePayoutId" = $5
           AND notification."sourceType" = 'stripe_payout_failure'
           AND notification.type = 'PAYOUT_FAILED'
           AND notification."userId" = $2) AS "notificationId",
        (SELECT notification."dedupKey" FROM public."Notification" AS notification
          JOIN public."SellerPayoutEvent" AS payout ON payout.id = notification."sourceId"
         WHERE payout."stripePayoutId" = $5
           AND notification."sourceType" = 'stripe_payout_failure'
           AND notification.type = 'PAYOUT_FAILED'
           AND notification."userId" = $2) AS "notificationDedupKey"
    `, [state.sellerId, state.sellerUserId, state.stripeAccountId, state.eventId, state.payoutId]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function runtimeSnapshot(runtime, state) {
  await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const readOnly = await runtime.query("SELECT current_setting('transaction_read_only') AS value");
    assert.deepEqual(readOnly.rows, [{ value: "on" }]);
    const context = await runtime.query(
      "SELECT set_config('app.user_id', $1, true) AS value",
      [state.sellerUserId],
    );
    assert.deepEqual(context.rows, [{ value: state.sellerUserId }]);
    const result = await runtime.query(`
      SELECT
        (SELECT payout_event_id FROM public.grainline_seller_payout_latest_failure($1))
          AS "latestProjectionId",
        (SELECT count(*)::integer FROM public."Notification"
          WHERE "userId" = $1
            AND "sourceType" = 'stripe_payout_failure'
            AND "sourceId" = $2
            AND type = 'PAYOUT_FAILED') AS "runtimeNotificationCount"
    `, [state.sellerUserId, state.payoutEventId]);
    await runtime.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await runtime.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function deliverySnapshot(owner, runtime, state) {
  const ownerRow = await ownerSnapshot(owner, state);
  const payoutEventId = ownerRow?.payoutEventId;
  const runtimeRow = payoutEventId
    ? await runtimeSnapshot(runtime, { ...state, payoutEventId })
    : { latestProjectionId: null, runtimeNotificationCount: 0 };
  return { ...ownerRow, ...runtimeRow };
}

async function cleanupExactRows(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const payout = await owner.query(`
      SELECT payout.id
        FROM public."SellerPayoutEvent" AS payout
        JOIN public."SellerProfile" AS seller ON seller.id = payout."sellerProfileId"
        JOIN public."StripeWebhookEvent" AS event ON event.id = payout."stripeEventId"
       WHERE payout.id = $1
         AND payout."stripePayoutId" = $2
         AND payout."stripeEventId" = $3
         AND seller.id = $4
         AND seller."userId" = $5
         AND seller."stripeAccountId" = $6
         AND event.type = 'payout.failed'
         AND event."sourceObjectId" = $2
         AND event."processedAt" IS NOT NULL
       FOR UPDATE OF payout, seller, event
    `, [
      state.payoutEventId,
      state.payoutId,
      state.eventId,
      state.sellerId,
      state.sellerUserId,
      state.stripeAccountId,
    ]);
    if (payout.rowCount !== 1) throw new Error("exact payout cleanup source relationship drifted");
    const notification = await owner.query(`
      SELECT id, "userId", type, "sourceType", "sourceId", "relatedUserId"
       FROM public."Notification"
       WHERE "sourceType" = 'stripe_payout_failure'
         AND "sourceId" = $1
       FOR UPDATE
    `, [state.payoutEventId]);
    if (
      notification.rowCount !== 1
      || notification.rows[0]?.id !== state.notificationId
      || notification.rows[0]?.userId !== state.sellerUserId
      || notification.rows[0]?.type !== "PAYOUT_FAILED"
      || notification.rows[0]?.sourceType !== "stripe_payout_failure"
      || notification.rows[0]?.sourceId !== state.payoutEventId
      || notification.rows[0]?.relatedUserId !== null
    ) throw new Error("exact payout notification cleanup scope drifted");
    const deletedNotification = await owner.query(
      `DELETE FROM public."Notification" WHERE id = $1 RETURNING id`,
      [state.notificationId],
    );
    const deletedPayout = await owner.query(
      `DELETE FROM public."SellerPayoutEvent" WHERE id = $1 RETURNING id`,
      [state.payoutEventId],
    );
    if (deletedNotification.rowCount !== 1 || deletedPayout.rowCount !== 1) {
      throw new Error("exact payout cleanup cardinality drifted");
    }
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function readCleanupSnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."SellerProfile"
          WHERE id = $1 AND "userId" = $2 AND "stripeAccountId" = $3) AS "sellerCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent"
          WHERE id = $4 AND type = 'payout.failed' AND "sourceObjectId" = $5) AS "webhookCount",
        (SELECT "processedAt" IS NOT NULL FROM public."StripeWebhookEvent" WHERE id = $4)
          AS "webhookProcessed",
        (SELECT count(*)::integer FROM public."SellerPayoutEvent" WHERE id = $6) AS "payoutCount",
        (SELECT count(*)::integer FROM public."Notification" WHERE id = $7) AS "notificationCount"
    `, [
      state.sellerId,
      state.sellerUserId,
      state.stripeAccountId,
      state.eventId,
      state.payoutId,
      state.payoutEventId,
      state.notificationId,
    ]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") {
    return listPromise.autoPagingToArray({ limit: 1000 });
  }
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

function stripeDependencies(stripe, secretKey, config, attemptId) {
  const sourceOptions = (key, accountId) => ({
    idempotencyKey: `grainline-linked-payout-${config.expectedCommit}-${attemptId}-${key}`,
    ...(accountId ? { stripeAccount: accountId } : {}),
  });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({
      include: ["webhook_endpoint.url"], limit: 100,
    })),
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
    createFundingCharge: (accountId) => stripe.charges.create({
      amount: FUNDING_CHARGE_CENTS,
      currency: "usd",
      description: "Grainline linked payout authority proof funding",
      metadata: { grainline_linked_payout_proof: sha256(`${config.expectedCommit}:${attemptId}`) },
      source: "tok_bypassPending",
    }, sourceOptions("funding-charge", accountId)),
    createPayout: (accountId) => stripe.payouts.create({
      amount: PAYOUT_CENTS,
      currency: "usd",
      description: "Grainline linked payout authority proof",
      metadata: { grainline_linked_payout_proof: sha256(`${config.expectedCommit}:${attemptId}`) },
      method: "standard",
    }, sourceOptions("failed-payout", accountId)),
    retrieveBalance: (accountId) => stripe.balance.retrieve({ stripeAccount: accountId }),
    retrievePayout: (accountId, id) => stripe.payouts.retrieve(id, { stripeAccount: accountId }),
    listPayoutFailedEvents: (accountId, createdAfter) => listAll(stripe.events.list(
      { created: { gte: createdAfter }, limit: 100, type: "payout.failed" },
      { stripeAccount: accountId },
    )),
    resendEvent({ accountId, endpointId, eventId }) {
      const cliConfigRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-linked-payout-cli-"));
      try {
        const cliEnvironment = childEnvironment({
          STRIPE_API_KEY: secretKey,
          XDG_CONFIG_HOME: cliConfigRoot,
        });
        const version = command(config.stripeCliPath, ["version", "--color", "off"], {
          env: cliEnvironment,
          label: "Stripe CLI version check",
        });
        const first = String(version).trim().split("\n")[0];
        if (first !== `stripe version ${STRIPE_CLI_VERSION}`) {
          throw new Error(`Stripe CLI version drifted from ${STRIPE_CLI_VERSION}`);
        }
        command(config.stripeCliPath, [
          "events", "resend", eventId,
          "--webhook-endpoint", endpointId,
          "--account", accountId,
          "--confirm", "--color", "off",
        ], { env: cliEnvironment, label: "Stripe exact linked payout resend" });
      } finally {
        rmSync(cliConfigRoot, { force: true, recursive: true });
      }
    },
  };
}

async function waitFor(read, accept, label, attempts = 40, delayMs = 1500) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await read();
    if (accept(latest)) return latest;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} did not reach the reviewed state`);
}

function updateState(config, state, update) {
  const next = assertState({ ...state, ...update }, config);
  replacePrivateJson(config.statePath, next);
  return next;
}

function buildEvidence(config, state, delivery, cleanup, provider) {
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    phase: "seller-payout-event-linked-production-proof",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    ciRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
    providerStage: provider.stage,
    stripe: {
      connectedAccountIdSha256: sha256(state.stripeAccountId),
      chargeIdSha256: sha256(state.chargeId),
      payoutIdSha256: sha256(state.payoutId),
      eventIdSha256: sha256(state.eventId),
      eventType: "payout.failed",
      failureCode: REQUIRED_FAILURE_CODE,
      amountCents: PAYOUT_CENTS,
      exactRetrySent: true,
    },
    database: {
      sellerIdSha256: sha256(state.sellerId),
      sellerUserIdSha256: sha256(state.sellerUserId),
      payoutEventIdSha256: sha256(state.payoutEventId),
      notificationIdSha256: sha256(state.notificationId),
      webhookLeaseRetained: cleanup.webhookCount === 1,
      payoutFixtureRemoved: cleanup.payoutCount === 0,
      notificationFixtureRemoved: cleanup.notificationCount === 0,
      linkedDeliveryCount: delivery.payoutCount,
      linkedNotificationCount: delivery.notificationCount,
      exactRetryLeftAllIdentitiesUnchanged: true,
      runtimeRole: RUNTIME_ROLE,
    },
    productionChangedByProof: true,
    productionChangeAfterCleanup: "one processed test-mode StripeWebhookEvent lease retained",
    providerConfigurationChanged: false,
    sellerChanged: false,
    liveMoneyMoved: false,
    rawIdentifiersPersistedInEvidence: false,
    secretsPersistedInEvidence: false,
    nextBoundary: "predecessor deployment drain and zero-direct-access proof",
  });
}

function assertEvidence(value, config) {
  const hex = /^[a-f0-9]{64}$/;
  if (
    value?.phase !== "seller-payout-event-linked-production-proof"
    || value?.status !== "passed"
    || value?.mode !== "test"
    || value?.commit !== config.expectedCommit
    || Number(value?.ciRunId) !== config.mainCiRunId
    || value?.deploymentId !== config.deploymentId
    || value?.providerStage !== 4
    || value?.stripe?.eventType !== "payout.failed"
    || value?.stripe?.failureCode !== REQUIRED_FAILURE_CODE
    || value?.stripe?.amountCents !== PAYOUT_CENTS
    || value?.stripe?.exactRetrySent !== true
    || !hex.test(value?.stripe?.connectedAccountIdSha256 ?? "")
    || !hex.test(value?.stripe?.chargeIdSha256 ?? "")
    || !hex.test(value?.stripe?.payoutIdSha256 ?? "")
    || !hex.test(value?.stripe?.eventIdSha256 ?? "")
    || !hex.test(value?.database?.sellerIdSha256 ?? "")
    || !hex.test(value?.database?.sellerUserIdSha256 ?? "")
    || !hex.test(value?.database?.payoutEventIdSha256 ?? "")
    || !hex.test(value?.database?.notificationIdSha256 ?? "")
    || value?.database?.webhookLeaseRetained !== true
    || value?.database?.payoutFixtureRemoved !== true
    || value?.database?.notificationFixtureRemoved !== true
    || value?.database?.linkedDeliveryCount !== 1
    || value?.database?.linkedNotificationCount !== 1
    || value?.database?.exactRetryLeftAllIdentitiesUnchanged !== true
    || value?.database?.runtimeRole !== RUNTIME_ROLE
    || value?.productionChangedByProof !== true
    || value?.productionChangeAfterCleanup
      !== "one processed test-mode StripeWebhookEvent lease retained"
    || value?.providerConfigurationChanged !== false
    || value?.sellerChanged !== false
    || value?.liveMoneyMoved !== false
    || value?.rawIdentifiersPersistedInEvidence !== false
    || value?.secretsPersistedInEvidence !== false
  ) throw new Error("linked payout proof evidence drifted");
  return Object.freeze(value);
}

export async function runSellerPayoutLinkedProductionProof({
  env = process.env,
  dependencies = {},
} = {}) {
  const config = validateConfiguration(env);
  if (existsSync(config.evidencePath)) {
    const completed = assertEvidence(
      readPrivateJson(config.evidencePath, "linked payout evidence"),
      config,
    );
    if (existsSync(config.statePath)) {
      const retainedState = assertState(
        readPrivateJson(config.statePath, "linked payout recovery state"),
        config,
      );
      if (
        retainedState.stage !== "cleaned"
        || sha256(retainedState.stripeAccountId)
          !== completed.stripe.connectedAccountIdSha256
        || sha256(retainedState.chargeId) !== completed.stripe.chargeIdSha256
        || sha256(retainedState.payoutId) !== completed.stripe.payoutIdSha256
        || sha256(retainedState.eventId) !== completed.stripe.eventIdSha256
        || sha256(retainedState.sellerId) !== completed.database.sellerIdSha256
        || sha256(retainedState.sellerUserId) !== completed.database.sellerUserIdSha256
        || sha256(retainedState.payoutEventId) !== completed.database.payoutEventIdSha256
        || sha256(retainedState.notificationId) !== completed.database.notificationIdSha256
      ) throw new Error("completed evidence does not bind retained cleanup state");
      unlinkSync(config.statePath);
    }
    return completed;
  }
  const cwd = path.resolve(config.vercelProjectDirectory);
  assertGitState((dependencies.readGitState ?? readGitState)(cwd), config.expectedCommit);
  (dependencies.verifyGitHubCi ?? verifyGitHubCi)(config);
  (dependencies.assertVercelProject ?? assertVercelProject)(config);
  assertSensitiveProductionVariable(
    await (dependencies.readVercelEnvironment ?? readVercelEnvironment)(config),
  );
  await (dependencies.verifyDeployment ?? verifyDeployment)(config);

  const localValues = dependencies.localValues
    ?? readPrivateEnvironment(LOCAL_ENV_PATH, "runtime environment");
  const ownerValues = dependencies.ownerValues
    ?? readPrivateEnvironment(OWNER_ENV_PATH, "owner environment");
  const { ownerDatabaseUrl, runtimeDatabaseUrl } = parseDatabaseUrls(localValues, ownerValues);
  const secretKey = validateStripeSecret(localValues);
  const stripe = dependencies.stripe ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  const owner = dependencies.owner ?? postgresClient(
    ownerDatabaseUrl,
    "grainline-seller-payout-linked-proof-owner",
  );
  const runtime = dependencies.runtime ?? postgresClient(
    runtimeDatabaseUrl,
    "grainline-seller-payout-linked-proof-runtime",
  );
  await owner.connect();
  await runtime.connect();
  let state;
  try {
    await verifyDatabaseIdentity(owner, runtime);
    if (existsSync(config.statePath)) {
      state = assertState(readPrivateJson(config.statePath, "linked payout recovery state"), config);
    } else {
      const candidate = await (dependencies.selectSeller ?? selectSeller)(owner, stripe);
      state = assertState({
        phase: "seller-payout-event-linked-production-proof-state",
        stage: "selected",
        commit: config.expectedCommit,
        ciRunId: config.mainCiRunId,
        deploymentId: config.deploymentId,
        attemptId: randomUUID(),
        startedSeconds: Math.floor(Date.now() / 1000) - 5,
        sellerId: candidate.sellerId,
        sellerUserId: candidate.userId,
        stripeAccountId: candidate.stripeAccountId,
      }, config);
      writePrivateJson(config.statePath, state);
    }
    const stripeOps = dependencies.stripeOps
      ?? stripeDependencies(stripe, secretKey, config, state.attemptId);
    const provider = await readProviderState(stripeOps);
    if (
      provider.stage !== 4
      || provider.connect.url !== CONNECT_URL
    ) throw new Error("linked payout proof requires exact provider stage 4");

    if (state.stage === "selected") {
      const charge = await stripeOps.createFundingCharge(state.stripeAccountId);
      if (charge?.paid !== true || charge?.status !== "succeeded" || charge?.livemode !== false) {
        throw new Error("linked payout funding charge did not settle");
      }
      state = updateState(config, state, { stage: "charged", chargeId: charge.id });
    }
    if (state.stage === "charged") {
      const balance = await stripeOps.retrieveBalance(state.stripeAccountId);
      assertAvailableUsdBalance(balance);
      const payout = await stripeOps.createPayout(state.stripeAccountId);
      if (!payout?.id || payout.livemode !== false) throw new Error("linked test payout was not created");
      state = updateState(config, state, { stage: "payout-created", payoutId: payout.id });
    }
    if (state.stage === "payout-created") {
      const payout = await waitFor(
        () => stripeOps.retrievePayout(state.stripeAccountId, state.payoutId),
        (row) => row?.status === "failed",
        "linked payout failure",
        60,
        3000,
      );
      if (
        payout.failure_code !== REQUIRED_FAILURE_CODE
        || payout.amount !== PAYOUT_CENTS
        || payout.currency !== "usd"
        || payout.livemode !== false
      ) throw new Error("linked payout failure shape drifted");
      const events = await waitFor(
        () => stripeOps.listPayoutFailedEvents(state.stripeAccountId, state.startedSeconds),
        (rows) => rows.some((row) => row?.data?.object?.id === state.payoutId),
        "linked payout.failed event",
      );
      const matches = events.filter((row) => row?.data?.object?.id === state.payoutId);
      if (matches.length !== 1 || matches[0]?.type !== "payout.failed") {
        throw new Error("linked payout source event cardinality drifted");
      }
      state = updateState(config, state, {
        stage: "event-ready",
        eventCreated: String(matches[0].created),
        eventId: matches[0].id,
      });
    }
    let delivered;
    if (state.stage === "event-ready") {
      delivered = assertDeliverySnapshot(await waitFor(
        () => deliverySnapshot(owner, runtime, state),
        (row) => Number(row?.notificationCount) === 1 && row?.webhookProcessed === true,
        "linked payout application delivery",
      ));
      state = updateState(config, state, {
        stage: "delivered",
        notificationId: delivered.notificationId,
        payoutEventId: delivered.payoutEventId,
      });
    } else if (new Set(["delivered", "replayed"]).has(state.stage)) {
      delivered = assertDeliverySnapshot(await deliverySnapshot(owner, runtime, state), {
        notificationId: state.notificationId,
        payoutEventId: state.payoutEventId,
      });
    } else {
      delivered = Object.freeze({ notificationCount: 1, payoutCount: 1 });
    }
    if (state.stage === "delivered") {
      await stripeOps.resendEvent({
        accountId: state.stripeAccountId,
        endpointId: provider.connect.id,
        eventId: state.eventId,
      });
      const replay = await waitFor(
        () => deliverySnapshot(owner, runtime, state),
        (row) => {
          try {
            assertReplayUnchanged(delivered, row);
            return true;
          } catch {
            return false;
          }
        },
        "exact linked payout retry",
        20,
        1000,
      );
      assertReplayUnchanged(delivered, replay);
      state = updateState(config, state, { stage: "replayed" });
    } else if (state.stage === "replayed") {
      assertDeliverySnapshot(await deliverySnapshot(owner, runtime, state), {
        notificationId: state.notificationId,
        payoutEventId: state.payoutEventId,
      });
    }
    if (state.stage === "replayed") {
      state = updateState(config, state, { stage: "cleanup-started" });
    }
    const readCleanup = dependencies.readCleanupSnapshot ?? readCleanupSnapshot;
    if (state.stage === "cleanup-started") {
      const beforeCleanup = await readCleanup(owner, state);
      const exactPending =
        Number(beforeCleanup?.sellerCount) === 1
        && Number(beforeCleanup?.webhookCount) === 1
        && beforeCleanup?.webhookProcessed === true
        && Number(beforeCleanup?.payoutCount) === 1
        && Number(beforeCleanup?.notificationCount) === 1;
      if (exactPending) {
        await (dependencies.cleanupExactRows ?? cleanupExactRows)(owner, state);
      } else {
        assertCleanupSnapshot(beforeCleanup);
      }
      assertCleanupSnapshot(await readCleanup(owner, state));
      state = updateState(config, state, { stage: "cleaned" });
    }
    const cleanup = assertCleanupSnapshot(await readCleanup(owner, state));
    const finalProvider = await readProviderState(stripeOps);
    if (finalProvider.stage !== 4) throw new Error("provider topology drifted during linked proof");
    await (dependencies.verifyDeployment ?? verifyDeployment)(config);
    const evidence = assertEvidence(buildEvidence(config, state, delivered, cleanup, finalProvider), config);
    writePrivateJson(config.evidencePath, evidence);
    unlinkSync(config.statePath);
    return evidence;
  } finally {
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

async function main() {
  try {
    const result = await runSellerPayoutLinkedProductionProof();
    process.stdout.write(`${JSON.stringify({
      ciRunId: result.ciRunId,
      commit: result.commit,
      deploymentId: result.deploymentId,
      phase: result.phase,
      status: result.status,
    })}\n`);
  } catch (error) {
    process.stderr.write(`SellerPayoutEvent linked production proof failed closed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
