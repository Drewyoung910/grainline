#!/usr/bin/env node
// Restart-safe production proof for the blocked-checkout refund-delivery path.
// Review/merge does not authorize execution. The operator is Stripe test-mode
// only and requires a human/browser to complete one genuine Embedded Checkout.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
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
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import { Redis } from "@upstash/redis";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { readProviderState } from "./stripe-connect-provider-cutover.mjs";
import {
  assertGitState,
  parseDatabaseUrls,
  parseGitHubCiRun,
  parseVercelDeployment,
  validateStripeSecret,
} from "./seller-payout-event-linked-production-proof.mjs";

const { Client } = pg;

export const CONFIRMATION = "reviewed-blocked-checkout-refund-production-proof";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PLATFORM_WEBHOOK_URL = `${PRODUCTION_ORIGIN}/api/stripe/webhook`;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const PRICE_CENTS = 500;
export const SELLER_TRANSFER_CENTS = 475;
export const TERMS_VERSION = "2026-06-14";
export const STRIPE_METADATA_KEY_MAX_LENGTH = 40;
export const CONNECTED_ACCOUNT_MARKER_KEY = "grainline_blocked_checkout_proof";
export const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);

const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_CLI_VERSION = "1.39.0";
const VERCEL_CLI_VERSION = "58.9.0";
const CLERK_FRONTEND_API = "clerk.thegrainline.com";
const MAX_PRIVATE_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|cs_test_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_PATTERN = /\b(?:acct|ch|cs|evt|pi|re|tr|trr|we)_[A-Za-z0-9_]+\b/g;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const DATABASE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const FIXTURE_PATTERN = /\bopebc_[a-f0-9]{32}(?:_[a-z_]+)?\b/g;
const EXPECTED_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});
const ADDRESS = Object.freeze({
  name: "Grainline Operational Canary",
  line1: "100 N State St",
  line2: null,
  city: "Chicago",
  state: "IL",
  postalCode: "60602",
  phone: null,
});
const STAGES = Object.freeze([
  "reserved",
  "account-create-pending",
  "account-created",
  "fixtures-create-pending",
  "fixtures-created",
  "checkout-create-pending",
  "checkout-created",
  "seller-blocked",
  "payment-completed",
  "delivery-confirmed",
  "replay-pending",
  "replayed",
  "cleanup-started",
  "cleaned",
]);

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

export function redact(value) {
  return String(value ?? "")
    .replace(DATABASE_URL_PATTERN, "[redacted-database-url]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(STRIPE_OBJECT_PATTERN, "[redacted-stripe-object]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]")
    .replace(FIXTURE_PATTERN, "[redacted-fixture-id]");
}

function safeError(error) {
  return redact(error instanceof Error ? error.message || error.name : error);
}

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
  if (stat.size > MAX_PRIVATE_BYTES) throw new Error(`${label} exceeded its size bound`);
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return value;
}

function writePrivateJson(filePath, value) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
}

function loadPrivateEnvironment(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  return parseDotenv(readFileSync(filePath, "utf8"));
}

export function validateConfiguration(env = process.env, cwd = process.cwd()) {
  const command = env.ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND || "prepare";
  if (!new Set(["prepare", "serve", "verify", "cleanup"]).has(command)) {
    throw new Error("blocked-checkout proof command is invalid");
  }
  if (required(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_CONFIRM") !== CONFIRMATION) {
    throw new Error("blocked-checkout proof confirmation is invalid");
  }
  const expectedCommit = required(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_EXPECTED_COMMIT");
  const deployedSourceCommit = required(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_DEPLOYED_SOURCE_COMMIT");
  if (!COMMIT_PATTERN.test(expectedCommit) || !COMMIT_PATTERN.test(deployedSourceCommit)) {
    throw new Error("blocked-checkout proof commit input is invalid");
  }
  const deploymentId = required(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_DEPLOYMENT_ID");
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("blocked-checkout proof deployment ID is invalid");
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_MAIN_CI_RUN_ID");
  const operatorCommitInput = env.ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_COMMIT || null;
  const operatorCiRunIdInput = env.ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID || null;
  if (Boolean(operatorCommitInput) !== Boolean(operatorCiRunIdInput)) {
    throw new Error("blocked-checkout operator recovery commit and CI must be supplied together");
  }
  const operatorCommit = operatorCommitInput || expectedCommit;
  const operatorCiRunId = operatorCiRunIdInput
    ? positiveInteger(env, "ORDER_PAYMENT_BLOCKED_CHECKOUT_OPERATOR_CI_RUN_ID")
    : mainCiRunId;
  if (!COMMIT_PATTERN.test(operatorCommit)) {
    throw new Error("blocked-checkout operator recovery commit input is invalid");
  }
  if ((operatorCommit !== expectedCommit) !== (operatorCiRunId !== mainCiRunId)) {
    throw new Error("blocked-checkout operator recovery must replace both commit and CI bindings");
  }
  const suffix = expectedCommit.slice(0, 12);
  const statePath = path.resolve(env.ORDER_PAYMENT_BLOCKED_CHECKOUT_STATE_PATH
    || path.join(EVIDENCE_DIRECTORY, `order-payment-event-blocked-checkout-state-${suffix}.json`));
  const evidencePath = path.resolve(env.ORDER_PAYMENT_BLOCKED_CHECKOUT_EVIDENCE_PATH
    || path.join(EVIDENCE_DIRECTORY, `order-payment-event-blocked-checkout-proof-${suffix}.json`));
  for (const [candidate, basename] of [
    [statePath, `order-payment-event-blocked-checkout-state-${suffix}.json`],
    [evidencePath, `order-payment-event-blocked-checkout-proof-${suffix}.json`],
  ]) {
    if (path.dirname(candidate) !== EVIDENCE_DIRECTORY || path.basename(candidate) !== basename) {
      throw new Error("blocked-checkout proof file path is outside the reviewed evidence boundary");
    }
  }
  const port = Number(env.ORDER_PAYMENT_BLOCKED_CHECKOUT_PORT || 43117);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("blocked-checkout proof loopback port is invalid");
  }
  return Object.freeze({
    command,
    cwd,
    deployedSourceCommit,
    deploymentId,
    evidencePath,
    expectedCommit,
    mainCiRunId,
    operatorCiRunId,
    operatorCommit,
    port,
    statePath,
    stripeCliPath: path.resolve(env.ORDER_PAYMENT_BLOCKED_CHECKOUT_STRIPE_CLI_PATH || "/opt/homebrew/bin/stripe"),
    vercelProjectDirectory: path.resolve(env.VERCEL_PROJECT_DIRECTORY || "/Users/drewyoung/grainline"),
  });
}

function fixtureId(suffix = "") {
  return `opebc_${randomUUID().replaceAll("-", "")}${suffix}`;
}

function normalizedTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && DATABASE_TIMESTAMP_PATTERN.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("blocked-checkout canary timestamp drifted");
  return date.toISOString();
}

export function createInitialState(config, canary) {
  return assertState({
    version: 1,
    stage: "reserved",
    expectedCommit: config.expectedCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    mainCiRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
    attemptId: randomUUID(),
    startedAt: new Date().toISOString(),
    buyerId: canary.id,
    buyerClerkId: canary.clerkId,
    buyerEmail: canary.email,
    originalNotificationPreferences: canary.notificationPreferences,
    originalTermsAcceptedAt: normalizedTimestamp(canary.termsAcceptedAt),
    originalTermsVersion: canary.termsVersion,
    originalAgeAttestedAt: normalizedTimestamp(canary.ageAttestedAt),
    sellerUserId: fixtureId("_seller_user"),
    sellerClerkId: fixtureId("_seller_clerk"),
    sellerProfileId: fixtureId("_seller"),
    sellerEmail: `${fixtureId("_seller")}@example.invalid`,
    listingId: fixtureId("_listing"),
    stripeAccountId: null,
    stripeSessionId: null,
    stripeClientSecret: null,
    checkoutLockKey: null,
    reservationId: null,
    checkoutEventId: null,
    orderId: null,
    orderItemId: null,
    paymentIntentId: null,
    chargeId: null,
    transferId: null,
    chargeAmountCents: null,
    refundId: null,
    refundAmountCents: null,
    transferReversalId: null,
    refundEventId: null,
    localPaymentEventId: null,
    signedPaymentEventId: null,
    notificationId: null,
    emailOutboxId: null,
  }, config);
}

function nullableId(value, pattern, label) {
  if (value === null) return;
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`blocked-checkout ${label} is invalid`);
}

export function assertState(value, config) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("blocked-checkout state must be one object");
  if (value.version !== 1 || !STAGES.includes(value.stage)) throw new Error("blocked-checkout state version or stage drifted");
  const allowed = new Set([
    "version", "stage", "expectedCommit", "deployedSourceCommit", "mainCiRunId", "deploymentId",
    "attemptId", "startedAt", "buyerId", "buyerClerkId", "buyerEmail",
    "originalNotificationPreferences", "originalTermsAcceptedAt", "originalTermsVersion", "originalAgeAttestedAt",
    "sellerUserId", "sellerClerkId", "sellerProfileId", "sellerEmail", "listingId",
    "stripeAccountId", "stripeSessionId", "stripeClientSecret", "checkoutLockKey", "reservationId",
    "checkoutEventId", "orderId", "orderItemId", "paymentIntentId", "chargeId", "transferId",
    "chargeAmountCents", "refundId", "refundAmountCents", "transferReversalId", "refundEventId", "localPaymentEventId", "signedPaymentEventId",
    "notificationId", "emailOutboxId",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`blocked-checkout state contains unknown field ${unknown[0]}`);
  for (const [key, expected] of Object.entries({
    expectedCommit: config.expectedCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    mainCiRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
  })) if (String(value[key]) !== String(expected)) throw new Error(`blocked-checkout state ${key} drifted`);
  if (!/^[a-f0-9-]{36}$/.test(String(value.attemptId)) || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error("blocked-checkout state attempt identity drifted");
  }
  if (!/^user_[A-Za-z0-9]+$/.test(value.buyerClerkId)) throw new Error("blocked-checkout canary Clerk identity is invalid");
  for (const key of ["buyerId", "sellerUserId", "sellerClerkId", "sellerProfileId", "listingId"]) {
    if (typeof value[key] !== "string" || value[key].length < 8 || value[key].length > 191) {
      throw new Error(`blocked-checkout state ${key} is invalid`);
    }
  }
  if (typeof value.buyerEmail !== "string" || value.buyerEmail.length < 3 || value.buyerEmail.length > 254
    || typeof value.sellerEmail !== "string" || !/^opebc_[a-f0-9]{32}_seller@example\.invalid$/.test(value.sellerEmail)) {
    throw new Error("blocked-checkout state email identity is invalid");
  }
  if (!value.originalNotificationPreferences || typeof value.originalNotificationPreferences !== "object"
    || Array.isArray(value.originalNotificationPreferences)
    || Buffer.byteLength(JSON.stringify(value.originalNotificationPreferences), "utf8") > 16_384) {
    throw new Error("blocked-checkout canary preference snapshot drifted");
  }
  for (const key of ["originalTermsAcceptedAt", "originalAgeAttestedAt"]) {
    if (value[key] !== null && (typeof value[key] !== "string" || !Number.isFinite(Date.parse(value[key])))) {
      throw new Error("blocked-checkout canary timestamp snapshot drifted");
    }
  }
  if (value.originalTermsVersion !== null
    && (typeof value.originalTermsVersion !== "string" || value.originalTermsVersion.length > 50)) {
    throw new Error("blocked-checkout canary terms snapshot drifted");
  }
  const fixtureShapes = {
    sellerUserId: /^opebc_[a-f0-9]{32}_seller_user$/,
    sellerClerkId: /^opebc_[a-f0-9]{32}_seller_clerk$/,
    sellerProfileId: /^opebc_[a-f0-9]{32}_seller$/,
    listingId: /^opebc_[a-f0-9]{32}_listing$/,
  };
  for (const [key, pattern] of Object.entries(fixtureShapes)) {
    if (!pattern.test(value[key])) throw new Error(`blocked-checkout state ${key} is not a disposable fixture identity`);
  }
  nullableId(value.stripeAccountId, /^acct_[A-Za-z0-9_]+$/, "Stripe account");
  nullableId(value.stripeSessionId, /^cs_test_[A-Za-z0-9_]+$/, "Checkout Session");
  nullableId(value.stripeClientSecret, /^cs_test_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/, "Checkout client secret");
  for (const [key, prefix] of [["checkoutEventId", "evt"], ["refundEventId", "evt"], ["paymentIntentId", "pi"],
    ["chargeId", "ch"], ["transferId", "tr"], ["refundId", "re"], ["transferReversalId", "trr"]]) {
    nullableId(value[key], new RegExp(`^${prefix}_[A-Za-z0-9_]+$`), key);
  }
  for (const key of ["checkoutLockKey", "reservationId", "orderId", "orderItemId", "localPaymentEventId",
    "signedPaymentEventId", "notificationId", "emailOutboxId"]) {
    if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 255)) {
      throw new Error(`blocked-checkout state ${key} is invalid`);
    }
  }
  for (const key of ["chargeAmountCents", "refundAmountCents"]) {
    if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < PRICE_CENTS || value[key] > 10_000)) {
      throw new Error(`blocked-checkout state ${key} is invalid`);
    }
  }
  const at = STAGES.indexOf(value.stage);
  const requireAt = (stage, keys) => {
    if (at < STAGES.indexOf(stage)) return;
    for (const key of keys) if (!value[key]) throw new Error(`blocked-checkout state ${key} is missing at ${value.stage}`);
  };
  requireAt("account-created", ["stripeAccountId"]);
  requireAt("checkout-created", ["stripeSessionId", "stripeClientSecret", "checkoutLockKey", "reservationId"]);
  requireAt("payment-completed", ["paymentIntentId", "chargeId", "transferId", "chargeAmountCents"]);
  requireAt("delivery-confirmed", ["checkoutEventId", "orderId", "orderItemId", "refundId", "refundAmountCents", "transferReversalId",
    "refundEventId", "localPaymentEventId", "signedPaymentEventId", "notificationId", "emailOutboxId"]);
  return Object.freeze({ ...value });
}

function updateState(config, state, update) {
  const next = assertState({ ...state, ...update }, config);
  writePrivateJson(config.statePath, next);
  return next;
}

export function markerFor(config, state) {
  return sha256(`${config.expectedCommit}:${state.attemptId}:blocked-checkout`);
}

export function assertStripeMetadataKeys(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("blocked-checkout Stripe metadata must be one object");
  }
  for (const key of Object.keys(metadata)) {
    if (key.length < 1 || key.length > STRIPE_METADATA_KEY_MAX_LENGTH) {
      throw new Error("blocked-checkout Stripe metadata key exceeded provider limits");
    }
  }
  return metadata;
}

export function buildConnectedAccountParams(config, state, now = new Date()) {
  return {
    type: "custom",
    country: "US",
    default_currency: "usd",
    business_type: "individual",
    email: "provider-canary@thegrainline.com",
    capabilities: { transfers: { requested: true } },
    business_profile: {
      mcc: "5712",
      name: "Grainline Blocked Checkout Canary",
      product_description: "Disposable Stripe test-mode blocked-checkout refund proof",
      url: PRODUCTION_ORIGIN,
    },
    individual: {
      first_name: "Jenny", last_name: "Rosen", email: "provider-canary@thegrainline.com",
      phone: "0000000000", dob: { day: 1, month: 1, year: 1902 }, id_number: "000000000", ssn_last_4: "0000",
      address: { line1: "address_full_match", city: "Chicago", state: "IL", postal_code: "60601", country: "US" },
    },
    tos_acceptance: { date: Math.floor(now.getTime() / 1000), ip: "8.8.8.8" },
    external_account: {
      object: "bank_account", country: "US", currency: "usd", routing_number: "110000000",
      account_number: "000123456789", account_holder_name: "Grainline Blocked Checkout Canary",
      account_holder_type: "individual",
    },
    metadata: assertStripeMetadataKeys({ [CONNECTED_ACCOUNT_MARKER_KEY]: markerFor(config, state) }),
    settings: { payouts: { schedule: { interval: "manual" } } },
  };
}

export function assertConnectedAccount(account, config, state) {
  if (!account || account.deleted === true || account.livemode === true
    || !/^acct_[A-Za-z0-9_]+$/.test(String(account.id ?? ""))
    || account.metadata?.[CONNECTED_ACCOUNT_MARKER_KEY] !== markerFor(config, state)
    || account.country !== "US" || account.default_currency !== "usd" || account.type !== "custom"
    || account.capabilities?.transfers !== "active") {
    throw new Error("blocked-checkout disposable connected account drifted");
  }
  return account;
}

export function buildPaymentPage(publishableKey, clientSecret) {
  if (!/^pk_test_[A-Za-z0-9_]+$/.test(publishableKey)) throw new Error("blocked-checkout payment page requires a test publishable key");
  if (!/^cs_test_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(clientSecret)) throw new Error("blocked-checkout payment page requires one test client secret");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Grainline blocked-checkout proof</title>
<script src="https://js.stripe.com/v3/"></script></head>
<body><main style="max-width:760px;margin:2rem auto;padding:1rem;font-family:system-ui">
<h1>Disposable Stripe test checkout</h1><p>Use Stripe test card 4242 4242 4242 4242.</p>
<div id="checkout"></div><p id="complete" hidden>Payment complete. Return to Codex.</p></main>
<script>(async()=>{const stripe=Stripe(${JSON.stringify(publishableKey)});const checkout=await stripe.initEmbeddedCheckout({clientSecret:${JSON.stringify(clientSecret)},onComplete(){document.querySelector('#checkout').hidden=true;document.querySelector('#complete').hidden=false;}});checkout.mount('#checkout');})();</script>
</body></html>`;
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
    cwd, encoding: "utf8", env: env ?? childEnvironment(), maxBuffer: 1024 * 1024, timeout,
  });
  if (result.error || result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? "unknown"}`);
  return result.stdout;
}

function readGitState(cwd) {
  const run = (args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return {
    branch: run(["branch", "--show-current"]),
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  };
}

function readGitHubCi(commit, runId) {
  const raw = execFileSync("gh", [
    "run", "view", String(runId), "--json",
    "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
  ], {
    encoding: "utf8",
    env: childEnvironment({
      ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}),
      ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseGitHubCiRun(raw, commit, runId);
}

function verifyGitHubCi(config) {
  readGitHubCi(config.expectedCommit, config.mainCiRunId);
  if (config.operatorCommit !== config.expectedCommit) {
    readGitHubCi(config.operatorCommit, config.operatorCiRunId);
  }
}

function assertVercelProject(config) {
  const project = JSON.parse(readFileSync(path.join(config.vercelProjectDirectory, ".vercel", "project.json"), "utf8"));
  for (const [key, expected] of Object.entries(EXPECTED_PROJECT)) {
    if (project?.[key] !== expected) throw new Error("blocked-checkout Vercel project identity drifted");
  }
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("blocked-checkout response exceeded its size bound");
  return value;
}

async function boundedJson(response) {
  const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("blocked-checkout route response was not an object");
  return value;
}

async function fetchJson(pathname, token, { body, method = "GET", origin = PRODUCTION_ORIGIN } = {}) {
  const response = await fetch(`${PRODUCTION_ORIGIN}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "cache-control": "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin ? { origin } : {}),
    },
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  return { body: await boundedJson(response), status: response.status };
}

async function verifyDeployment(config) {
  assertVercelProject(config);
  const raw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "api", `/v13/deployments/${config.deploymentId}`,
    "--raw", "--cwd", config.vercelProjectDirectory, "--no-color",
  ], {
    cwd: config.vercelProjectDirectory,
    env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}),
    label: "blocked-checkout deployment lookup",
  });
  parseVercelDeployment(raw, { ...config, requiredAliases: REQUIRED_ALIASES });
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const healthBody = JSON.parse(await boundedText(health, MAX_PRIVATE_BYTES));
  if (health.status !== 200 || healthBody?.ok !== true) throw new Error("blocked-checkout production health failed");
  const page = await fetch(PRODUCTION_ORIGIN, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const body = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("blocked-checkout canonical alias drifted");
  }
}

function postgresClient(connectionString, applicationName) {
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
}

async function verifyDatabaseBoundary(owner, runtime) {
  const [ownerIdentity, runtimeIdentity, posture] = await Promise.all([
    owner.query("SELECT current_user AS role, current_database() AS database"),
    runtime.query("SELECT current_user AS role, current_database() AS database"),
    owner.query(`
      SELECT relation.relrowsecurity AS enabled, relation.relforcerowsecurity AS forced,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'SELECT') AS can_select,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'INSERT') AS can_insert,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'UPDATE') AS can_update,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'DELETE') AS can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'OrderPaymentEvent'
    `),
  ]);
  if (ownerIdentity.rows[0]?.role !== "neondb_owner" || ownerIdentity.rows[0]?.database !== "neondb"
    || runtimeIdentity.rows[0]?.role !== RUNTIME_ROLE || runtimeIdentity.rows[0]?.database !== "neondb") {
    throw new Error("blocked-checkout database role identity drifted");
  }
  const row = posture.rows[0];
  if (!row || row.enabled !== false || row.forced !== false || row.can_select !== true
    || row.can_insert !== true || row.can_update !== true || row.can_delete !== true) {
    throw new Error("blocked-checkout proof requires the reviewed compatible OrderPaymentEvent posture");
  }
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") return listPromise.autoPagingToArray({ limit: 1000 });
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

function stripeDependencies(stripe, secretKey, config, state) {
  const idempotency = (key) => ({ idempotencyKey: `grainline-ope-blocked-${config.expectedCommit}-${state.attemptId}-${key}` });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({ include: ["webhook_endpoint.url"], limit: 100 })),
    createAccount: () => stripe.accounts.create(buildConnectedAccountParams(config, state), idempotency("account")),
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
    deleteAccount: (id) => stripe.accounts.del(id),
    retrieveSession: (id) => stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent.latest_charge.transfer", "payment_intent.latest_charge.refunds.data.transfer_reversal"] }),
    retrieveRefund: (id) => stripe.refunds.retrieve(id, { expand: ["transfer_reversal"] }),
    listCheckoutEvents: (createdAfter) => listAll(stripe.events.list({ created: { gte: createdAfter }, limit: 100, type: "checkout.session.completed" })),
    listRefundEvents: (createdAfter) => listAll(stripe.events.list({ created: { gte: createdAfter }, limit: 100, type: "charge.refunded" })),
    retrieveBalance: (accountId) => stripe.balance.retrieve({}, { stripeAccount: accountId }),
    resendEvent(endpointId, eventId) {
      const cliRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-ope-blocked-cli-"));
      try {
        const environment = childEnvironment({ STRIPE_API_KEY: secretKey, XDG_CONFIG_HOME: cliRoot });
        const version = command(config.stripeCliPath, ["version", "--color", "off"], {
          env: environment, label: "Stripe CLI version check",
        });
        if (String(version).trim().split("\n")[0] !== `stripe version ${STRIPE_CLI_VERSION}`) {
          throw new Error(`Stripe CLI version drifted from ${STRIPE_CLI_VERSION}`);
        }
        command(config.stripeCliPath, [
          "events", "resend", eventId, "--webhook-endpoint", endpointId, "--confirm", "--color", "off",
        ], { env: environment, label: "Stripe exact blocked-checkout completion resend" });
      } finally {
        rmSync(cliRoot, { force: true, recursive: true });
      }
    },
  };
}

async function waitFor(read, accept, label, attempts = 80, delayMs = 1500) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await read();
    if (accept(latest)) return latest;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} did not reach the reviewed state`);
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) throw new Error("blocked-checkout Clerk cookie response drifted");
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (separator <= 0 || !/^[A-Za-z0-9_]+$/.test(name) || !content || content.length > 8_192) {
      throw new Error("blocked-checkout Clerk returned an invalid cookie shape");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) throw new Error("blocked-checkout Clerk cookie jar drifted");
  return value;
}

async function createCanarySession(clerk, clerkUserId) {
  const ticket = await clerk.signInTokens.createSignInToken({ expiresInSeconds: 60, userId: clerkUserId });
  if (!ticket?.id || !ticket?.token || ticket.userId !== clerkUserId) throw new Error("blocked-checkout Clerk ticket creation failed");
  const jar = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "", headers: { "content-type": "application/x-www-form-urlencoded", origin: PRODUCTION_ORIGIN },
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = await boundedJson(clientResponse);
  if (clientResponse.status !== 200 || (clientPayload.response ?? clientPayload).object !== "client") {
    throw new Error("blocked-checkout Clerk client handshake failed");
  }
  const exchange = await fetch(`https://${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    body: new URLSearchParams({ strategy: "ticket", ticket: ticket.token }),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: clerkCookieHeader(jar), origin: PRODUCTION_ORIGIN },
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchange, jar);
  const payload = await boundedJson(exchange);
  const attempt = payload.response ?? payload;
  const sessionId = attempt.created_session_id;
  if (exchange.status !== 200 || attempt.object !== "sign_in_attempt" || attempt.status !== "complete"
    || !/^sess_[A-Za-z0-9]+$/.test(String(sessionId ?? ""))) {
    throw new Error("blocked-checkout Clerk ticket exchange failed");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("blocked-checkout Clerk session token drifted");
  }
  return Object.freeze({ jwt: token.jwt, sessionId });
}

async function revokeCanarySessions(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const after = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  return after.totalCount === 0 && after.data.length === 0;
}

async function selectCanary(clerk, owner, state = null) {
  const users = await clerk.users.getUserList({ externalId: [NOTIFICATION_CANARY_EXTERNAL_ID], limit: 2 });
  if (users.totalCount !== 1 || users.data.length !== 1) throw new Error("blocked-checkout expected one operational canary");
  const clerkUser = users.data[0];
  if (clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID || clerkUser.banned || clerkUser.locked
    || clerkUser.publicMetadata?.grainlineOperationalCanary !== "notification-rls-route-and-production-canary") {
    throw new Error("blocked-checkout operational canary identity drifted");
  }
  const result = await owner.query(`
    SELECT id, "clerkId", email, "notificationPreferences",
      pg_catalog.to_char(
        "termsAcceptedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US'
      ) AS "termsAcceptedAt",
      "termsVersion",
      pg_catalog.to_char(
        "ageAttestedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US'
      ) AS "ageAttestedAt"
      FROM public."User"
     WHERE "clerkId" = $1 AND "deletedAt" IS NULL AND banned = false
  `, [clerkUser.id]);
  if (result.rowCount !== 1) throw new Error("blocked-checkout operational canary database identity drifted");
  const candidate = result.rows[0];
  if (state && (candidate.id !== state.buyerId || candidate.clerkId !== state.buyerClerkId || candidate.email !== state.buyerEmail)) {
    throw new Error("blocked-checkout recovery canary drifted");
  }
  return candidate;
}

async function lockCanaryFence(owner, state) {
  const result = await owner.query(`
    SELECT
      "notificationPreferences" = $3::jsonb AS preferences_original,
      "notificationPreferences" = pg_catalog.jsonb_set(
        $3::jsonb, '{EMAIL_REFUND_ISSUED}', 'false'::jsonb, true
      ) AS preferences_fenced,
      "termsAcceptedAt" IS NOT DISTINCT FROM $4::timestamp AS terms_at_original,
      "termsVersion" IS NOT DISTINCT FROM $5::text AS terms_version_original,
      CASE
        WHEN $4::timestamp IS NULL
          THEN "termsAcceptedAt" IS NOT NULL AND "termsVersion" = $6
        ELSE "termsAcceptedAt" IS NOT DISTINCT FROM $4::timestamp
          AND "termsVersion" IS NOT DISTINCT FROM $5::text
      END AS terms_fenced,
      "ageAttestedAt" IS NOT DISTINCT FROM $7::timestamp AS age_original,
      CASE
        WHEN $7::timestamp IS NULL THEN "ageAttestedAt" IS NOT NULL
        ELSE "ageAttestedAt" IS NOT DISTINCT FROM $7::timestamp
      END AS age_fenced
    FROM public."User"
    WHERE id=$1 AND "clerkId"=$2 AND email=$8
      AND "deletedAt" IS NULL AND banned=false
    FOR UPDATE
  `, [
    state.buyerId,
    state.buyerClerkId,
    JSON.stringify(state.originalNotificationPreferences),
    state.originalTermsAcceptedAt,
    state.originalTermsVersion,
    TERMS_VERSION,
    state.originalAgeAttestedAt,
    state.buyerEmail,
  ]);
  if (resultCardinality(result) !== 1) {
    throw new Error("blocked-checkout canary fence identity drifted");
  }
  return result.rows[0];
}

function assertCanaryOriginal(fence) {
  if (
    fence?.preferences_original !== true
    || fence.terms_at_original !== true
    || fence.terms_version_original !== true
    || fence.age_original !== true
  ) {
    throw new Error("blocked-checkout canary original snapshot drifted");
  }
}

function assertCanaryFenced(fence) {
  if (
    fence?.preferences_fenced !== true
    || fence.terms_fenced !== true
    || fence.age_fenced !== true
  ) {
    throw new Error("blocked-checkout canary proof fence drifted");
  }
}

export async function createFixtures(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const canaryFence = await lockCanaryFence(owner, state);
    const collision = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id=$1 OR "clerkId"=$2 OR email=$3) AS seller_user,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$4 OR "userId"=$1 OR "stripeAccountId"=$5) AS seller,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$6) AS listing
    `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail, state.sellerProfileId, state.stripeAccountId, state.listingId]);
    const counts = Object.values(collision.rows[0] ?? {}).map(Number);
    if (counts.some((count) => count !== 0)) {
      const exact = await owner.query(`
        SELECT
          (SELECT count(*)::integer FROM public."User" WHERE id=$1 AND "clerkId"=$2 AND email=$3
            AND name='Grainline Blocked Checkout Proof Seller' AND role='USER' AND banned=false AND "deletedAt" IS NULL) AS seller_user,
          (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$4 AND "userId"=$1 AND "stripeAccountId"=$5
            AND "displayName"='Grainline Blocked Checkout Proof' AND "displayNameNormalized"='grainline blocked checkout proof'
            AND "chargesEnabled"=true AND "stripeAccountVersion"='v1' AND "stripeControllerType"='custom'
            AND "vacationMode" IN (false,true) AND "acceptingNewOrders"=true AND "allowLocalPickup"=true) AS seller,
          (SELECT count(*)::integer FROM public."Listing" WHERE id=$6 AND "sellerId"=$4
            AND title='blocked-checkout-production-proof' AND "priceCents"=500 AND currency='usd'
            AND status IN ('ACTIVE','SOLD_OUT') AND "listingType"='IN_STOCK' AND "stockQuantity" IN (0,1)
            AND "isPrivate"=true AND "reservedForUserId"=$7) AS listing
      `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail, state.sellerProfileId,
        state.stripeAccountId, state.listingId, state.buyerId]);
      if (Object.values(exact.rows[0] ?? {}).every((count) => Number(count) === 1)) {
        assertCanaryFenced(canaryFence);
        await owner.query("COMMIT");
        return;
      }
      throw new Error("blocked-checkout fixture identity collided");
    }
    assertCanaryOriginal(canaryFence);
    const adjusted = await owner.query(`
      UPDATE public."User"
         SET "notificationPreferences" = pg_catalog.jsonb_set("notificationPreferences", '{EMAIL_REFUND_ISSUED}', 'false'::jsonb, true),
             "termsAcceptedAt" = COALESCE("termsAcceptedAt", CURRENT_TIMESTAMP),
             "termsVersion" = CASE WHEN "termsAcceptedAt" IS NULL THEN $2 ELSE "termsVersion" END,
             "ageAttestedAt" = COALESCE("ageAttestedAt", CURRENT_TIMESTAMP),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id=$1 AND "clerkId"=$3 AND "deletedAt" IS NULL AND banned=false
      RETURNING id
    `, [state.buyerId, TERMS_VERSION, state.buyerClerkId]);
    if (adjusted.rows.length !== 1) throw new Error("blocked-checkout canary preference fencing failed");
    assertCanaryFenced(await lockCanaryFence(owner, state));
    await owner.query(`
      INSERT INTO public."User" (id,"clerkId",email,name,role,"notificationPreferences","updatedAt")
      VALUES ($1,$2,$3,'Grainline Blocked Checkout Proof Seller','USER','{}'::jsonb,CURRENT_TIMESTAMP)
    `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id,"userId","displayName","displayNameNormalized","stripeAccountId","chargesEnabled",
        "stripeAccountVersion","stripeControllerType","vacationMode","acceptingNewOrders","allowLocalPickup","updatedAt"
      ) VALUES ($1,$2,'Grainline Blocked Checkout Proof','grainline blocked checkout proof',$3,true,'v1','custom',false,true,true,CURRENT_TIMESTAMP)
    `, [state.sellerProfileId, state.sellerUserId, state.stripeAccountId]);
    await owner.query(`
      INSERT INTO public."Listing" (
        id,"sellerId",title,description,"priceCents",currency,status,"listingType","stockQuantity",
        "shipsWithinDays","isPrivate","reservedForUserId","packagedWeightGrams","packagedLengthCm",
        "packagedWidthCm","packagedHeightCm","createdAt","updatedAt"
      ) VALUES ($1,$2,'blocked-checkout-production-proof','Disposable private blocked-checkout production proof fixture',
        500,'usd','ACTIVE','IN_STOCK',1,2,true,$3,500,10,10,10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    `, [state.listingId, state.sellerProfileId, state.buyerId]);
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function blockFixtureSeller(owner, state) {
  const blocked = await owner.query(`
    UPDATE public."SellerProfile"
       SET "vacationMode"=true,"updatedAt"=CURRENT_TIMESTAMP
     WHERE id=$1 AND "userId"=$2 AND "stripeAccountId"=$3
       AND "displayName"='Grainline Blocked Checkout Proof'
       AND "displayNameNormalized"='grainline blocked checkout proof'
       AND "chargesEnabled"=true AND "acceptingNewOrders"=true
       AND "allowLocalPickup"=true
       AND "stripeAccountVersion"='v1' AND "stripeControllerType"='custom'
    RETURNING id,"vacationMode"
  `, [state.sellerProfileId, state.sellerUserId, state.stripeAccountId]);
  if (
    resultCardinality(blocked) !== 1
    || blocked.rows[0]?.id !== state.sellerProfileId
    || blocked.rows[0]?.vacationMode !== true
  ) {
    throw new Error("blocked-checkout seller eligibility transition drifted");
  }
}

function checkoutRate(rate) {
  if (!rate || rate.objectId !== "pickup" || rate.amountCents !== 0 || rate.currency !== "usd"
    || typeof rate.token !== "string" || !Number.isInteger(rate.expiresAt) || typeof rate.subjectHash !== "string") {
    throw new Error("blocked-checkout shipping quote did not return the exact signed pickup rate");
  }
  return {
    objectId: rate.objectId, amountCents: rate.amountCents, currency: rate.currency,
    displayName: rate.label, carrier: rate.carrier, estDays: rate.estDays,
    subjectHash: rate.subjectHash, token: rate.token, expiresAt: rate.expiresAt,
  };
}

export function validateProviderCredentials(localValues) {
  const stripeSecret = validateStripeSecret(localValues);
  const publishableKey = required(localValues, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const clerkSecret = required(localValues, "CLERK_SECRET_KEY");
  const clerkPublishable = required(localValues, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const redisUrl = required(localValues, "UPSTASH_REDIS_REST_URL");
  const redisToken = required(localValues, "UPSTASH_REDIS_REST_TOKEN");
  if (!/^pk_test_[A-Za-z0-9_]+$/.test(publishableKey)) {
    throw new Error("blocked-checkout proof refuses a non-test publishable key");
  }
  if (!clerkSecret.startsWith("sk_live_") || !clerkPublishable.startsWith("pk_live_")) {
    throw new Error("blocked-checkout proof requires the reviewed live Clerk pair");
  }
  const parsedClerkKey = parsePublishableKey(clerkPublishable);
  if (parsedClerkKey.instanceType !== "production" || parsedClerkKey.frontendApi !== CLERK_FRONTEND_API) {
    throw new Error("blocked-checkout proof Clerk Frontend API identity drifted");
  }
  if (!redisUrl.startsWith("https://") || redisToken.length < 16) {
    throw new Error("blocked-checkout proof Redis credentials are invalid");
  }
  return Object.freeze({ clerkSecret, publishableKey, redisToken, redisUrl, stripeSecret });
}

async function signedPickupRate(token, state) {
  const response = await fetchJson("/api/shipping/quote", token, {
    body: {
      mode: "single", listingId: state.listingId, quantity: 1,
      toPostal: ADDRESS.postalCode, toState: ADDRESS.state, toCity: ADDRESS.city, toCountry: "US",
    },
    method: "POST",
  });
  if (response.status !== 200 || !Array.isArray(response.body.rates)) throw new Error("blocked-checkout shipping quote route failed");
  return checkoutRate(response.body.rates.find((rate) => rate?.objectId === "pickup"));
}

async function createCheckout(token, state, selectedRate, origin = PRODUCTION_ORIGIN) {
  return fetchJson("/api/cart/checkout/single", token, {
    body: {
      listingId: state.listingId,
      quantity: 1,
      shippingAddress: ADDRESS,
      selectedRate,
      giftNote: null,
      giftWrapping: false,
      selectedVariantOptionIds: [],
    },
    method: "POST",
    origin,
  });
}

export function assertCheckoutResponse(response, expectedSessionId = null) {
  const sessionId = response?.body?.sessionId;
  const clientSecret = response?.body?.clientSecret;
  if (response?.status !== 200 || !/^cs_test_[A-Za-z0-9_]+$/.test(String(sessionId ?? ""))
    || !/^cs_test_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(String(clientSecret ?? ""))
    || (expectedSessionId !== null && sessionId !== expectedSessionId)) {
    throw new Error("blocked-checkout route response drifted");
  }
  return Object.freeze({ clientSecret, sessionId });
}

export async function readPreparedSnapshot(owner, state) {
  const result = await owner.query(`
    SELECT
      (SELECT "stockQuantity" FROM public."Listing" WHERE id=$1) AS stock,
      (SELECT status::text FROM public."Listing" WHERE id=$1) AS listing_status,
      (SELECT "vacationMode" FROM public."SellerProfile" WHERE id=$2) AS vacation_mode,
      (SELECT count(*)::integer FROM public."Order" WHERE "stripeSessionId"=$3) AS orders,
      (SELECT id FROM public."CheckoutStockReservation" WHERE "stripeSessionId"=$3) AS reservation_id,
      (SELECT status FROM public."CheckoutStockReservation" WHERE "stripeSessionId"=$3) AS reservation_status,
      (SELECT "checkoutLockKey" FROM public."CheckoutStockReservation" WHERE "stripeSessionId"=$3) AS checkout_lock_key,
      (SELECT "buyerId" FROM public."CheckoutStockReservation" WHERE "stripeSessionId"=$3) AS reservation_buyer,
      (SELECT "sellerId" FROM public."CheckoutStockReservation" WHERE "stripeSessionId"=$3) AS reservation_seller
  `, [state.listingId, state.sellerProfileId, state.stripeSessionId]);
  return result.rows[0];
}

export function assertPreparedSnapshot(snapshot, state, sellerBlocked = true) {
  if (Number(snapshot?.stock) !== 0 || snapshot?.listing_status !== "ACTIVE"
    || snapshot?.vacation_mode !== sellerBlocked || Number(snapshot?.orders) !== 0
    || typeof snapshot?.reservation_id !== "string" || snapshot?.reservation_status !== "SESSION_CREATED"
    || snapshot?.checkout_lock_key !== `checkout:single:${state.buyerId}:listing:${state.listingId}`
    || snapshot?.reservation_buyer !== state.buyerId || snapshot?.reservation_seller !== state.sellerProfileId) {
    throw new Error("blocked-checkout prepared database state drifted");
  }
  return Object.freeze({
    checkoutLockKey: snapshot.checkout_lock_key,
    reservationId: snapshot.reservation_id,
  });
}

function stripeObjectId(value) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export function assertCompletedSession(session, state) {
  const paymentIntent = typeof session?.payment_intent === "object" ? session.payment_intent : null;
  const charge = typeof paymentIntent?.latest_charge === "object" ? paymentIntent.latest_charge : null;
  const transfer = typeof charge?.transfer === "object" ? charge.transfer : null;
  if (session?.id !== state.stripeSessionId || session?.livemode !== false || session?.status !== "complete"
    || session?.payment_status !== "paid" || session?.currency !== "usd"
    || session?.metadata?.buyerId !== state.buyerId || session?.metadata?.sellerId !== state.sellerProfileId
    || session?.metadata?.listingId !== state.listingId || session?.metadata?.checkoutLockKey !== state.checkoutLockKey
    || !/^pi_[A-Za-z0-9_]+$/.test(String(paymentIntent?.id ?? ""))
    || !/^ch_[A-Za-z0-9_]+$/.test(String(charge?.id ?? "")) || charge?.paid !== true || charge?.livemode !== false
    || !/^tr_[A-Za-z0-9_]+$/.test(String(transfer?.id ?? "")) || transfer?.amount !== SELLER_TRANSFER_CENTS
    || stripeObjectId(transfer?.destination) !== state.stripeAccountId
    || !Number.isSafeInteger(session?.amount_total) || session.amount_total < PRICE_CENTS || session.amount_total > 10_000
    || charge.amount !== session.amount_total) {
    throw new Error("blocked-checkout completed Stripe Session drifted");
  }
  return Object.freeze({
    chargeAmountCents: session.amount_total,
    chargeId: charge.id,
    paymentIntentId: paymentIntent.id,
    transferId: transfer.id,
  });
}

function exactCheckoutEvent(events, state) {
  const matches = events.filter((event) => event?.type === "checkout.session.completed" && event?.livemode === false
    && event?.data?.object?.id === state.stripeSessionId);
  return matches.length === 1 ? matches[0] : null;
}

function exactRefundEvent(events, state) {
  const matches = events.filter((event) => event?.type === "charge.refunded" && event?.livemode === false
    && event?.data?.object?.id === state.chargeId
    && event.data.object.refunds?.data?.some((refund) => refund?.id === state.refundId));
  return matches.length === 1 ? matches[0] : null;
}

export function assertRefund(refund, state) {
  const reversal = typeof refund?.transfer_reversal === "object" ? refund.transfer_reversal : null;
  if (!/^re_[A-Za-z0-9_]+$/.test(String(refund?.id ?? "")) || refund?.livemode !== false
    || refund?.amount !== state.chargeAmountCents || refund?.currency !== "usd"
    || !["pending", "requires_action", "succeeded"].includes(refund?.status)
    || stripeObjectId(refund?.payment_intent) !== state.paymentIntentId || stripeObjectId(refund?.charge) !== state.chargeId
    || !/^trr_[A-Za-z0-9_]+$/.test(String(reversal?.id ?? ""))
    || reversal?.amount !== SELLER_TRANSFER_CENTS || stripeObjectId(reversal?.transfer) !== state.transferId) {
    throw new Error("blocked-checkout Stripe refund evidence drifted");
  }
  return Object.freeze({ refundAmountCents: refund.amount, transferReversalId: reversal.id });
}

export async function readDeliverySnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      WITH source_order AS (
        SELECT * FROM public."Order" WHERE "stripeSessionId"=$1
      )
      SELECT
        (SELECT id FROM source_order) AS order_id,
        (SELECT "sellerRefundId" FROM source_order) AS order_refund_id,
        (SELECT "sellerRefundAmountCents" FROM source_order) AS order_refund_amount,
        (SELECT "stripePaymentIntentId" FROM source_order) AS payment_intent_id,
        (SELECT "stripeChargeId" FROM source_order) AS charge_id,
        (SELECT "stripeTransferId" FROM source_order) AS transfer_id,
        (SELECT "buyerId" FROM source_order) AS buyer_id,
        (SELECT "sellerProfileId" FROM source_order) AS seller_id,
        (SELECT "itemsSubtotalCents" FROM source_order) AS items_subtotal,
        (SELECT "shippingAmountCents" FROM source_order) AS shipping_amount,
        (SELECT "taxAmountCents" FROM source_order) AS tax_amount,
        (SELECT "reviewNeeded" FROM source_order) AS review_needed,
        (SELECT "reviewNote" FROM source_order) AS review_note,
        (SELECT "refundClaimId" IS NULL AND "refundClaimSource" IS NULL AND "refundClaimSourceId" IS NULL
          AND "refundClaimIdempotencyScope" IS NULL AND "refundClaimProviderAuthorizedAt" IS NULL FROM source_order) AS claim_cleared,
        (SELECT "refundClaimGeneration"::text FROM source_order) AS claim_generation,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE "orderId"=(SELECT id FROM source_order)) AS item_count,
        (SELECT id FROM public."OrderItem" WHERE "orderId"=(SELECT id FROM source_order)) AS item_id,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId"=(SELECT id FROM source_order)) AS payment_count,
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId"='local:blocked_checkout_refund_recorded:'||$2) AS local_payment_id,
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS signed_payment_id,
        (SELECT reason FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS signed_reason,
        (SELECT metadata->'refundAccounting'->>'buyerRefundAmountCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId"='local:blocked_checkout_refund_recorded:'||$2) AS local_buyer_refund,
        (SELECT metadata->'refundAccounting'->>'originalTransferAmountCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId"='local:blocked_checkout_refund_recorded:'||$2) AS local_transfer_amount,
        (SELECT metadata->'refundAccounting'->>'transferReversalId' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId"='local:blocked_checkout_refund_recorded:'||$2) AS local_reversal_id,
        (SELECT metadata->>'latestRefundId' FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS signed_latest_refund,
        (SELECT metadata->>'totalRefundedCents' FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS signed_total_refunded,
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id=$4 AND type='checkout.session.completed'
          AND "sourceObjectId"=$1 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS checkout_webhook_count,
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id=$4) AS checkout_generation,
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id=$3 AND type='charge.refunded'
          AND "sourceObjectId"=$5 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS refund_webhook_count,
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id=$3) AS refund_generation,
        (SELECT status FROM public."CheckoutStockReservation" WHERE id=$6 AND "stripeSessionId"=$1) AS reservation_status,
        (SELECT "stockQuantity" FROM public."Listing" WHERE id=$7) AS stock,
        (SELECT status::text FROM public."Listing" WHERE id=$7) AS listing_status,
        (SELECT "vacationMode" FROM public."SellerProfile" WHERE id=$8) AS vacation_mode,
        (SELECT count(*)::integer FROM public."Notification" WHERE "userId"=$9 AND type='REFUND_ISSUED'
          AND "sourceType"='order_payment' AND "sourceId"='local:blocked_checkout_refund_recorded:'||$2
          AND "relatedUserId" IS NULL) AS notification_count,
        (SELECT id FROM public."Notification" WHERE "userId"=$9 AND type='REFUND_ISSUED'
          AND "sourceId"='local:blocked_checkout_refund_recorded:'||$2) AS notification_id,
        (SELECT count(*)::integer FROM public."Notification" WHERE "sourceType"='order_checkout'
          AND "sourceId"=(SELECT id FROM source_order) AND type='NEW_ORDER') AS wrong_notification_count,
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE "userId"=$9 AND "preferenceKey"='EMAIL_REFUND_ISSUED'
          AND "sourceType"='order_payment' AND "sourceId"='local:blocked_checkout_refund_recorded:'||$2
          AND status='SKIPPED' AND "templateName"='refund_issued') AS outbox_count,
        (SELECT id FROM public."EmailOutbox" WHERE "userId"=$9
          AND "sourceId"='local:blocked_checkout_refund_recorded:'||$2) AS outbox_id,
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE "dedupKey" IN (
          'order-confirmed-buyer:'||(SELECT id FROM source_order),
          'order-confirmed-seller:'||(SELECT id FROM source_order)||':'||$10,
          'first-sale-congrats:'||(SELECT id FROM source_order)||':'||$10
        )) AS wrong_outbox_count,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId"=$4
          AND action='STRIPE_CHECKOUT_ORDER_CREATED' AND "targetType"='ORDER' AND "targetId"=(SELECT id FROM source_order)) AS checkout_audit_count,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId"=$4
          AND action='BLOCKED_CHECKOUT_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=(SELECT id FROM source_order)) AS local_audit_count,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId"=$3
          AND action='STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=(SELECT id FROM source_order)) AS signed_audit_count
    `, [state.stripeSessionId, state.refundId, state.refundEventId, state.checkoutEventId, state.chargeId,
      state.reservationId, state.listingId, state.sellerProfileId, state.buyerId, state.sellerUserId]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export function assertDeliverySnapshot(snapshot, state, expected = {}) {
  const normalized = {
    orderId: snapshot?.order_id ?? null,
    orderRefundId: snapshot?.order_refund_id ?? null,
    orderRefundAmount: Number(snapshot?.order_refund_amount),
    paymentIntentId: snapshot?.payment_intent_id ?? null,
    chargeId: snapshot?.charge_id ?? null,
    transferId: snapshot?.transfer_id ?? null,
    buyerId: snapshot?.buyer_id ?? null,
    sellerId: snapshot?.seller_id ?? null,
    itemsSubtotal: Number(snapshot?.items_subtotal),
    shippingAmount: Number(snapshot?.shipping_amount),
    taxAmount: Number(snapshot?.tax_amount),
    reviewNeeded: snapshot?.review_needed,
    reviewNote: snapshot?.review_note ?? "",
    claimCleared: snapshot?.claim_cleared,
    claimGeneration: String(snapshot?.claim_generation ?? ""),
    itemCount: Number(snapshot?.item_count),
    itemId: snapshot?.item_id ?? null,
    paymentCount: Number(snapshot?.payment_count),
    localPaymentId: snapshot?.local_payment_id ?? null,
    signedPaymentId: snapshot?.signed_payment_id ?? null,
    signedReason: snapshot?.signed_reason ?? null,
    localBuyerRefund: Number(snapshot?.local_buyer_refund),
    localTransferAmount: Number(snapshot?.local_transfer_amount),
    localReversalId: snapshot?.local_reversal_id ?? null,
    signedLatestRefund: snapshot?.signed_latest_refund ?? null,
    signedTotalRefunded: Number(snapshot?.signed_total_refunded),
    checkoutWebhookCount: Number(snapshot?.checkout_webhook_count),
    checkoutGeneration: String(snapshot?.checkout_generation ?? ""),
    refundWebhookCount: Number(snapshot?.refund_webhook_count),
    refundGeneration: String(snapshot?.refund_generation ?? ""),
    reservationStatus: snapshot?.reservation_status,
    stock: Number(snapshot?.stock),
    listingStatus: snapshot?.listing_status,
    vacationMode: snapshot?.vacation_mode,
    notificationCount: Number(snapshot?.notification_count),
    notificationId: snapshot?.notification_id ?? null,
    wrongNotificationCount: Number(snapshot?.wrong_notification_count),
    outboxCount: Number(snapshot?.outbox_count),
    outboxId: snapshot?.outbox_id ?? null,
    wrongOutboxCount: Number(snapshot?.wrong_outbox_count),
    checkoutAuditCount: Number(snapshot?.checkout_audit_count),
    localAuditCount: Number(snapshot?.local_audit_count),
    signedAuditCount: Number(snapshot?.signed_audit_count),
  };
  if (!normalized.orderId || normalized.orderRefundId !== state.refundId
    || normalized.orderRefundAmount !== state.refundAmountCents || normalized.paymentIntentId !== state.paymentIntentId
    || normalized.chargeId !== state.chargeId || normalized.transferId !== state.transferId
    || normalized.buyerId !== state.buyerId || normalized.sellerId !== state.sellerProfileId
    || normalized.itemsSubtotal !== PRICE_CENTS || normalized.shippingAmount !== 0
    || normalized.itemsSubtotal + normalized.shippingAmount + normalized.taxAmount !== state.refundAmountCents
    || normalized.reviewNeeded !== true || !normalized.reviewNote.includes("Seller entered vacation mode before payment completion.")
    || normalized.claimCleared !== true || !/^[1-9][0-9]*$/.test(normalized.claimGeneration)
    || normalized.itemCount !== 1 || !normalized.itemId || normalized.paymentCount !== 2
    || !normalized.localPaymentId || !normalized.signedPaymentId
    || !new Set(["local_refund_confirmed", "local_refund_pending_confirmation"]).has(normalized.signedReason)
    || normalized.localBuyerRefund !== state.refundAmountCents || normalized.localTransferAmount !== SELLER_TRANSFER_CENTS
    || normalized.localReversalId !== state.transferReversalId || normalized.signedLatestRefund !== state.refundId
    || normalized.signedTotalRefunded !== state.refundAmountCents
    || normalized.checkoutWebhookCount !== 1 || normalized.refundWebhookCount !== 1
    || !/^[1-9][0-9]*$/.test(normalized.checkoutGeneration) || !/^[1-9][0-9]*$/.test(normalized.refundGeneration)
    || normalized.reservationStatus !== "COMPLETED" || normalized.stock !== 1 || normalized.listingStatus !== "ACTIVE"
    || normalized.vacationMode !== true || normalized.notificationCount !== 1 || !normalized.notificationId
    || normalized.wrongNotificationCount !== 0 || normalized.outboxCount !== 1 || !normalized.outboxId
    || normalized.wrongOutboxCount !== 0 || normalized.checkoutAuditCount !== 1
    || normalized.localAuditCount !== 1 || normalized.signedAuditCount !== 1
    || (expected.orderId && normalized.orderId !== expected.orderId)
    || (expected.itemId && normalized.itemId !== expected.itemId)
    || (expected.localPaymentId && normalized.localPaymentId !== expected.localPaymentId)
    || (expected.signedPaymentId && normalized.signedPaymentId !== expected.signedPaymentId)
    || (expected.notificationId && normalized.notificationId !== expected.notificationId)
    || (expected.outboxId && normalized.outboxId !== expected.outboxId)
    || (expected.checkoutGeneration && normalized.checkoutGeneration !== expected.checkoutGeneration)
    || (expected.refundGeneration && normalized.refundGeneration !== expected.refundGeneration)) {
    throw new Error("blocked-checkout delivery effects drifted");
  }
  return Object.freeze(normalized);
}

export function assertReplayUnchanged(before, after, state) {
  const first = before?.orderId ? before : assertDeliverySnapshot(before, state);
  return assertDeliverySnapshot(after, state, first);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function resultCardinality(result) {
  return Number.isSafeInteger(result?.rowCount) ? result.rowCount : result?.rows?.length;
}

async function assertNoForeignKeyDependents(client, relation, id) {
  const constraints = await client.query(`
    SELECT child_namespace.nspname AS schema_name, child.relname AS table_name,
      pg_catalog.array_agg(child_attribute.attname ORDER BY child_key_row.ordinality) AS child_columns,
      pg_catalog.array_agg(parent_attribute.attname ORDER BY child_key_row.ordinality) AS parent_columns
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS child ON child.oid=constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS child_namespace ON child_namespace.oid=child.relnamespace
    JOIN LATERAL pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY AS child_key_row(child_key,ordinality) ON true
    JOIN LATERAL pg_catalog.unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key_row(parent_key,ordinality)
      ON parent_key_row.ordinality=child_key_row.ordinality
    JOIN pg_catalog.pg_attribute AS child_attribute ON child_attribute.attrelid=constraint_row.conrelid AND child_attribute.attnum=child_key_row.child_key
    JOIN pg_catalog.pg_attribute AS parent_attribute ON parent_attribute.attrelid=constraint_row.confrelid AND parent_attribute.attnum=parent_key_row.parent_key
    WHERE constraint_row.contype='f' AND constraint_row.confrelid=$1::pg_catalog.regclass
    GROUP BY child_namespace.nspname,child.relname,constraint_row.oid
  `, [relation]);
  for (const constraint of constraints.rows) {
    const child = `${quoteIdentifier(constraint.schema_name)}.${quoteIdentifier(constraint.table_name)}`;
    const join = constraint.child_columns.map((column, index) =>
      `child.${quoteIdentifier(column)} IS NOT DISTINCT FROM parent.${quoteIdentifier(constraint.parent_columns[index])}`).join(" AND ");
    const dependent = await client.query(
      `SELECT count(*)::integer AS count FROM ${child} AS child JOIN ${relation} AS parent ON ${join} WHERE parent.id=$1`,
      [id],
    );
    if (dependent.rows[0]?.count !== 0) throw new Error("blocked-checkout cleanup found an unexpected dependent row");
  }
}

export async function cleanupDeliveredRows(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    assertCanaryFenced(await lockCanaryFence(owner, state));
    const exact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id=$1 AND "clerkId"=$2 AND email=$3
          AND name='Grainline Blocked Checkout Proof Seller') AS seller_user,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$4 AND "userId"=$1 AND "stripeAccountId"=$5
          AND "displayName"='Grainline Blocked Checkout Proof' AND "vacationMode"=true) AS seller,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$6 AND "sellerId"=$4
          AND title='blocked-checkout-production-proof' AND status='ACTIVE' AND "stockQuantity"=1
          AND "isPrivate"=true AND "reservedForUserId"=$7) AS listing,
        (SELECT count(*)::integer FROM public."CheckoutStockReservation" WHERE id=$8 AND "stripeSessionId"=$9
          AND "buyerId"=$7 AND "sellerId"=$4 AND status='COMPLETED') AS reservation,
        (SELECT count(*)::integer FROM public."Order" WHERE id=$10 AND "stripeSessionId"=$9 AND "buyerId"=$7
          AND "sellerProfileId"=$4 AND "sellerRefundId"=$11 AND "sellerRefundAmountCents"=$12) AS order_row,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$13 AND "orderId"=$10 AND "listingId"=$6
          AND "sellerProfileId"=$4 AND quantity=1 AND "priceCents"=500) AS item,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($14,$15) AND "orderId"=$10) AS payments,
        (SELECT count(*)::integer FROM public."Notification" WHERE id=$16 AND "userId"=$7 AND type='REFUND_ISSUED') AS notification,
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id=$17 AND "userId"=$7 AND status='SKIPPED') AS outbox,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE
          ("actorId"=$18 AND action IN ('STRIPE_CHECKOUT_ORDER_CREATED','BLOCKED_CHECKOUT_REFUND_RECORDED')
            AND "targetType"='ORDER' AND "targetId"=$10)
          OR ("actorId"=$19 AND action='STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$10)) AS audits,
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id IN ($18,$19)
          AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS webhooks
    `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail, state.sellerProfileId, state.stripeAccountId,
      state.listingId, state.buyerId, state.reservationId, state.stripeSessionId, state.orderId, state.refundId,
      state.refundAmountCents, state.orderItemId, state.localPaymentEventId, state.signedPaymentEventId,
      state.notificationId, state.emailOutboxId, state.checkoutEventId, state.refundEventId]);
    const expected = { seller_user: 1, seller: 1, listing: 1, reservation: 1, order_row: 1, item: 1,
      payments: 2, notification: 1, outbox: 1, audits: 3, webhooks: 2 };
    for (const [key, count] of Object.entries(expected)) {
      if (Number(exact.rows[0]?.[key]) !== count) throw new Error(`blocked-checkout cleanup ${key} relationship drifted`);
    }
    const deletions = [
      await owner.query(`DELETE FROM public."Notification" WHERE id=$1 RETURNING id`, [state.notificationId]),
      await owner.query(`DELETE FROM public."EmailOutbox" WHERE id=$1 RETURNING id`, [state.emailOutboxId]),
      await owner.query(`DELETE FROM public."SystemAuditLog" WHERE
        ("actorId"=$1 AND action IN ('STRIPE_CHECKOUT_ORDER_CREATED','BLOCKED_CHECKOUT_REFUND_RECORDED') AND "targetId"=$3)
        OR ("actorId"=$2 AND action='STRIPE_REFUND_RECORDED' AND "targetId"=$3) RETURNING id`,
      [state.checkoutEventId, state.refundEventId, state.orderId]),
      await owner.query(`DELETE FROM public."OrderPaymentEvent" WHERE id IN ($1,$2) RETURNING id`,
        [state.localPaymentEventId, state.signedPaymentEventId]),
      await owner.query(`DELETE FROM public."OrderItem" WHERE id=$1 RETURNING id`, [state.orderItemId]),
      await owner.query(`DELETE FROM public."CheckoutStockReservation" WHERE id=$1 RETURNING id`, [state.reservationId]),
    ];
    [1, 1, 3, 2, 1, 1].forEach((count, index) => {
      if (resultCardinality(deletions[index]) !== count) {
        throw new Error("blocked-checkout cleanup cardinality drifted");
      }
    });
    await assertNoForeignKeyDependents(owner, 'public."Order"', state.orderId);
    if (resultCardinality(await owner.query(`DELETE FROM public."Order" WHERE id=$1 RETURNING id`, [state.orderId])) !== 1) {
      throw new Error("blocked-checkout Order cleanup drifted");
    }
    await assertNoForeignKeyDependents(owner, 'public."Listing"', state.listingId);
    if (resultCardinality(await owner.query(`DELETE FROM public."Listing" WHERE id=$1 RETURNING id`, [state.listingId])) !== 1) {
      throw new Error("blocked-checkout Listing cleanup drifted");
    }
    await assertNoForeignKeyDependents(owner, 'public."SellerProfile"', state.sellerProfileId);
    if (resultCardinality(await owner.query(`DELETE FROM public."SellerProfile" WHERE id=$1 RETURNING id`, [state.sellerProfileId])) !== 1) {
      throw new Error("blocked-checkout SellerProfile cleanup drifted");
    }
    await assertNoForeignKeyDependents(owner, 'public."User"', state.sellerUserId);
    if (resultCardinality(await owner.query(`DELETE FROM public."User" WHERE id=$1 RETURNING id`, [state.sellerUserId])) !== 1) {
      throw new Error("blocked-checkout seller User cleanup drifted");
    }
    const restored = await owner.query(`
      UPDATE public."User"
         SET "notificationPreferences"=$2::jsonb,
             "termsAcceptedAt"=$3::timestamp,
             "termsVersion"=$4,
             "ageAttestedAt"=$5::timestamp,
             "updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1 AND "clerkId"=$6 AND "deletedAt" IS NULL AND banned=false
      RETURNING id
    `, [state.buyerId, JSON.stringify(state.originalNotificationPreferences), state.originalTermsAcceptedAt,
      state.originalTermsVersion, state.originalAgeAttestedAt, state.buyerClerkId]);
    if (restored.rows.length !== 1) throw new Error("blocked-checkout canary restoration drifted");
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCleanupSnapshot(owner, state) {
  const result = await owner.query(`
    SELECT
      (SELECT count(*)::integer FROM public."User" WHERE id=$1) AS seller_user_count,
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$2) AS seller_count,
      (SELECT count(*)::integer FROM public."Listing" WHERE id=$3) AS listing_count,
      (SELECT count(*)::integer FROM public."CheckoutStockReservation" WHERE id=$4) AS reservation_count,
      (SELECT count(*)::integer FROM public."Order" WHERE id=$5) AS order_count,
      (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$6) AS item_count,
      (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($7,$8)) AS payment_count,
      (SELECT count(*)::integer FROM public."Notification" WHERE id=$9) AS notification_count,
      (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id=$10) AS outbox_count,
      (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id IN ($11,$12)) AS webhook_count,
      (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id IN ($11,$12)
        AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS processed_webhook_count,
      (SELECT count(*)::integer FROM public."User" WHERE id=$13 AND "clerkId"=$14
        AND "notificationPreferences"=$15::jsonb AND "termsAcceptedAt" IS NOT DISTINCT FROM $16::timestamp
        AND "termsVersion" IS NOT DISTINCT FROM $17 AND "ageAttestedAt" IS NOT DISTINCT FROM $18::timestamp
        AND "deletedAt" IS NULL AND banned=false) AS canary_count
  `, [state.sellerUserId, state.sellerProfileId, state.listingId, state.reservationId, state.orderId,
    state.orderItemId, state.localPaymentEventId, state.signedPaymentEventId, state.notificationId,
    state.emailOutboxId, state.checkoutEventId, state.refundEventId, state.buyerId, state.buyerClerkId,
    JSON.stringify(state.originalNotificationPreferences), state.originalTermsAcceptedAt, state.originalTermsVersion,
    state.originalAgeAttestedAt]);
  return result.rows[0];
}

export function assertCleanupSnapshot(snapshot) {
  const normalized = Object.fromEntries(Object.entries(snapshot ?? {}).map(([key, value]) => [key, Number(value)]));
  for (const key of ["seller_user_count", "seller_count", "listing_count", "reservation_count", "order_count",
    "item_count", "payment_count", "notification_count", "outbox_count"]) {
    if (normalized[key] !== 0) throw new Error("blocked-checkout application cleanup is incomplete");
  }
  if (normalized.webhook_count !== 2 || normalized.processed_webhook_count !== 2 || normalized.canary_count !== 1) {
    throw new Error("blocked-checkout retained evidence or canary restoration drifted");
  }
  return Object.freeze(normalized);
}

function balanceTotal(balance) {
  return [...(balance?.available ?? []), ...(balance?.pending ?? [])]
    .reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
}

async function scanAndDeleteExactRedisKeys(redis, patterns) {
  const keys = new Set();
  for (const pattern of patterns) {
    let cursor = 0;
    do {
      const result = await redis.scan(cursor, { count: 100, match: pattern });
      cursor = Number(result[0]);
      for (const key of result[1]) keys.add(key);
    } while (cursor !== 0);
  }
  if (keys.size) await redis.del(...keys);
  for (const key of keys) if (Number(await redis.exists(key)) !== 0) return false;
  return true;
}

export function buildEvidence(config, state, cleanup) {
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    phase: "order-payment-event-blocked-checkout-production-proof",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    ciRunId: config.mainCiRunId,
    operatorCommit: config.operatorCommit ?? config.expectedCommit,
    operatorCiRunId: config.operatorCiRunId ?? config.mainCiRunId,
    deploymentId: config.deploymentId,
    stripe: {
      accountSha256: sha256(state.stripeAccountId),
      sessionSha256: sha256(state.stripeSessionId),
      checkoutEventSha256: sha256(state.checkoutEventId),
      paymentIntentSha256: sha256(state.paymentIntentId),
      chargeSha256: sha256(state.chargeId),
      transferSha256: sha256(state.transferId),
      refundSha256: sha256(state.refundId),
      reversalSha256: sha256(state.transferReversalId),
      refundEventSha256: sha256(state.refundEventId),
      buyerRefundAmountCents: state.refundAmountCents,
      sellerTransferReversalAmountCents: SELLER_TRANSFER_CENTS,
      genuineEmbeddedCheckoutCompleted: true,
      genuineSignedEventsDelivered: 2,
      exactSignedReplaysProven: 2,
      disposableConnectedAccountDeleted: cleanup.accountDeleted,
    },
    database: {
      retainedProcessedWebhookLeases: cleanup.processedWebhookCount,
      localPaymentEventSha256: sha256(state.localPaymentEventId),
      signedPaymentEventSha256: sha256(state.signedPaymentEventId),
      notificationSha256: sha256(state.notificationId),
      emailOutboxSha256: sha256(state.emailOutboxId),
      refundIssuedNotificationProven: true,
      wrongNewOrderSideEffectsAbsent: true,
      refundEmailSkippedByPreference: true,
      stockRestoredAndReactivated: true,
      temporaryApplicationRowsRemoved: cleanup.applicationRowsRemoved,
      operationalCanaryRestored: cleanup.canaryCount === 1,
    },
    clerkSessionsRevoked: cleanup.clerkSessionsRevoked,
    redisKeysRemoved: cleanup.redisKeysRemoved,
    productionChangedByProof: true,
    databaseChangeAfterCleanup: "two processed Stripe test-mode webhook replay leases retained",
    externalResidueAfterCleanup: "immutable Stripe test objects plus ordinary provider and observability telemetry retained",
    providerConfigurationChanged: false,
    liveMoneyMoved: false,
    secretsRetained: false,
  });
}

export function assertEvidence(value, config) {
  const hex = /^[a-f0-9]{64}$/;
  const stripeHashes = ["accountSha256", "sessionSha256", "checkoutEventSha256", "paymentIntentSha256",
    "chargeSha256", "transferSha256", "refundSha256", "reversalSha256", "refundEventSha256"];
  const databaseHashes = ["localPaymentEventSha256", "signedPaymentEventSha256", "notificationSha256", "emailOutboxSha256"];
  if (value?.phase !== "order-payment-event-blocked-checkout-production-proof" || value?.status !== "passed"
    || value?.mode !== "test" || value?.commit !== config.expectedCommit
    || value?.deployedSourceCommit !== config.deployedSourceCommit || String(value?.ciRunId) !== String(config.mainCiRunId)
    || value?.operatorCommit !== (config.operatorCommit ?? config.expectedCommit)
    || String(value?.operatorCiRunId) !== String(config.operatorCiRunId ?? config.mainCiRunId)
    || value?.deploymentId !== config.deploymentId || !stripeHashes.every((key) => hex.test(value?.stripe?.[key] ?? ""))
    || !databaseHashes.every((key) => hex.test(value?.database?.[key] ?? ""))
    || value?.stripe?.buyerRefundAmountCents < PRICE_CENTS
    || value?.stripe?.sellerTransferReversalAmountCents !== SELLER_TRANSFER_CENTS
    || value?.stripe?.genuineEmbeddedCheckoutCompleted !== true || value?.stripe?.genuineSignedEventsDelivered !== 2
    || value?.stripe?.exactSignedReplaysProven !== 2 || value?.stripe?.disposableConnectedAccountDeleted !== true
    || value?.database?.retainedProcessedWebhookLeases !== 2
    || value?.database?.refundIssuedNotificationProven !== true || value?.database?.wrongNewOrderSideEffectsAbsent !== true
    || value?.database?.refundEmailSkippedByPreference !== true || value?.database?.stockRestoredAndReactivated !== true
    || value?.database?.temporaryApplicationRowsRemoved !== true || value?.database?.operationalCanaryRestored !== true
    || value?.clerkSessionsRevoked !== true || value?.redisKeysRemoved !== true
    || value?.productionChangedByProof !== true || value?.providerConfigurationChanged !== false
    || value?.liveMoneyMoved !== false || value?.secretsRetained !== false) {
    throw new Error("blocked-checkout sanitized evidence drifted");
  }
  return Object.freeze(value);
}

async function readRefundIdentity(owner, state) {
  const result = await owner.query(`
    SELECT orders.id AS order_id, orders."sellerRefundId" AS refund_id,
      orders."sellerRefundAmountCents" AS refund_amount,
      (SELECT id FROM public."OrderItem" WHERE "orderId"=orders.id) AS item_id,
      (SELECT id FROM public."OrderPaymentEvent"
        WHERE "orderId"=orders.id AND "stripeEventId"='local:blocked_checkout_refund_recorded:'||orders."sellerRefundId") AS local_payment_id
    FROM public."Order" AS orders
    WHERE orders."stripeSessionId"=$1
  `, [state.stripeSessionId]);
  const row = result.rows[0];
  if (result.rowCount !== 1 || !row?.order_id || !/^re_[A-Za-z0-9_]+$/.test(String(row.refund_id ?? ""))
    || !Number.isSafeInteger(row.refund_amount) || row.refund_amount !== state.chargeAmountCents
    || !row.item_id || !row.local_payment_id) return null;
  return Object.freeze({
    localPaymentEventId: row.local_payment_id,
    orderId: row.order_id,
    orderItemId: row.item_id,
    refundAmountCents: row.refund_amount,
    refundId: row.refund_id,
  });
}

async function deleteExactRedisKeys(redis, state) {
  return scanAndDeleteExactRedisKeys(redis, [
    `rl:checkout:${state.buyerClerkId}:*`,
    `rl:shipping-quote:${state.buyerClerkId}:*`,
    `account-state:vercel-production:clerk:${state.buyerClerkId}`,
    state.checkoutLockKey ?? "grainline:no-matching-checkout-lock",
  ]);
}

async function deleteDisposableAccount(stripeOps, config, state) {
  if (!state.stripeAccountId) return true;
  const current = await stripeOps.retrieveAccount(state.stripeAccountId);
  if (current?.deleted === true) return current.id === state.stripeAccountId;
  assertConnectedAccount(current, config, state);
  const balance = await stripeOps.retrieveBalance(state.stripeAccountId);
  if (balanceTotal(balance) !== 0) throw new Error("blocked-checkout disposable account retained a nonzero balance");
  const deleted = await stripeOps.deleteAccount(state.stripeAccountId);
  return deleted?.deleted === true && deleted.id === state.stripeAccountId;
}

async function loadExecutionContext(config, state = null) {
  assertGitState(readGitState(config.cwd), config.operatorCommit ?? config.expectedCommit);
  verifyGitHubCi(config);
  const localValues = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const ownerValues = loadPrivateEnvironment(OWNER_ENV_PATH, "migration-owner environment file");
  const database = parseDatabaseUrls(localValues, ownerValues);
  const { clerkSecret, publishableKey, redisToken, redisUrl, stripeSecret } = validateProviderCredentials(localValues);
  const owner = postgresClient(database.ownerDatabaseUrl, "grainline_ope_blocked_owner");
  const runtime = postgresClient(database.runtimeDatabaseUrl, "grainline_ope_blocked_runtime");
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION });
  const clerk = createClerkClient({ secretKey: clerkSecret });
  const redis = new Redis({ url: redisUrl, token: redisToken });
  await owner.connect();
  await runtime.connect();
  try {
    await verifyDeployment(config);
    await verifyDatabaseBoundary(owner, runtime);
    const canary = await selectCanary(clerk, owner, state);
    return { canary, clerk, database, localValues, owner, publishableKey, redis, runtime, stripe, stripeSecret };
  } catch (error) {
    await Promise.allSettled([owner.end(), runtime.end()]);
    throw error;
  }
}

export async function prepareProof(config = validateConfiguration()) {
  if (existsSync(config.evidencePath)) throw new Error("blocked-checkout proof evidence already exists");
  if (config.operatorCommit !== config.expectedCommit && !existsSync(config.statePath)) {
    throw new Error("blocked-checkout corrected operator requires the preserved recovery state");
  }
  let state = existsSync(config.statePath)
    ? assertState(readPrivateJson(config.statePath, "blocked-checkout recovery state"), config)
    : null;
  const context = await loadExecutionContext(config, state);
  const { canary, clerk, owner, redis, runtime, stripe, stripeSecret } = context;
  let session = null;
  try {
    if (!state) {
      const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: canary.clerkId });
      if (active.totalCount !== 0 || active.data.length !== 0) throw new Error("blocked-checkout canary has a pre-existing active session");
      state = createInitialState(config, canary);
      writePrivateJson(config.statePath, state);
    }
    const stripeOps = stripeDependencies(stripe, stripeSecret, config, state);
    const provider = await readProviderState(stripeOps);
    if (provider.stage !== 4 || provider.platform?.url !== PLATFORM_WEBHOOK_URL || provider.platform?.status !== "enabled") {
      throw new Error("blocked-checkout proof requires the active stage-4 platform webhook");
    }
    if (state.stage === "reserved") state = updateState(config, state, { stage: "account-create-pending" });
    if (state.stage === "account-create-pending") {
      const created = await stripeOps.createAccount();
      const account = await waitFor(
        () => stripeOps.retrieveAccount(created.id),
        (candidate) => { try { assertConnectedAccount(candidate, config, state); return true; } catch { return false; } },
        "blocked-checkout disposable transfer capability", 40, 1500,
      );
      assertConnectedAccount(account, config, state);
      state = updateState(config, state, { stage: "account-created", stripeAccountId: account.id });
    }
    if (state.stage === "account-created") {
      state = updateState(config, state, { stage: "fixtures-create-pending" });
    }
    if (state.stage === "fixtures-create-pending") {
      await createFixtures(owner, state);
      await redis.del(`account-state:vercel-production:clerk:${state.buyerClerkId}`);
      state = updateState(config, state, { stage: "fixtures-created" });
    }
    if (state.stage === "fixtures-created") state = updateState(config, state, { stage: "checkout-create-pending" });
    if (state.stage === "checkout-create-pending") {
      session = await createCanarySession(clerk, state.buyerClerkId);
      const denied = await createCheckout(session.jwt, state, {
        objectId: "pickup", amountCents: 0, currency: "usd", displayName: "Local pickup",
        carrier: "Grainline", estDays: 1, subjectHash: "invalid", token: "invalid", expiresAt: 0,
      }, "https://example.invalid");
      if (denied.status !== 403 || denied.body?.error !== "Forbidden") throw new Error("blocked-checkout checkout route did not reject cross-origin POST");
      const selectedRate = await signedPickupRate(session.jwt, state);
      const created = assertCheckoutResponse(await createCheckout(session.jwt, state, selectedRate));
      const retrieved = await stripeOps.retrieveSession(created.sessionId);
      if (retrieved.livemode !== false || retrieved.status !== "open" || retrieved.payment_status !== "unpaid"
        || retrieved.metadata?.buyerId !== state.buyerId || retrieved.metadata?.sellerId !== state.sellerProfileId
        || retrieved.metadata?.listingId !== state.listingId) {
        throw new Error("blocked-checkout prepared Stripe Session drifted");
      }
      const retry = assertCheckoutResponse(await createCheckout(session.jwt, state, selectedRate), created.sessionId);
      if (retry.clientSecret !== created.clientSecret) throw new Error("blocked-checkout exact route retry changed the client secret");
      const preparedState = { ...state, stripeSessionId: created.sessionId };
      const prepared = assertPreparedSnapshot(await readPreparedSnapshot(owner, preparedState), preparedState, false);
      state = updateState(config, state, {
        stage: "checkout-created",
        stripeSessionId: created.sessionId,
        stripeClientSecret: created.clientSecret,
        checkoutLockKey: prepared.checkoutLockKey,
        reservationId: prepared.reservationId,
      });
    }
    if (state.stage === "checkout-created") {
      await blockFixtureSeller(owner, state);
      assertPreparedSnapshot(await readPreparedSnapshot(owner, state), state, true);
      state = updateState(config, state, { stage: "seller-blocked" });
    }
    if (state.stage !== "seller-blocked") throw new Error("blocked-checkout prepare reached an unsupported recovery stage");
    assertConnectedAccount(await stripeOps.retrieveAccount(state.stripeAccountId), config, state);
    assertPreparedSnapshot(await readPreparedSnapshot(owner, state), state, true);
    if (session) await revokeCanarySessions(clerk, state.buyerClerkId);
    process.stdout.write(`${JSON.stringify({
      phase: "order-payment-event-blocked-checkout-production-proof",
      status: "payment-required",
      next: `ORDER_PAYMENT_BLOCKED_CHECKOUT_COMMAND=serve ... node scripts/order-payment-event-blocked-checkout-production-proof.mjs`,
      loopbackUrl: `http://127.0.0.1:${config.port}/`,
    })}\n`);
    return state;
  } finally {
    if (session) await revokeCanarySessions(clerk, state?.buyerClerkId).catch(() => {});
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

export async function servePaymentPage(config = validateConfiguration()) {
  assertGitState(readGitState(config.cwd), config.operatorCommit ?? config.expectedCommit);
  verifyGitHubCi(config);
  const state = assertState(readPrivateJson(config.statePath, "blocked-checkout recovery state"), config);
  if (state.stage !== "seller-blocked") throw new Error("blocked-checkout payment page requires seller-blocked state");
  const values = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const publishableKey = required(values, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const page = buildPaymentPage(publishableKey, state.stripeClientSecret);
  const server = http.createServer((request, response) => {
    const remote = request.socket.remoteAddress;
    const host = request.headers.host ?? "";
    if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(String(remote))
      || !new RegExp(`^(?:127\\.0\\.0\\.1|localhost):${config.port}$`).test(host)) {
      response.writeHead(403, { "cache-control": "no-store" }).end("Forbidden");
      return;
    }
    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404, { "cache-control": "no-store" }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store, max-age=0",
      "content-security-policy": "default-src 'none'; script-src https://js.stripe.com 'unsafe-inline'; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src https://api.stripe.com https://r.stripe.com; style-src 'unsafe-inline'; img-src data: https://*.stripe.com",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(page);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  process.stdout.write(`${JSON.stringify({ blockedCheckoutPaymentPage: "ready", url: `http://127.0.0.1:${config.port}/` })}\n`);
  await new Promise((resolve) => {
    const close = () => server.close(() => resolve());
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

export async function verifyAndCleanupProof(config = validateConfiguration()) {
  let state = assertState(readPrivateJson(config.statePath, "blocked-checkout recovery state"), config);
  if (STAGES.indexOf(state.stage) < STAGES.indexOf("seller-blocked")) {
    throw new Error("blocked-checkout verification requires prepared seller-blocked state");
  }
  const context = await loadExecutionContext(config, state);
  const { clerk, owner, redis, runtime, stripe, stripeSecret } = context;
  try {
    const stripeOps = stripeDependencies(stripe, stripeSecret, config, state);
    const provider = await readProviderState(stripeOps);
    if (provider.stage !== 4 || provider.platform?.url !== PLATFORM_WEBHOOK_URL || provider.platform?.status !== "enabled") {
      throw new Error("blocked-checkout verification requires the active stage-4 platform webhook");
    }
    if (state.stage === "seller-blocked") {
      const completed = await waitFor(
        () => stripeOps.retrieveSession(state.stripeSessionId),
        (candidate) => candidate?.status === "complete" && candidate?.payment_status === "paid",
        "blocked-checkout Embedded Checkout completion", 10, 1000,
      );
      const payment = assertCompletedSession(completed, state);
      state = updateState(config, state, { stage: "payment-completed", ...payment });
    }
    if (state.stage === "payment-completed") {
      const createdAfter = Math.floor(Date.parse(state.startedAt) / 1000) - 5;
      const checkoutEvents = await waitFor(
        () => stripeOps.listCheckoutEvents(createdAfter),
        (events) => Boolean(exactCheckoutEvent(events, state)),
        "blocked-checkout signed Checkout event",
      );
      const checkoutEvent = exactCheckoutEvent(checkoutEvents, state);
      const refundIdentity = await waitFor(
        () => readRefundIdentity(owner, state),
        Boolean,
        "blocked-checkout durable local refund",
      );
      const refund = await waitFor(
        () => stripeOps.retrieveRefund(refundIdentity.refundId),
        (candidate) => ["pending", "requires_action", "succeeded"].includes(candidate?.status),
        "blocked-checkout provider refund",
      );
      const providerRefund = assertRefund(refund, {
        ...state,
        refundId: refundIdentity.refundId,
      });
      const pendingState = {
        ...state,
        ...refundIdentity,
        ...providerRefund,
        checkoutEventId: checkoutEvent.id,
      };
      const refundEvents = await waitFor(
        () => stripeOps.listRefundEvents(createdAfter),
        (events) => Boolean(exactRefundEvent(events, pendingState)),
        "blocked-checkout signed refund event",
      );
      const refundEvent = exactRefundEvent(refundEvents, pendingState);
      const proofState = { ...pendingState, refundEventId: refundEvent.id };
      const snapshot = await waitFor(
        () => readDeliverySnapshot(owner, proofState),
        (row) => { try { assertDeliverySnapshot(row, proofState); return true; } catch { return false; } },
        "blocked-checkout delivery effects",
      );
      const delivered = assertDeliverySnapshot(snapshot, proofState);
      state = updateState(config, state, {
        stage: "delivery-confirmed",
        ...refundIdentity,
        ...providerRefund,
        checkoutEventId: checkoutEvent.id,
        refundEventId: refundEvent.id,
        localPaymentEventId: delivered.localPaymentId,
        signedPaymentEventId: delivered.signedPaymentId,
        notificationId: delivered.notificationId,
        emailOutboxId: delivered.outboxId,
      });
    }
    const delivered = await readDeliverySnapshot(owner, state);
    if (state.stage === "delivery-confirmed") state = updateState(config, state, { stage: "replay-pending" });
    if (state.stage === "replay-pending") {
      stripeOps.resendEvent(provider.platform.id, state.checkoutEventId);
      stripeOps.resendEvent(provider.platform.id, state.refundEventId);
      await waitFor(
        () => readDeliverySnapshot(owner, state),
        (row) => { try { assertReplayUnchanged(delivered, row, state); return true; } catch { return false; } },
        "blocked-checkout exact signed replays", 30, 1000,
      );
      assertReplayUnchanged(delivered, await readDeliverySnapshot(owner, state), state);
      state = updateState(config, state, { stage: "replayed" });
    }
    if (state.stage === "replayed") state = updateState(config, state, { stage: "cleanup-started" });
    if (state.stage === "cleanup-started") {
      await revokeCanarySessions(clerk, state.buyerClerkId);
      const before = await readCleanupSnapshot(owner, state);
      if (Number(before.order_count) === 1) await cleanupDeliveredRows(owner, state);
      assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
      const redisKeysRemoved = await deleteExactRedisKeys(redis, state);
      if (!redisKeysRemoved) throw new Error("blocked-checkout Redis cleanup failed");
      if (!await deleteDisposableAccount(stripeOps, config, state)) {
        throw new Error("blocked-checkout disposable connected account deletion failed");
      }
      state = updateState(config, state, { stage: "cleaned" });
    }
    if (state.stage !== "cleaned") throw new Error("blocked-checkout verification reached an unsupported recovery stage");
    const cleanupSnapshot = assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
    const deletedAccount = await stripeOps.retrieveAccount(state.stripeAccountId);
    if (deletedAccount?.deleted !== true || deletedAccount.id !== state.stripeAccountId) {
      throw new Error("blocked-checkout cleaned account evidence drifted");
    }
    const cleanup = {
      accountDeleted: true,
      applicationRowsRemoved: true,
      canaryCount: cleanupSnapshot.canary_count,
      clerkSessionsRevoked: await revokeCanarySessions(clerk, state.buyerClerkId),
      processedWebhookCount: cleanupSnapshot.processed_webhook_count,
      redisKeysRemoved: await deleteExactRedisKeys(redis, state),
    };
    const evidence = assertEvidence(buildEvidence(config, state, cleanup), config);
    const serialized = JSON.stringify(evidence);
    for (const sensitive of [
      context.database.ownerDatabaseUrl, context.database.runtimeDatabaseUrl, stripeSecret,
      state.stripeClientSecret, state.buyerId, state.buyerClerkId, state.buyerEmail,
      state.sellerUserId, state.sellerClerkId, state.sellerEmail, state.sellerProfileId, state.listingId,
      state.stripeAccountId, state.stripeSessionId, state.checkoutLockKey, state.reservationId, state.orderId,
      state.orderItemId, state.checkoutEventId, state.refundEventId,
    ]) if (sensitive && serialized.includes(sensitive)) throw new Error("blocked-checkout evidence retained a secret or raw identity");
    writePrivateJson(config.evidencePath, evidence);
    unlinkSync(config.statePath);
    return evidence;
  } finally {
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

async function cleanupUnpaidFixtures(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    assertCanaryFenced(await lockCanaryFence(owner, state));
    const exact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."Order" WHERE "stripeSessionId"=$1) AS orders,
        (SELECT count(*)::integer FROM public."CheckoutStockReservation" WHERE id=$2 AND "stripeSessionId"=$1
          AND status='RESTORED' AND "buyerId"=$3 AND "sellerId"=$4) AS reservation,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$5 AND "sellerId"=$4 AND "stockQuantity"=1
          AND status='ACTIVE' AND "reservedForUserId"=$3) AS listing,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$4 AND "stripeAccountId"=$6
          AND "vacationMode"=true) AS seller,
        (SELECT count(*)::integer FROM public."User" WHERE id=$7 AND "clerkId"=$8 AND email=$9) AS seller_user
    `, [state.stripeSessionId, state.reservationId, state.buyerId, state.sellerProfileId, state.listingId,
      state.stripeAccountId, state.sellerUserId, state.sellerClerkId, state.sellerEmail]);
    for (const [key, expected] of Object.entries({ orders: 0, reservation: 1, listing: 1, seller: 1, seller_user: 1 })) {
      if (Number(exact.rows[0]?.[key]) !== expected) throw new Error(`blocked-checkout abort ${key} relationship drifted`);
    }
    if (resultCardinality(await owner.query(`DELETE FROM public."CheckoutStockReservation" WHERE id=$1 RETURNING id`, [state.reservationId])) !== 1
      || resultCardinality(await owner.query(`DELETE FROM public."Listing" WHERE id=$1 RETURNING id`, [state.listingId])) !== 1
      || resultCardinality(await owner.query(`DELETE FROM public."SellerProfile" WHERE id=$1 RETURNING id`, [state.sellerProfileId])) !== 1
      || resultCardinality(await owner.query(`DELETE FROM public."User" WHERE id=$1 RETURNING id`, [state.sellerUserId])) !== 1) {
      throw new Error("blocked-checkout abort cleanup cardinality drifted");
    }
    const restored = await owner.query(`UPDATE public."User" SET "notificationPreferences"=$2::jsonb,
      "termsAcceptedAt"=$3::timestamp,"termsVersion"=$4,"ageAttestedAt"=$5::timestamp,"updatedAt"=CURRENT_TIMESTAMP
      WHERE id=$1 AND "clerkId"=$6 RETURNING id`, [state.buyerId, JSON.stringify(state.originalNotificationPreferences),
      state.originalTermsAcceptedAt, state.originalTermsVersion, state.originalAgeAttestedAt, state.buyerClerkId]);
    if (restored.rows.length !== 1) throw new Error("blocked-checkout abort canary restoration drifted");
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export function assertAbortCleanupStage(state) {
  const stage = state?.stage;
  const at = STAGES.indexOf(stage);
  if (at < 0) throw new Error("blocked-checkout abort state is invalid");
  if (at >= STAGES.indexOf("payment-completed")) {
    throw new Error("blocked-checkout paid state must be completed with verify, not aborted");
  }
  if (new Set([
    "account-create-pending",
    "fixtures-create-pending",
    "fixtures-created",
    "checkout-create-pending",
    "checkout-created",
  ]).has(stage)) {
    throw new Error(
      "blocked-checkout ambiguous prepare state must resume prepare to a persisted cleanup checkpoint before abort cleanup",
    );
  }
  return stage;
}

export async function cleanupProof(config = validateConfiguration()) {
  const state = assertState(readPrivateJson(config.statePath, "blocked-checkout recovery state"), config);
  assertAbortCleanupStage(state);
  const context = await loadExecutionContext(config, state);
  const { clerk, owner, redis, runtime, stripe, stripeSecret } = context;
  try {
    const stripeOps = stripeDependencies(stripe, stripeSecret, config, state);
    if (state.stripeSessionId) {
      const session = await stripeOps.retrieveSession(state.stripeSessionId);
      if (session.payment_status === "paid" || session.status === "complete") {
        throw new Error("blocked-checkout cleanup found a paid session; run verify");
      }
      if (session.status === "open") await stripe.checkout.sessions.expire(state.stripeSessionId);
      await waitFor(
        () => readPreparedSnapshot(owner, state),
        (row) => row?.reservation_status === "RESTORED" && Number(row?.stock) === 1,
        "blocked-checkout signed expiry restoration",
      );
      await cleanupUnpaidFixtures(owner, state);
    }
    await revokeCanarySessions(clerk, state.buyerClerkId);
    await deleteExactRedisKeys(redis, state);
    if (!await deleteDisposableAccount(stripeOps, config, state)) throw new Error("blocked-checkout abort account deletion failed");
    unlinkSync(config.statePath);
    process.stdout.write(`${JSON.stringify({ phase: "order-payment-event-blocked-checkout-production-proof", status: "aborted-clean" })}\n`);
  } finally {
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

async function main() {
  let config;
  try {
    config = validateConfiguration();
    if (config.command === "prepare") await prepareProof(config);
    else if (config.command === "serve") await servePaymentPage(config);
    else if (config.command === "verify") {
      const result = await verifyAndCleanupProof(config);
      process.stdout.write(`${JSON.stringify({ phase: result.phase, status: result.status, commit: result.commit,
        ciRunId: result.ciRunId, deploymentId: result.deploymentId })}\n`);
    } else await cleanupProof(config);
  } catch (error) {
    process.stderr.write(`OrderPaymentEvent blocked-checkout production proof failed closed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
