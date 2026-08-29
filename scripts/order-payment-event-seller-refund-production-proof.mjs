#!/usr/bin/env node
// Restart-safe authenticated production proof for the seller full-refund
// authority. Stripe operations are test-mode only. Review/merge does not
// authorize execution.
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
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { Redis } from "@upstash/redis";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { readProviderState } from "./stripe-connect-provider-cutover.mjs";
import { assertStripeRefundObject } from "./stripe-refund-object-proof.mjs";
import {
  assertGitState,
  parseDatabaseUrls,
  parseGitHubCiRun,
  parseVercelDeployment,
  validateStripeSecret,
} from "./seller-payout-event-linked-production-proof.mjs";

const { Client } = pg;

export const CONFIRMATION = "reviewed-order-payment-seller-refund-production-proof";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PLATFORM_WEBHOOK_URL = `${PRODUCTION_ORIGIN}/api/stripe/webhook`;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const REFUND_AMOUNT_CENTS = 500;
export const TRANSFER_AMOUNT_CENTS = 475;
export const STRIPE_METADATA_KEY_MAX_LENGTH = 40;
export const STRIPE_PROOF_METADATA_KEY = "grainline_seller_refund_proof";
export const CONNECTED_ACCOUNT_CONTROLLER = Object.freeze({
  fees: Object.freeze({ payer: "application" }),
  losses: Object.freeze({ payments: "application" }),
  requirement_collection: "stripe",
  stripe_dashboard: Object.freeze({ type: "express" }),
});
export const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_CLI_VERSION = "1.39.0";
const VERCEL_CLI_VERSION = "58.9.0";
const PRODUCTION_DATABASE_NAME = "neondb";
const CLERK_FRONTEND_API = "clerk.thegrainline.com";
const MAX_PRIVATE_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_PATTERN = /\b(?:acct|ch|evt|pi|re|tr|trr|we)_[A-Za-z0-9_]+\b/g;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CONNECT_ONBOARDING_URL_PATTERN = /https:\/\/connect\.stripe\.com\/setup\/[^\s"']+/gi;
const FIXTURE_PATTERN = /\bopesr_[a-f0-9]{32}(?:_[a-z]+)?\b/g;
const EXPECTED_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});
const STAGES = Object.freeze([
  "reserved",
  "account-create-pending",
  "account-created",
  "payment-create-pending",
  "payment-created",
  "fixtures-created",
  "refund-route-pending",
  "refund-returned",
  "signed-confirmed",
  "route-retry-proven",
  "signed-replay-pending",
  "signed-replayed",
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
    .replace(CONNECT_ONBOARDING_URL_PATTERN, "[redacted-onboarding-url]")
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
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
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
  const command = env.ORDER_PAYMENT_SELLER_REFUND_COMMAND || "run";
  if (!new Set(["run", "onboard"]).has(command)) {
    throw new Error("seller refund proof command is invalid");
  }
  const expectedCommit = required(env, "ORDER_PAYMENT_SELLER_REFUND_EXPECTED_COMMIT");
  const hasOperatorCommit = env.ORDER_PAYMENT_SELLER_REFUND_OPERATOR_COMMIT !== undefined;
  const hasOperatorCiRunId = env.ORDER_PAYMENT_SELLER_REFUND_OPERATOR_CI_RUN_ID !== undefined;
  if (hasOperatorCommit !== hasOperatorCiRunId) {
    throw new Error("seller refund operator commit and CI inputs must be supplied together");
  }
  const operatorCommit = hasOperatorCommit
    ? required(env, "ORDER_PAYMENT_SELLER_REFUND_OPERATOR_COMMIT")
    : expectedCommit;
  const deployedSourceCommit = required(env, "ORDER_PAYMENT_SELLER_REFUND_DEPLOYED_SOURCE_COMMIT");
  const signedProofCommit = required(env, "ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_COMMIT");
  const deploymentId = required(env, "ORDER_PAYMENT_SELLER_REFUND_DEPLOYMENT_ID");
  if (![expectedCommit, operatorCommit, deployedSourceCommit, signedProofCommit].every((value) => COMMIT_PATTERN.test(value))) {
    throw new Error("seller refund proof commit input is invalid");
  }
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("seller refund deployment id is invalid");
  if (required(env, "ORDER_PAYMENT_SELLER_REFUND_CONFIRM") !== CONFIRMATION) {
    throw new Error("seller refund proof confirmation is invalid");
  }
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_SELLER_REFUND_MAIN_CI_RUN_ID");
  const operatorCiRunId = hasOperatorCiRunId
    ? positiveInteger(env, "ORDER_PAYMENT_SELLER_REFUND_OPERATOR_CI_RUN_ID")
    : mainCiRunId;
  const signedProofCiRunId = positiveInteger(env, "ORDER_PAYMENT_SELLER_REFUND_SIGNED_PROOF_CI_RUN_ID");
  const suffix = expectedCommit.slice(0, 12);
  return Object.freeze({
    cwd,
    command,
    expectedCommit,
    operatorCommit,
    deployedSourceCommit,
    signedProofCommit,
    mainCiRunId,
    operatorCiRunId,
    signedProofCiRunId,
    deploymentId,
    stripeCliPath: required(env, "ORDER_PAYMENT_SELLER_REFUND_STRIPE_CLI_PATH"),
    vercelProjectDirectory: env.VERCEL_PROJECT_DIRECTORY || "/Users/drewyoung/grainline",
    signedEvidencePath: required(env, "ORDER_PAYMENT_SELLER_REFUND_SIGNED_EVIDENCE_PATH"),
    statePath: env.ORDER_PAYMENT_SELLER_REFUND_STATE_PATH
      || path.join(EVIDENCE_DIRECTORY, `order-payment-event-seller-refund-state-${suffix}.json`),
    onboardingPath: path.join(
      EVIDENCE_DIRECTORY,
      `order-payment-event-seller-refund-onboarding-${suffix}.json`,
    ),
    evidencePath: env.ORDER_PAYMENT_SELLER_REFUND_EVIDENCE_PATH
      || path.join(EVIDENCE_DIRECTORY, `order-payment-event-seller-refund-proof-${suffix}.json`),
  });
}

export function assertSignedPredecessorEvidence(payload, config) {
  if (
    payload?.phase !== "order-payment-event-signed-production-proof"
    || payload?.status !== "passed"
    || payload?.mode !== "test"
    || payload?.commit !== config.signedProofCommit
    || String(payload?.ciRunId) !== String(config.signedProofCiRunId)
    || payload?.deployedSourceCommit !== config.deployedSourceCommit
    || payload?.deploymentId !== config.deploymentId
    || payload?.providerStage !== 4
    || payload?.stripe?.requiredResendTransitionsCompleted !== 3
    || payload?.stripe?.exactReplayProofs !== 2
    || payload?.database?.retainedProcessedWebhookLeases !== 2
    || payload?.database?.temporaryApplicationRowsRemoved !== true
    || payload?.database?.exactRetriesLeftApplicationIdentitiesUnchanged !== true
    || payload?.providerConfigurationChanged !== false
    || payload?.liveMoneyMoved !== false
  ) throw new Error("seller refund proof predecessor evidence drifted");
  return Object.freeze(payload);
}

function fixtureId(suffix = "") {
  return `opesr_${randomUUID().replaceAll("-", "")}${suffix}`;
}

export function createInitialState(config, canary) {
  const attemptId = randomUUID();
  return assertState({
    version: 1,
    stage: "reserved",
    expectedCommit: config.expectedCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    mainCiRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
    signedProofCommit: config.signedProofCommit,
    signedProofCiRunId: config.signedProofCiRunId,
    attemptId,
    startedAt: new Date().toISOString(),
    sellerUserId: canary.id,
    sellerClerkId: canary.clerkId,
    sellerProfileId: fixtureId("_seller"),
    buyerId: fixtureId("_buyer"),
    buyerClerkId: fixtureId("_buyer"),
    buyerEmail: `${fixtureId("_buyer")}@example.invalid`,
    listingId: fixtureId("_listing"),
    orderId: fixtureId("_order"),
    orderItemId: fixtureId("_item"),
    caseId: fixtureId("_case"),
    stripeAccountId: null,
    paymentIntentId: null,
    chargeId: null,
    transferId: null,
    refundId: null,
    transferReversalId: null,
    signedEventId: null,
    localPaymentEventId: null,
    signedPaymentEventId: null,
    caseApplicationId: null,
    notificationId: null,
    emailOutboxId: null,
  }, config);
}

function nullableStripeId(value, prefix) {
  if (value === null) return null;
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) {
    throw new Error(`seller refund ${prefix} identity is invalid`);
  }
  return value;
}

export function assertState(value, config) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("seller refund state must be one object");
  }
  if (value.version !== 1 || !STAGES.includes(value.stage)) throw new Error("seller refund state version or stage drifted");
  const allowed = new Set([
    "version", "stage", "expectedCommit", "deployedSourceCommit", "mainCiRunId",
    "deploymentId", "signedProofCommit", "signedProofCiRunId", "attemptId",
    "startedAt", "sellerUserId", "sellerClerkId", "sellerProfileId",
    "buyerId", "buyerClerkId", "buyerEmail", "listingId", "orderId",
    "orderItemId", "caseId", "stripeAccountId", "paymentIntentId", "chargeId",
    "transferId", "refundId", "transferReversalId", "signedEventId",
    "localPaymentEventId", "signedPaymentEventId", "caseApplicationId",
    "notificationId", "emailOutboxId",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`seller refund state contains unknown field ${unknown[0]}`);
  for (const [key, expected] of Object.entries({
    expectedCommit: config.expectedCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    mainCiRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
    signedProofCommit: config.signedProofCommit,
    signedProofCiRunId: config.signedProofCiRunId,
  })) {
    if (String(value[key]) !== String(expected)) throw new Error(`seller refund state ${key} drifted`);
  }
  if (!/^[a-f0-9-]{36}$/.test(value.attemptId) || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error("seller refund state attempt clock drifted");
  }
  for (const key of [
    "sellerUserId", "sellerProfileId", "buyerId", "buyerClerkId", "listingId",
    "orderId", "orderItemId", "caseId",
  ]) {
    if (typeof value[key] !== "string" || value[key].length < 8 || value[key].length > 191) {
      throw new Error(`seller refund state ${key} is invalid`);
    }
  }
  if (!/^user_[A-Za-z0-9]+$/.test(value.sellerClerkId)) throw new Error("seller refund Clerk identity is invalid");
  if (!value.buyerEmail.endsWith("@example.invalid") || value.buyerEmail.length > 254) {
    throw new Error("seller refund buyer email is invalid");
  }
  nullableStripeId(value.stripeAccountId, "acct");
  nullableStripeId(value.paymentIntentId, "pi");
  nullableStripeId(value.chargeId, "ch");
  nullableStripeId(value.transferId, "tr");
  nullableStripeId(value.refundId, "re");
  nullableStripeId(value.transferReversalId, "trr");
  nullableStripeId(value.signedEventId, "evt");
  for (const key of ["localPaymentEventId", "signedPaymentEventId", "caseApplicationId", "notificationId", "emailOutboxId"]) {
    if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 191)) {
      throw new Error(`seller refund state ${key} is invalid`);
    }
  }
  const stageIndex = STAGES.indexOf(value.stage);
  const requireAt = (stage, keys) => {
    if (stageIndex < STAGES.indexOf(stage)) return;
    for (const key of keys) {
      if (!value[key]) throw new Error(`seller refund state ${key} is missing at ${value.stage}`);
    }
  };
  requireAt("account-created", ["stripeAccountId"]);
  requireAt("payment-created", ["paymentIntentId", "chargeId", "transferId"]);
  requireAt("refund-returned", ["refundId", "transferReversalId"]);
  requireAt("signed-confirmed", [
    "signedEventId", "localPaymentEventId", "signedPaymentEventId",
    "caseApplicationId", "notificationId", "emailOutboxId",
  ]);
  return Object.freeze({ ...value });
}

function updateState(config, state, update) {
  const next = assertState({ ...state, ...update }, config);
  writePrivateJson(config.statePath, next);
  return next;
}

function readGitState(cwd) {
  const run = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return { branch: run(["branch", "--show-current"]), head: run(["rev-parse", "HEAD"]), status: run(["status", "--porcelain=v1", "--untracked-files=all"]) };
}

function childEnvironment(extra = {}) {
  const environment = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function command(name, args, { cwd, env, label = name, timeout = 60_000 } = {}) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8", env: env ?? childEnvironment(), maxBuffer: 1024 * 1024, timeout });
  if (result.error || result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? "unknown"}`);
  return result.stdout;
}

function readGitHubCiRun(runId) {
  return execFileSync("gh", [
    "run", "view", String(runId), "--json",
    "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
  ], { encoding: "utf8", env: childEnvironment({
    ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}),
    ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}),
  }), stdio: ["ignore", "pipe", "pipe"] });
}

export function assertExecutionBindings(gitState, attemptCi, operatorCi, config) {
  const operatorCommit = config.operatorCommit ?? config.expectedCommit;
  const operatorCiRunId = config.operatorCiRunId ?? config.mainCiRunId;
  assertGitState(gitState, operatorCommit);
  parseGitHubCiRun(attemptCi, config.expectedCommit, config.mainCiRunId);
  parseGitHubCiRun(operatorCi, operatorCommit, operatorCiRunId);
  return Object.freeze({
    attemptCommit: config.expectedCommit,
    attemptCiRunId: config.mainCiRunId,
    operatorCommit,
    operatorCiRunId,
  });
}

function verifyExecutionBindings(config) {
  const operatorCiRunId = config.operatorCiRunId ?? config.mainCiRunId;
  const attemptCi = readGitHubCiRun(config.mainCiRunId);
  const operatorCi = operatorCiRunId === config.mainCiRunId
    ? attemptCi
    : readGitHubCiRun(operatorCiRunId);
  return assertExecutionBindings(readGitState(config.cwd), attemptCi, operatorCi, config);
}

function assertVercelProject(config) {
  const project = JSON.parse(readFileSync(path.join(config.vercelProjectDirectory, ".vercel", "project.json"), "utf8"));
  for (const [key, expected] of Object.entries(EXPECTED_PROJECT)) {
    if (project?.[key] !== expected) throw new Error("seller refund Vercel project identity drifted");
  }
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("seller refund response exceeded bound");
  return value;
}

async function boundedJson(response) {
  const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("seller refund route response was not an object");
  return value;
}

async function verifyDeployment(config) {
  assertVercelProject(config);
  const raw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "api", `/v13/deployments/${config.deploymentId}`,
    "--raw", "--cwd", config.vercelProjectDirectory, "--no-color",
  ], { cwd: config.vercelProjectDirectory, env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}), label: "seller refund deployment lookup" });
  parseVercelDeployment(raw, config);
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const healthBody = JSON.parse(await boundedText(health, MAX_PRIVATE_BYTES));
  if (health.status !== 200 || healthBody?.ok !== true) throw new Error("seller refund production health failed");
  const page = await fetch(PRODUCTION_ORIGIN, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const body = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !body.includes(`dpl=${config.deploymentId}`)) throw new Error("seller refund canonical alias drifted");
  return Object.freeze({ canonicalDeploymentMarker: true, healthStatus: 200 });
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
  const ownerIdentity = await owner.query("SELECT current_user AS role, current_database() AS database");
  const runtimeIdentity = await runtime.query("SELECT current_user AS role, current_database() AS database");
  const posture = await owner.query(`
      SELECT relation.relrowsecurity AS enabled, relation.relforcerowsecurity AS forced,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'SELECT') AS can_select,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'INSERT') AS can_insert,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'UPDATE') AS can_update,
        pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'DELETE') AS can_delete
      FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'OrderPaymentEvent'
    `);
  const functions = await owner.query(`
      WITH expected(signature) AS (VALUES
        ('public.grainline_seller_refund_claim(text,text)'),
        ('public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)'),
        ('public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)'),
        ('public.grainline_case_seller_refund_apply(text,text)'),
        ('public.grainline_notification_create_order_event(text,text,public."NotificationType",text,text,text)')
      )
      SELECT pg_catalog.count(*)::integer AS count,
        pg_catalog.count(*) FILTER (WHERE routine.oid IS NOT NULL AND routine.prosecdef = true
          AND routine.provolatile = 'v' AND routine.proparallel = 'u'
          AND routine.proconfig @> ARRAY['search_path=pg_catalog']::text[]
          AND pg_catalog.has_function_privilege('${RUNTIME_ROLE}', routine.oid, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'))::integer AS valid
      FROM expected LEFT JOIN LATERAL (SELECT procedure_row.* FROM pg_catalog.pg_proc AS procedure_row
        WHERE procedure_row.oid = pg_catalog.to_regprocedure(expected.signature)) AS routine ON true
    `);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(posture.rows, [{ enabled: false, forced: false, can_select: true, can_insert: true, can_update: true, can_delete: true }]);
  assert.deepEqual(functions.rows, [{ count: 5, valid: 5 }]);
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") return listPromise.autoPagingToArray({ limit: 1000 });
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

export async function listAccountsBounded(listPage, maxAccounts = 1000) {
  if (typeof listPage !== "function" || !Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 1000) {
    throw new Error("seller refund account-list bound is invalid");
  }
  const accounts = [];
  let startingAfter = null;
  for (;;) {
    const page = await listPage({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (!page || !Array.isArray(page.data) || typeof page.has_more !== "boolean"
      || page.data.length > 100
      || page.data.some((account) => !/^acct_[A-Za-z0-9_]+$/.test(String(account?.id ?? "")))) {
      throw new Error("seller refund account-list page drifted");
    }
    accounts.push(...page.data);
    if (accounts.length > maxAccounts) throw new Error("seller refund account listing exceeded its proof bound");
    if (!page.has_more) {
      return Object.freeze({
        accounts: Object.freeze([...accounts]),
        exhausted: true,
      });
    }
    if (page.data.length === 0 || accounts.length >= maxAccounts) {
      throw new Error("seller refund account listing did not prove exhaustion within its bound");
    }
    startingAfter = page.data.at(-1).id;
  }
}

function stripeDependencies(stripe, secretKey, config, state) {
  const idempotency = (key) => ({ idempotencyKey: `grainline-ope-seller-refund-${config.expectedCommit}-${state.attemptId}-${key}` });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({ include: ["webhook_endpoint.url"], limit: 100 })),
    createAccount: () => stripe.accounts.create(
      buildConnectedAccountParams(config, state),
      idempotency("account-v2-express-stripe-collector"),
    ),
    createOnboardingLink: (accountId) => stripe.accountLinks.create(
      buildConnectedAccountLinkParams(accountId),
      idempotency(`hosted-onboarding-v1-${randomUUID()}`),
    ),
    listAccounts: () => listAccountsBounded((params) => stripe.accounts.list(params)),
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
    deleteAccount: (id) => stripe.accounts.del(id),
    createPayment: (accountId) => stripe.paymentIntents.create({
      amount: REFUND_AMOUNT_CENTS,
      currency: "usd",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      transfer_data: { destination: accountId, amount: TRANSFER_AMOUNT_CENTS },
      description: "Grainline seller refund authority proof",
      metadata: buildStripeProofMetadata(config, state),
    }, idempotency("payment")),
    retrieveCharge: (id) => stripe.charges.retrieve(id, { expand: ["transfer"] }),
    retrieveRefund: (id) => stripe.refunds.retrieve(id, { expand: ["transfer_reversal"] }),
    listChargeRefunds: (chargeId) => listAll(stripe.refunds.list({ charge: chargeId, limit: 100 })),
    listRefundEvents: (createdAfter) => listAll(stripe.events.list({ created: { gte: createdAfter }, limit: 100, type: "charge.refunded" })),
    retrieveBalance: (accountId) => stripe.balance.retrieve({}, { stripeAccount: accountId }),
    resendEvent(endpointId, eventId) {
      const cliRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-ope-seller-refund-cli-"));
      try {
        const environment = childEnvironment({ STRIPE_API_KEY: secretKey, XDG_CONFIG_HOME: cliRoot });
        const version = command(config.stripeCliPath, ["version", "--color", "off"], { env: environment, label: "Stripe CLI version check" });
        if (String(version).trim().split("\n")[0] !== `stripe version ${STRIPE_CLI_VERSION}`) throw new Error(`Stripe CLI version drifted from ${STRIPE_CLI_VERSION}`);
        command(config.stripeCliPath, ["events", "resend", eventId, "--webhook-endpoint", endpointId, "--confirm", "--color", "off"], {
          env: environment,
          label: "Stripe exact seller refund confirmation resend",
        });
      } finally {
        rmSync(cliRoot, { force: true, recursive: true });
      }
    },
  };
}

function markerFor(config, state) {
  return sha256(`${config.expectedCommit}:${state.attemptId}:seller-refund`);
}

export function buildStripeProofMetadata(config, state) {
  const metadata = { [STRIPE_PROOF_METADATA_KEY]: markerFor(config, state) };
  for (const key of Object.keys(metadata)) {
    if (key.length < 1 || key.length > STRIPE_METADATA_KEY_MAX_LENGTH) {
      throw new Error("seller refund Stripe metadata key exceeded provider limits");
    }
  }
  return metadata;
}

export function buildConnectedAccountParams(config, state, now = new Date()) {
  void now;
  return {
    country: "US",
    default_currency: "usd",
    email: "provider-canary@thegrainline.com",
    capabilities: { transfers: { requested: true } },
    controller: CONNECTED_ACCOUNT_CONTROLLER,
    business_profile: {
      mcc: "5712",
      name: "Grainline Seller Refund Canary",
      product_description: "Disposable Stripe test-mode refund reversal proof",
      url: "https://thegrainline.com",
    },
    external_account: {
      object: "bank_account",
      country: "US",
      currency: "usd",
      routing_number: "110000000",
      account_number: "000123456789",
      account_holder_name: "Grainline Seller Refund Canary",
      account_holder_type: "individual",
    },
    metadata: buildStripeProofMetadata(config, state),
    settings: { payouts: { schedule: { interval: "manual" } } },
  };
}

function connectedAccountDiagnostics(account, config, state) {
  return Object.freeze({
    controller: Object.freeze({
      dashboardType: account?.controller?.stripe_dashboard?.type ?? null,
      feesPayer: account?.controller?.fees?.payer ?? null,
      lossesPayments: account?.controller?.losses?.payments ?? null,
      requirementsCollector: account?.controller?.requirement_collection ?? null,
    }),
    country: account?.country ?? null,
    defaultCurrency: account?.default_currency ?? null,
    deleted: account?.deleted === true,
    idPresent: typeof account?.id === "string",
    livemode: Object.hasOwn(account ?? {}, "livemode") ? account.livemode : null,
    markerMatches: account?.metadata?.[STRIPE_PROOF_METADATA_KEY] === markerFor(config, state),
    transfers: account?.capabilities?.transfers ?? null,
  });
}

export function assertConnectedAccount(account, config, state, { requireTransferActive = true } = {}) {
  const diagnostics = connectedAccountDiagnostics(account, config, state);
  if (!account || diagnostics.deleted === true || diagnostics.livemode === true
    || !/^acct_[A-Za-z0-9_]+$/.test(String(account.id ?? ""))
    || diagnostics.markerMatches !== true
    || diagnostics.country !== "US" || diagnostics.defaultCurrency !== "usd"
    || diagnostics.controller.feesPayer !== "application"
    || diagnostics.controller.lossesPayments !== "application"
    || diagnostics.controller.requirementsCollector !== "stripe"
    || diagnostics.controller.dashboardType !== "express"
    || (requireTransferActive && diagnostics.transfers !== "active")) {
    throw new Error(`seller refund disposable connected account drifted: ${JSON.stringify(diagnostics)}`);
  }
  return account;
}

export function buildConnectedAccountLinkParams(accountId) {
  if (typeof accountId !== "string" || !/^acct_[A-Za-z0-9_]+$/.test(accountId)) {
    throw new Error("seller refund hosted onboarding requires an exact account ID");
  }
  return {
    account: accountId,
    collection_options: { fields: "eventually_due" },
    refresh_url: `${PRODUCTION_ORIGIN}/?seller_refund_canary=refresh`,
    return_url: `${PRODUCTION_ORIGIN}/?seller_refund_canary=return`,
    type: "account_onboarding",
  };
}

export function assertOnboardingLink(link, { requireFresh = true } = {}) {
  let parsed;
  try {
    parsed = new URL(link?.url);
  } catch {
    throw new Error("seller refund Stripe hosted-onboarding link is invalid");
  }
  if (link?.object !== "account_link" || parsed.protocol !== "https:"
    || parsed.hostname !== "connect.stripe.com" || !parsed.pathname.startsWith("/setup/")
    || !Number.isSafeInteger(link?.expires_at) || link.expires_at <= 0
    || (requireFresh && link.expires_at <= Math.floor(Date.now() / 1000))) {
    throw new Error("seller refund Stripe hosted-onboarding link is outside the reviewed boundary");
  }
  return link;
}

export function assertOnboardingRecord(payload, config, state, { requireFresh = true } = {}) {
  const link = assertOnboardingLink({
    object: "account_link",
    url: payload?.accountLinkUrl,
    expires_at: payload?.accountLinkExpiresAt,
  }, { requireFresh });
  if (payload?.version !== 1
    || payload?.phase !== "order-payment-event-seller-refund-onboarding"
    || payload?.status !== "onboarding-required"
    || payload?.expectedCommit !== config.expectedCommit
    || payload?.deploymentId !== config.deploymentId
    || payload?.attemptId !== state.attemptId
    || payload?.stripeAccountId !== state.stripeAccountId) {
    throw new Error("seller refund hosted-onboarding record does not bind the preserved attempt");
  }
  return Object.freeze({ ...payload, accountLinkExpiresAt: link.expires_at });
}

export function readOnboardingRecord(config, state, { required: isRequired = true, requireFresh = true } = {}) {
  if (!existsSync(config.onboardingPath)) {
    if (isRequired) throw new Error("seller refund hosted-onboarding record does not exist");
    return null;
  }
  return assertOnboardingRecord(
    readPrivateJson(config.onboardingPath, "seller refund hosted-onboarding record"),
    config,
    state,
    { requireFresh },
  );
}

export function writeOnboardingRecord(config, state, link) {
  const record = assertOnboardingRecord({
    version: 1,
    phase: "order-payment-event-seller-refund-onboarding",
    status: "onboarding-required",
    expectedCommit: config.expectedCommit,
    deploymentId: config.deploymentId,
    attemptId: state.attemptId,
    stripeAccountId: state.stripeAccountId,
    accountLinkUrl: link.url,
    accountLinkExpiresAt: link.expires_at,
  }, config, state);
  if (existsSync(config.onboardingPath)) {
    readOnboardingRecord(config, state, { requireFresh: false });
  }
  writePrivateJson(config.onboardingPath, record);
  return record;
}

export function removeOnboardingRecord(config, state) {
  if (!existsSync(config.onboardingPath)) return;
  readOnboardingRecord(config, state, { requireFresh: false });
  unlinkSync(config.onboardingPath);
}

export function assertDeletedConnectedAccountAbsence(error, listing, expectedAccountId) {
  const accounts = listing?.accounts;
  const exactAccessFailure = error?.type === "StripePermissionError"
    && error?.code === "account_invalid"
    && error?.statusCode === 403
    && error?.rawType === "api_error";
  if (!/^acct_[A-Za-z0-9_]+$/.test(String(expectedAccountId ?? ""))
    || !exactAccessFailure
    || listing?.exhausted !== true
    || !Array.isArray(accounts)
    || accounts.length > 1000
    || accounts.some((account) => !/^acct_[A-Za-z0-9_]+$/.test(String(account?.id ?? "")))
    || accounts.some((account) => account.id === expectedAccountId)) {
    throw new Error("seller refund deleted connected account absence is not proven");
  }
  return true;
}

export function assertPayment(payment, charge, accountId) {
  const chargeId = typeof payment?.latest_charge === "string" ? payment.latest_charge : payment?.latest_charge?.id;
  const transfer = charge?.transfer;
  const transferId = typeof transfer === "object" && transfer ? transfer.id : null;
  const destination = typeof transfer?.destination === "string"
    ? transfer.destination
    : transfer?.destination?.id;
  if (
    !/^pi_[A-Za-z0-9_]+$/.test(String(payment?.id ?? "")) || payment?.livemode !== false
    || payment?.status !== "succeeded" || payment?.amount !== REFUND_AMOUNT_CENTS || payment?.currency !== "usd"
    || charge?.id !== chargeId || charge?.livemode !== false || charge?.paid !== true
    || charge?.amount !== REFUND_AMOUNT_CENTS || charge?.currency !== "usd"
    || !/^tr_[A-Za-z0-9_]+$/.test(String(transferId ?? ""))
    || transfer.amount !== TRANSFER_AMOUNT_CENTS || destination !== accountId
  ) throw new Error("seller refund destination payment drifted");
  return Object.freeze({ paymentIntentId: payment.id, chargeId, transferId });
}

async function selectCanary(clerk, owner, state = null) {
  const users = await clerk.users.getUserList({ externalId: [NOTIFICATION_CANARY_EXTERNAL_ID], limit: 2 });
  if (users.totalCount !== 1 || users.data.length !== 1) throw new Error("expected exactly one retained operational canary");
  const clerkUser = users.data[0];
  if (
    clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID || clerkUser.banned || clerkUser.locked
    || clerkUser.publicMetadata?.grainlineOperationalCanary !== "notification-rls-route-and-production-canary"
  ) throw new Error("seller refund operational canary identity drifted");
  const result = await owner.query(`
    SELECT account.id, account."clerkId",
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE "userId" = account.id) AS sellers
    FROM public."User" AS account
    WHERE account."clerkId" = $1 AND account."deletedAt" IS NULL AND account.banned = false
  `, [clerkUser.id]);
  if (result.rowCount !== 1) throw new Error("seller refund canary database identity drifted");
  const candidate = result.rows[0];
  if (state) {
    const index = STAGES.indexOf(state.stage);
    const fixtureCreated = index >= STAGES.indexOf("fixtures-created");
    const cleanupMayHaveCommitted = index >= STAGES.indexOf("cleanup-started");
    const sellerCount = Number(candidate.sellers);
    if (
      candidate.id !== state.sellerUserId
      || candidate.clerkId !== state.sellerClerkId
      || (!fixtureCreated && sellerCount !== 0)
      || (fixtureCreated && !cleanupMayHaveCommitted && sellerCount !== 1)
      || (cleanupMayHaveCommitted && !new Set([0, 1]).has(sellerCount))
    ) {
      throw new Error("seller refund recovery canary identity drifted");
    }
  } else if (Number(candidate.sellers) !== 0) {
    throw new Error("seller refund operational canary already has a SellerProfile");
  }
  const sessions = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: candidate.clerkId });
  if (!state && (sessions.totalCount !== 0 || sessions.data.length !== 0)) throw new Error("seller refund canary has a pre-existing active session");
  return candidate;
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) throw new Error("seller refund Clerk cookie response drifted");
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (separator <= 0 || !/^[A-Za-z0-9_]+$/.test(name) || !content || content.length > 8_192) throw new Error("seller refund Clerk cookie shape drifted");
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) throw new Error("seller refund Clerk cookie jar drifted");
  return value;
}

async function createCanarySession(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const signInToken = await clerk.signInTokens.createSignInToken({ expiresInSeconds: 60, userId: clerkUserId });
  if (!signInToken?.id || !signInToken?.token || signInToken.userId !== clerkUserId) throw new Error("seller refund Clerk ticket creation failed");
  const jar = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "", headers: { "content-type": "application/x-www-form-urlencoded", origin: PRODUCTION_ORIGIN }, method: "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = await boundedJson(clientResponse);
  if (clientResponse.status !== 200 || (clientPayload.response ?? clientPayload).object !== "client") throw new Error("seller refund Clerk handshake failed");
  const exchange = await fetch(`https://${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: clerkCookieHeader(jar), origin: PRODUCTION_ORIGIN },
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchange, jar);
  const attempt = (await boundedJson(exchange)).response ?? {};
  const sessionId = attempt.created_session_id;
  if (exchange.status !== 200 || attempt.object !== "sign_in_attempt" || attempt.status !== "complete" || !/^sess_[A-Za-z0-9]+$/.test(String(sessionId ?? ""))) {
    throw new Error("seller refund Clerk ticket exchange failed");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) throw new Error("seller refund Clerk session token drifted");
  return Object.freeze({ jwt: token.jwt, sessionId });
}

async function revokeCanarySessions(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const after = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  return after.totalCount === 0 && after.data.length === 0;
}

async function fetchRefundRoute(orderId, token, origin = PRODUCTION_ORIGIN) {
  const response = await fetch(`${PRODUCTION_ORIGIN}/api/orders/${encodeURIComponent(orderId)}/refund`, {
    body: JSON.stringify({ type: "FULL" }),
    headers: { authorization: `Bearer ${token}`, "cache-control": "no-store", "content-type": "application/json", origin },
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(60_000),
  });
  return { body: await boundedJson(response), status: response.status };
}

export async function createFixtures(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const collisions = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id = $1 OR "clerkId" = $2 OR email = $3) AS buyers,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $4 OR "userId" = $5 OR "stripeAccountId" = $6) AS sellers,
        (SELECT count(*)::integer FROM public."Listing" WHERE id = $7) AS listings,
        (SELECT count(*)::integer FROM public."Order" WHERE id = $8 OR "stripePaymentIntentId" = $9 OR "stripeChargeId" = $10) AS orders,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id = $11) AS items,
        (SELECT count(*)::integer FROM public."Case" WHERE id = $12 OR "orderId" = $8) AS cases
    `, [state.buyerId, state.buyerClerkId, state.buyerEmail, state.sellerProfileId, state.sellerUserId, state.stripeAccountId,
      state.listingId, state.orderId, state.paymentIntentId, state.chargeId, state.orderItemId, state.caseId]);
    const collision = collisions.rows[0] ?? {};
    const counts = Object.fromEntries(Object.entries(collision).map(([key, value]) => [key, Number(value)]));
    const absent = Object.values(counts).every((count) => count === 0);
    if (!absent) {
      const exact = await owner.query(`
        SELECT
          (SELECT count(*)::integer FROM public."User" WHERE id=$1 AND "clerkId"=$2 AND email=$3
            AND name='Grainline Refund Proof Buyer' AND role='USER'
            AND "notificationPreferences"='{"EMAIL_REFUND_ISSUED":false}'::jsonb) AS buyer,
          (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$4 AND "userId"=$5 AND "stripeAccountId"=$6
            AND "displayName"='Grainline Refund Proof' AND "displayNameNormalized"='grainline refund proof'
            AND "chargesEnabled"=true AND "stripeAccountVersion"='v1' AND "stripeControllerType"='custom'
            AND "vacationMode"=true) AS seller,
          (SELECT count(*)::integer FROM public."Listing" WHERE id=$7 AND "sellerId"=$4
            AND title='seller-refund-production-proof'
            AND description='Disposable vacation-hidden seller refund production proof fixture'
            AND "priceCents"=500 AND currency='usd' AND status='SOLD_OUT' AND "listingType"='IN_STOCK'
            AND "stockQuantity"=0 AND "shipsWithinDays"=2 AND "isPrivate"=false) AS listing,
          (SELECT count(*)::integer FROM public."Order" WHERE id=$8 AND "buyerId"=$1 AND "sellerProfileId"=$4
            AND "stripePaymentIntentId"=$9 AND "stripeChargeId"=$10 AND "stripeTransferId"=$11
            AND currency='usd' AND "itemsSubtotalCents"=500 AND "shippingAmountCents"=0
            AND "taxAmountCents"=0 AND "paidAt" IS NOT NULL AND "fulfillmentStatus"='PENDING') AS order_row,
          (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$12 AND "orderId"=$8 AND "listingId"=$7
            AND "sellerProfileId"=$4 AND quantity=1 AND "priceCents"=500) AS item,
          (SELECT count(*)::integer FROM public."Case" WHERE id=$13 AND "orderId"=$8 AND "buyerId"=$1
            AND "sellerId"=$5 AND reason='OTHER' AND description='Disposable seller refund proof Case'
            AND status='OPEN') AS case_row
      `, [state.buyerId, state.buyerClerkId, state.buyerEmail, state.sellerProfileId, state.sellerUserId,
        state.stripeAccountId, state.listingId, state.orderId, state.paymentIntentId, state.chargeId,
        state.transferId, state.orderItemId, state.caseId]);
      if (Object.values(exact.rows[0] ?? {}).every((count) => Number(count) === 1)) {
        await owner.query("COMMIT");
        return;
      }
      throw new Error("seller refund fixture identity collided");
    }
    await owner.query(`
      INSERT INTO public."User" (id, "clerkId", email, name, role, "notificationPreferences", "updatedAt")
      VALUES ($1, $2, $3, 'Grainline Refund Proof Buyer', 'USER', '{"EMAIL_REFUND_ISSUED":false}'::jsonb, CURRENT_TIMESTAMP)
    `, [state.buyerId, state.buyerClerkId, state.buyerEmail]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized", "stripeAccountId",
        "chargesEnabled", "stripeAccountVersion", "stripeControllerType", "vacationMode", "updatedAt"
      ) VALUES ($1, $2, 'Grainline Refund Proof', 'grainline refund proof', $3, true, 'v1', 'custom', true, CURRENT_TIMESTAMP)
    `, [state.sellerProfileId, state.sellerUserId, state.stripeAccountId]);
    await owner.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "shipsWithinDays", "isPrivate", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'seller-refund-production-proof',
        'Disposable vacation-hidden seller refund production proof fixture',
        500, 'usd', 'SOLD_OUT', 'IN_STOCK', 0, 2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [state.listingId, state.sellerProfileId]);
    await owner.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "stripePaymentIntentId", "stripeChargeId", "stripeTransferId",
        currency, "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents", "paidAt", "fulfillmentStatus"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'usd', 500, 0, 0, CURRENT_TIMESTAMP, 'PENDING')
    `, [state.orderId, state.buyerId, state.sellerProfileId, state.paymentIntentId, state.chargeId, state.transferId]);
    await owner.query(`
      INSERT INTO public."OrderItem" (id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents", "listingSnapshot")
      VALUES ($1, $2, $3, $4, 1, 500, $5::jsonb)
    `, [state.orderItemId, state.orderId, state.listingId, state.sellerProfileId,
      JSON.stringify({ title: "seller-refund-production-proof", capturedAt: new Date().toISOString() })]);
    await owner.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description, status, "sellerRespondBy", "updatedAt"
      ) VALUES ($1, $2, $3, $4, 'OTHER', 'Disposable seller refund proof Case', 'OPEN', CURRENT_TIMESTAMP + INTERVAL '48 hours', CURRENT_TIMESTAMP)
    `, [state.caseId, state.orderId, state.buyerId, state.sellerUserId]);
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function waitFor(read, accept, label, attempts = 60, delayMs = 1500) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await read();
    if (accept(latest)) return latest;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} did not reach the reviewed state`);
}

export function findSingleRefundEvent(events, state) {
  const matches = events.filter((event) => event?.type === "charge.refunded" && event?.livemode === false
    && event?.data?.object?.id === state.chargeId
    && event.data.object.refunded === true
    && event.data.object.amount === REFUND_AMOUNT_CENTS
    && event.data.object.amount_refunded === REFUND_AMOUNT_CENTS
    && event.data.object.currency === "usd"
    && event.data.object.payment_intent === state.paymentIntentId
    && event.data.object.transfer === state.transferId);
  return matches.length === 1 ? matches[0] : null;
}

export function assertRefundProviderEvidence(refund, state) {
  assertStripeRefundObject(refund, "seller refund provider evidence");
  const reversal = refund?.transfer_reversal;
  const reversalId = typeof reversal === "object" && reversal ? reversal.id : null;
  if (
    refund?.id !== state.refundId || refund?.amount !== REFUND_AMOUNT_CENTS
    || refund?.currency !== "usd" || !["pending", "requires_action", "succeeded"].includes(refund?.status)
    || refund?.payment_intent !== state.paymentIntentId || refund?.charge !== state.chargeId
    || !/^trr_[A-Za-z0-9_]+$/.test(String(reversalId ?? ""))
    || reversal.amount !== TRANSFER_AMOUNT_CENTS || reversal.transfer !== state.transferId
  ) throw new Error("seller refund provider evidence drifted");
  return Object.freeze({ transferReversalId: reversalId });
}

export async function readProofSnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId" = $1 AND "eventType" = 'REFUND') AS "paymentCount",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localPaymentEventId",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $3) AS "signedPaymentEventId",
        (SELECT reason FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $3) AS "signedReason",
        (SELECT metadata->'refundAccounting'->>'buyerRefundAmountCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localBuyerRefundAmount",
        (SELECT metadata->'refundAccounting'->>'originalTransferAmountCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localOriginalTransferAmount",
        (SELECT metadata->'refundAccounting'->>'transferReversalId' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localTransferReversalId",
        (SELECT metadata->'refundAccounting'->>'transferReversalAmountCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localTransferReversalAmount",
        (SELECT metadata->'refundAccounting'->>'platformFundedRefundCents' FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = 'local:seller_refund_recorded:' || $2) AS "localPlatformFundedAmount",
        (SELECT metadata->>'latestRefundId' FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $3) AS "signedLatestRefundId",
        (SELECT metadata->>'totalRefundedCents' FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $3) AS "signedTotalRefunded",
        (SELECT metadata->>'pendingLocalRefundLock' FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $3) AS "signedPendingLocalLock",
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId" = $1 AND "stripeObjectId" = $2 AND "stripeObjectType" = 'refund') AS "refundObjectCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id = $3 AND type = 'charge.refunded'
          AND "sourceObjectId" = $4 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS "webhookCount",
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id = $3) AS "webhookGeneration",
        (SELECT "sellerRefundId" FROM public."Order" WHERE id = $1) AS "orderRefundId",
        (SELECT "sellerRefundAmountCents" FROM public."Order" WHERE id = $1) AS "orderRefundAmount",
        (SELECT "refundClaimId" IS NULL AND "refundClaimSource" IS NULL AND "refundClaimSourceId" IS NULL
          AND "refundClaimIdempotencyScope" IS NULL AND "refundClaimProviderAuthorizedAt" IS NULL
          FROM public."Order" WHERE id = $1) AS "claimCleared",
        (SELECT "reviewNeeded" FROM public."Order" WHERE id = $1) AS "reviewNeeded",
        (SELECT "stockQuantity" FROM public."Listing" WHERE id = $5) AS stock,
        (SELECT status::text FROM public."Listing" WHERE id = $5) AS "listingStatus",
        (SELECT status::text FROM public."Case" WHERE id = $6) AS "caseStatus",
        (SELECT resolution::text FROM public."Case" WHERE id = $6) AS "caseResolution",
        (SELECT "refundAmountCents" FROM public."Case" WHERE id = $6) AS "caseRefundAmount",
        (SELECT "stripeRefundId" FROM public."Case" WHERE id = $6) AS "caseRefundId",
        (SELECT "resolvedById" FROM public."Case" WHERE id = $6) AS "caseResolvedBy",
        (SELECT count(*)::integer FROM public."CaseSellerRefundApplication" WHERE "caseId" = $6 AND "orderId" = $1
          AND action = 'resolve') AS "caseApplicationCount",
        (SELECT "paymentEventId" FROM public."CaseSellerRefundApplication" WHERE "caseId" = $6) AS "caseApplicationId",
        (SELECT count(*)::integer FROM public."Notification" WHERE "userId" = $7 AND type = 'REFUND_ISSUED'
          AND "sourceType" = 'order_payment' AND "sourceId" = 'local:seller_refund_recorded:' || $2
          AND "relatedUserId" = $8) AS "notificationCount",
        (SELECT id FROM public."Notification" WHERE "userId" = $7 AND "sourceId" = 'local:seller_refund_recorded:' || $2) AS "notificationId",
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE "userId" = $7 AND "preferenceKey" = 'EMAIL_REFUND_ISSUED'
          AND "sourceType" = 'order_payment' AND "sourceId" = 'local:seller_refund_recorded:' || $2
          AND status = 'SKIPPED') AS "outboxCount",
        (SELECT id FROM public."EmailOutbox" WHERE "userId" = $7 AND "sourceId" = 'local:seller_refund_recorded:' || $2) AS "emailOutboxId",
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId" = $8 AND action = 'SELLER_REFUND_RECORDED'
          AND "targetType" = 'ORDER' AND "targetId" = $1) AS "sellerAuditCount",
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId" = $8 AND action = 'CASE_SELLER_REFUND_APPLIED'
          AND "targetType" = 'CASE' AND "targetId" = $6) AS "caseAuditCount",
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId" = $3 AND action = 'STRIPE_REFUND_RECORDED'
          AND "targetType" = 'ORDER' AND "targetId" = $1) AS "signedAuditCount"
    `, [state.orderId, state.refundId, state.signedEventId, state.chargeId, state.listingId, state.caseId, state.buyerId, state.sellerUserId]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export function assertProofSnapshot(snapshot, state, expected = {}) {
  const normalized = {
    paymentCount: Number(snapshot?.paymentCount),
    localPaymentEventId: snapshot?.localPaymentEventId ?? null,
    signedPaymentEventId: snapshot?.signedPaymentEventId ?? null,
    signedReason: snapshot?.signedReason ?? null,
    localBuyerRefundAmount: Number(snapshot?.localBuyerRefundAmount),
    localOriginalTransferAmount: Number(snapshot?.localOriginalTransferAmount),
    localTransferReversalId: snapshot?.localTransferReversalId ?? null,
    localTransferReversalAmount: Number(snapshot?.localTransferReversalAmount),
    localPlatformFundedAmount: Number(snapshot?.localPlatformFundedAmount),
    signedLatestRefundId: snapshot?.signedLatestRefundId ?? null,
    signedTotalRefunded: Number(snapshot?.signedTotalRefunded),
    signedPendingLocalLock: snapshot?.signedPendingLocalLock ?? null,
    refundObjectCount: Number(snapshot?.refundObjectCount),
    webhookCount: Number(snapshot?.webhookCount),
    webhookGeneration: String(snapshot?.webhookGeneration ?? ""),
    orderRefundId: snapshot?.orderRefundId ?? null,
    orderRefundAmount: Number(snapshot?.orderRefundAmount),
    claimCleared: snapshot?.claimCleared,
    reviewNeeded: snapshot?.reviewNeeded,
    stock: Number(snapshot?.stock),
    listingStatus: snapshot?.listingStatus,
    caseStatus: snapshot?.caseStatus,
    caseResolution: snapshot?.caseResolution,
    caseRefundAmount: Number(snapshot?.caseRefundAmount),
    caseRefundId: snapshot?.caseRefundId,
    caseResolvedBy: snapshot?.caseResolvedBy,
    caseApplicationCount: Number(snapshot?.caseApplicationCount),
    caseApplicationId: snapshot?.caseApplicationId ?? null,
    notificationCount: Number(snapshot?.notificationCount),
    notificationId: snapshot?.notificationId ?? null,
    outboxCount: Number(snapshot?.outboxCount),
    emailOutboxId: snapshot?.emailOutboxId ?? null,
    sellerAuditCount: Number(snapshot?.sellerAuditCount),
    caseAuditCount: Number(snapshot?.caseAuditCount),
    signedAuditCount: Number(snapshot?.signedAuditCount),
  };
  if (
    normalized.paymentCount !== 2 || normalized.refundObjectCount !== 2 || normalized.webhookCount !== 1
    || !/^[1-9][0-9]*$/.test(normalized.webhookGeneration)
    || !new Set(["local_refund_confirmed", "local_refund_pending_confirmation"]).has(normalized.signedReason)
    || normalized.localBuyerRefundAmount !== REFUND_AMOUNT_CENTS
    || normalized.localOriginalTransferAmount !== TRANSFER_AMOUNT_CENTS
    || normalized.localTransferReversalId !== state.transferReversalId
    || normalized.localTransferReversalAmount !== TRANSFER_AMOUNT_CENTS
    || normalized.localPlatformFundedAmount !== REFUND_AMOUNT_CENTS - TRANSFER_AMOUNT_CENTS
    || normalized.signedLatestRefundId !== state.refundId
    || normalized.signedTotalRefunded !== REFUND_AMOUNT_CENTS
    || normalized.signedPendingLocalLock !== (
      normalized.signedReason === "local_refund_pending_confirmation" ? "true" : "false"
    )
    || normalized.orderRefundId !== state.refundId || normalized.orderRefundAmount !== REFUND_AMOUNT_CENTS
    || normalized.claimCleared !== true || normalized.reviewNeeded !== true
    || normalized.stock !== 1 || normalized.listingStatus !== "ACTIVE"
    || normalized.caseStatus !== "RESOLVED" || normalized.caseResolution !== "REFUND_FULL"
    || normalized.caseRefundAmount !== REFUND_AMOUNT_CENTS || normalized.caseRefundId !== state.refundId
    || normalized.caseResolvedBy !== state.sellerUserId || normalized.caseApplicationCount !== 1
    || normalized.notificationCount !== 1 || normalized.outboxCount !== 1
    || normalized.sellerAuditCount !== 1 || normalized.caseAuditCount !== 1 || normalized.signedAuditCount !== 1
    || !normalized.localPaymentEventId || !normalized.signedPaymentEventId || !normalized.caseApplicationId
    || !normalized.notificationId || !normalized.emailOutboxId
    || (expected.localPaymentEventId && normalized.localPaymentEventId !== expected.localPaymentEventId)
    || (expected.signedPaymentEventId && normalized.signedPaymentEventId !== expected.signedPaymentEventId)
    || (expected.caseApplicationId && normalized.caseApplicationId !== expected.caseApplicationId)
    || (expected.notificationId && normalized.notificationId !== expected.notificationId)
    || (expected.emailOutboxId && normalized.emailOutboxId !== expected.emailOutboxId)
    || normalized.caseApplicationId !== normalized.localPaymentEventId
  ) throw new Error("seller refund production effects drifted");
  return Object.freeze(normalized);
}

export function assertReplayUnchanged(before, after, state) {
  const first = assertProofSnapshot(before, state);
  const replay = assertProofSnapshot(after, state, first);
  for (const key of ["webhookGeneration", "localPaymentEventId", "signedPaymentEventId", "caseApplicationId", "notificationId", "emailOutboxId"]) {
    if (first[key] !== replay[key]) throw new Error(`seller refund retry changed ${key}`);
  }
  return replay;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function resultCardinality(result) {
  return Number.isSafeInteger(result?.rowCount) ? result.rowCount : result?.rows?.length;
}

async function assertNoForeignKeyDependents(client, relation, id) {
  const constraints = await client.query(`
    SELECT child_namespace.nspname AS "schemaName", child.relname AS "tableName",
      pg_catalog.array_agg(child_attribute.attname::text ORDER BY child_key_row.ordinality) AS "childColumns",
      pg_catalog.array_agg(parent_attribute.attname::text ORDER BY child_key_row.ordinality) AS "parentColumns"
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN LATERAL pg_catalog.unnest(constraint_row.conkey) WITH ORDINALITY AS child_key_row(child_key, ordinality) ON true
    JOIN LATERAL pg_catalog.unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key_row(parent_key, ordinality)
      ON parent_key_row.ordinality = child_key_row.ordinality
    JOIN pg_catalog.pg_attribute AS child_attribute ON child_attribute.attrelid = constraint_row.conrelid AND child_attribute.attnum = child_key_row.child_key
    JOIN pg_catalog.pg_attribute AS parent_attribute ON parent_attribute.attrelid = constraint_row.confrelid AND parent_attribute.attnum = parent_key_row.parent_key
    WHERE constraint_row.contype = 'f' AND constraint_row.confrelid = $1::pg_catalog.regclass
    GROUP BY child_namespace.nspname, child.relname, constraint_row.oid
  `, [relation]);
  for (const constraint of constraints.rows) {
    const child = `${quoteIdentifier(constraint.schemaName)}.${quoteIdentifier(constraint.tableName)}`;
    const join = constraint.childColumns.map((column, index) => `child.${quoteIdentifier(column)} IS NOT DISTINCT FROM parent.${quoteIdentifier(constraint.parentColumns[index])}`).join(" AND ");
    const dependent = await client.query(`SELECT count(*)::integer AS count FROM ${child} AS child JOIN ${relation} AS parent ON ${join} WHERE parent.id = $1`, [id]);
    if (dependent.rows[0]?.count !== 0) throw new Error("seller refund cleanup found an unexpected dependent row");
  }
}

export async function cleanupExactRows(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const exact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id = $1 AND "clerkId" = $2 AND email = $3
          AND name = 'Grainline Refund Proof Buyer' AND "notificationPreferences" = '{"EMAIL_REFUND_ISSUED":false}'::jsonb) AS buyer,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $4 AND "userId" = $5 AND "stripeAccountId" = $6
          AND "displayName" = 'Grainline Refund Proof' AND "vacationMode" = true) AS seller,
        (SELECT count(*)::integer FROM public."Listing" WHERE id = $7 AND "sellerId" = $4
          AND title = 'seller-refund-production-proof' AND "priceCents" = 500 AND currency = 'usd'
          AND status = 'ACTIVE' AND "listingType" = 'IN_STOCK' AND "stockQuantity" = 1 AND "isPrivate" = false) AS listing,
        (SELECT count(*)::integer FROM public."Order" WHERE id = $8 AND "buyerId" = $1 AND "sellerProfileId" = $4
          AND "stripePaymentIntentId" = $9 AND "stripeChargeId" = $10 AND "stripeTransferId" = $11
          AND "sellerRefundId" = $12 AND "sellerRefundAmountCents" = 500) AS order_row,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id = $13 AND "orderId" = $8 AND "listingId" = $7
          AND "sellerProfileId" = $4 AND quantity = 1 AND "priceCents" = 500) AS item,
        (SELECT count(*)::integer FROM public."Case" WHERE id = $14 AND "orderId" = $8 AND "buyerId" = $1
          AND "sellerId" = $5 AND status = 'RESOLVED' AND resolution = 'REFUND_FULL' AND "stripeRefundId" = $12) AS case_row,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($15, $16) AND "orderId" = $8) AS payments,
        (SELECT count(*)::integer FROM public."CaseSellerRefundApplication" WHERE "paymentEventId" = $17 AND "caseId" = $14) AS application,
        (SELECT count(*)::integer FROM public."Notification" WHERE id = $18 AND "userId" = $1) AS notification,
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id = $19 AND "userId" = $1 AND status = 'SKIPPED') AS outbox,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE
          ("actorId" = $5 AND action = 'SELLER_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$8)
          OR ("actorId" = $5 AND action = 'CASE_SELLER_REFUND_APPLIED' AND "targetType"='CASE' AND "targetId"=$14)
          OR ("actorId" = $20 AND action = 'STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$8)) AS audits,
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id = $20 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS webhook
    `, [state.buyerId, state.buyerClerkId, state.buyerEmail, state.sellerProfileId, state.sellerUserId, state.stripeAccountId,
      state.listingId, state.orderId, state.paymentIntentId, state.chargeId, state.transferId, state.refundId, state.orderItemId,
      state.caseId, state.localPaymentEventId, state.signedPaymentEventId, state.caseApplicationId, state.notificationId,
      state.emailOutboxId, state.signedEventId]);
    const row = exact.rows[0] ?? {};
    const expected = { buyer: 1, seller: 1, listing: 1, order_row: 1, item: 1, case_row: 1, payments: 2,
      application: 1, notification: 1, outbox: 1, audits: 3, webhook: 1 };
    for (const [key, count] of Object.entries(expected)) {
      if (Number(row[key]) !== count) throw new Error(`seller refund cleanup ${key} relationship drifted`);
    }
    const deletions = [
      await owner.query(`DELETE FROM public."Notification" WHERE id = $1 RETURNING id`, [state.notificationId]),
      await owner.query(`DELETE FROM public."EmailOutbox" WHERE id = $1 RETURNING id`, [state.emailOutboxId]),
      await owner.query(`DELETE FROM public."CaseSellerRefundApplication" WHERE "paymentEventId" = $1 RETURNING "paymentEventId"`, [state.caseApplicationId]),
      await owner.query(`DELETE FROM public."SystemAuditLog" WHERE
        ("actorId" = $1 AND action = 'SELLER_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$3)
        OR ("actorId" = $1 AND action = 'CASE_SELLER_REFUND_APPLIED' AND "targetType"='CASE' AND "targetId"=$4)
        OR ("actorId" = $2 AND action = 'STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$3)
        RETURNING id`, [state.sellerUserId, state.signedEventId, state.orderId, state.caseId]),
      await owner.query(`DELETE FROM public."OrderPaymentEvent" WHERE id IN ($1, $2) RETURNING id`, [state.localPaymentEventId, state.signedPaymentEventId]),
      await owner.query(`DELETE FROM public."OrderItem" WHERE id = $1 RETURNING id`, [state.orderItemId]),
      await owner.query(`DELETE FROM public."Case" WHERE id = $1 RETURNING id`, [state.caseId]),
    ];
    [1, 1, 1, 3, 2, 1, 1].forEach((count, index) => {
      if (resultCardinality(deletions[index]) !== count) throw new Error("seller refund cleanup cardinality drifted");
    });
    await assertNoForeignKeyDependents(owner, 'public."Order"', state.orderId);
    if (resultCardinality(await owner.query(`DELETE FROM public."Order" WHERE id = $1 RETURNING id`, [state.orderId])) !== 1) throw new Error("seller refund Order cleanup drifted");
    await assertNoForeignKeyDependents(owner, 'public."Listing"', state.listingId);
    if (resultCardinality(await owner.query(`DELETE FROM public."Listing" WHERE id = $1 RETURNING id`, [state.listingId])) !== 1) throw new Error("seller refund Listing cleanup drifted");
    await assertNoForeignKeyDependents(owner, 'public."SellerProfile"', state.sellerProfileId);
    if (resultCardinality(await owner.query(`DELETE FROM public."SellerProfile" WHERE id = $1 RETURNING id`, [state.sellerProfileId])) !== 1) throw new Error("seller refund profile cleanup drifted");
    await assertNoForeignKeyDependents(owner, 'public."User"', state.buyerId);
    if (resultCardinality(await owner.query(`DELETE FROM public."User" WHERE id = $1 RETURNING id`, [state.buyerId])) !== 1) throw new Error("seller refund buyer cleanup drifted");
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCleanupSnapshot(owner, state) {
  const result = await owner.query(`
    SELECT
      (SELECT count(*)::integer FROM public."User" WHERE id = $1) AS "buyerCount",
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $2) AS "sellerCount",
      (SELECT count(*)::integer FROM public."Listing" WHERE id = $3) AS "listingCount",
      (SELECT count(*)::integer FROM public."Order" WHERE id = $4) AS "orderCount",
      (SELECT count(*)::integer FROM public."OrderItem" WHERE id = $5) AS "itemCount",
      (SELECT count(*)::integer FROM public."Case" WHERE id = $6) AS "caseCount",
      (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($7, $8)) AS "paymentCount",
      (SELECT count(*)::integer FROM public."Notification" WHERE id = $9) AS "notificationCount",
      (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id = $10) AS "outboxCount",
      (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id = $11) AS "webhookCount",
      (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id = $11 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS "processedWebhookCount",
      (SELECT count(*)::integer FROM public."User" WHERE id = $12 AND "clerkId" = $13 AND "deletedAt" IS NULL AND banned = false) AS "canaryCount"
  `, [state.buyerId, state.sellerProfileId, state.listingId, state.orderId, state.orderItemId, state.caseId,
    state.localPaymentEventId, state.signedPaymentEventId, state.notificationId, state.emailOutboxId,
    state.signedEventId, state.sellerUserId, state.sellerClerkId]);
  return result.rows[0];
}

export function assertCleanupSnapshot(snapshot) {
  const normalized = Object.fromEntries(Object.entries(snapshot ?? {}).map(([key, value]) => [key, Number(value)]));
  for (const key of ["buyerCount", "sellerCount", "listingCount", "orderCount", "itemCount", "caseCount", "paymentCount", "notificationCount", "outboxCount"]) {
    if (normalized[key] !== 0) throw new Error("seller refund application cleanup is incomplete");
  }
  if (normalized.webhookCount !== 1 || normalized.processedWebhookCount !== 1 || normalized.canaryCount !== 1) {
    throw new Error("seller refund retained evidence or canary drifted");
  }
  return Object.freeze(normalized);
}

async function deleteRefundRateLimitKeys(redis, userId) {
  const window = 60 * 60 * 1000;
  const current = Math.floor(Date.now() / window);
  const keys = [`rl:refund:${userId}:${current}`, `rl:refund:${userId}:${current - 1}`];
  await redis.del(...keys);
  const remaining = await Promise.all(keys.map((key) => redis.exists(key)));
  return remaining.every((count) => Number(count) === 0);
}

function balanceTotal(balance) {
  return [...(balance?.available ?? []), ...(balance?.pending ?? [])].reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
}

export async function deleteDisposableAccount(stripeOps, config, state) {
  let current;
  try {
    current = await stripeOps.retrieveAccount(state.stripeAccountId);
  } catch (error) {
    return assertDeletedConnectedAccountAbsence(
      error,
      await stripeOps.listAccounts(),
      state.stripeAccountId,
    );
  }
  if (current?.deleted === true) return current.id === state.stripeAccountId;
  assertConnectedAccount(current, config, state);
  const balance = await stripeOps.retrieveBalance(state.stripeAccountId);
  if (balanceTotal(balance) !== 0) throw new Error("seller refund disposable account retained a nonzero balance");
  const deleted = await stripeOps.deleteAccount(state.stripeAccountId);
  return deleted?.deleted === true && deleted.id === state.stripeAccountId;
}

export function buildEvidence(config, state, cleanup) {
  const operatorCommit = config.operatorCommit ?? config.expectedCommit;
  const operatorCiRunId = config.operatorCiRunId ?? config.mainCiRunId;
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    phase: "order-payment-event-seller-refund-production-proof",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    operatorCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    ciRunId: config.mainCiRunId,
    operatorCiRunId,
    deploymentId: config.deploymentId,
    signedPredecessorCommit: config.signedProofCommit,
    signedPredecessorCiRunId: config.signedProofCiRunId,
    stripe: {
      connectedAccountSha256: sha256(state.stripeAccountId),
      paymentIntentSha256: sha256(state.paymentIntentId),
      chargeSha256: sha256(state.chargeId),
      transferSha256: sha256(state.transferId),
      refundSha256: sha256(state.refundId),
      reversalSha256: sha256(state.transferReversalId),
      signedEventSha256: sha256(state.signedEventId),
      buyerRefundAmountCents: REFUND_AMOUNT_CENTS,
      transferReversalAmountCents: TRANSFER_AMOUNT_CENTS,
      exactSignedReplayProven: true,
      disposableConnectedAccountDeleted: cleanup.accountDeleted,
    },
    database: {
      localPaymentEventSha256: sha256(state.localPaymentEventId),
      signedPaymentEventSha256: sha256(state.signedPaymentEventId),
      caseApplicationSha256: sha256(state.caseApplicationId),
      notificationSha256: sha256(state.notificationId),
      emailOutboxSha256: sha256(state.emailOutboxId),
      stockRestoredAndReactivated: true,
      caseResolved: true,
      emailDeliverySkippedByPreference: true,
      temporaryApplicationRowsRemoved: cleanup.applicationRowsRemoved,
      retainedProcessedWebhookLeases: cleanup.processedWebhookCount,
      permanentOperationalCanaryRetained: cleanup.canaryCount === 1,
    },
    authenticatedRouteRetryRejectedWithoutDuplicate: true,
    clerkSessionsRevoked: cleanup.clerkSessionsRevoked,
    refundRateLimitKeysRemoved: cleanup.rateLimitKeysRemoved,
    productionChangedByProof: true,
    databaseChangeAfterCleanup: "one processed Stripe test-mode charge.refunded replay lease retained",
    externalResidueAfterCleanup: "immutable Stripe test objects plus ordinary provider and observability telemetry retained",
    providerConfigurationChanged: false,
    liveMoneyMoved: false,
    secretsRetained: false,
  });
}

export function assertEvidence(payload, config) {
  const operatorCommit = config.operatorCommit ?? config.expectedCommit;
  const operatorCiRunId = config.operatorCiRunId ?? config.mainCiRunId;
  const hex = /^[a-f0-9]{64}$/;
  const stripeHashes = [
    "connectedAccountSha256", "paymentIntentSha256", "chargeSha256",
    "transferSha256", "refundSha256", "reversalSha256", "signedEventSha256",
  ];
  const databaseHashes = [
    "localPaymentEventSha256", "signedPaymentEventSha256",
    "caseApplicationSha256", "notificationSha256", "emailOutboxSha256",
  ];
  if (
    payload?.phase !== "order-payment-event-seller-refund-production-proof" || payload?.status !== "passed" || payload?.mode !== "test"
    || payload?.commit !== config.expectedCommit || payload?.deployedSourceCommit !== config.deployedSourceCommit
    || String(payload?.ciRunId) !== String(config.mainCiRunId) || payload?.deploymentId !== config.deploymentId
    || payload?.operatorCommit !== operatorCommit || String(payload?.operatorCiRunId) !== String(operatorCiRunId)
    || payload?.signedPredecessorCommit !== config.signedProofCommit || String(payload?.signedPredecessorCiRunId) !== String(config.signedProofCiRunId)
    || !stripeHashes.every((key) => hex.test(payload?.stripe?.[key] ?? ""))
    || !databaseHashes.every((key) => hex.test(payload?.database?.[key] ?? ""))
    || payload?.stripe?.buyerRefundAmountCents !== REFUND_AMOUNT_CENTS || payload?.stripe?.transferReversalAmountCents !== TRANSFER_AMOUNT_CENTS
    || payload?.stripe?.exactSignedReplayProven !== true || payload?.stripe?.disposableConnectedAccountDeleted !== true
    || payload?.database?.stockRestoredAndReactivated !== true || payload?.database?.caseResolved !== true
    || payload?.database?.emailDeliverySkippedByPreference !== true || payload?.database?.temporaryApplicationRowsRemoved !== true
    || payload?.database?.retainedProcessedWebhookLeases !== 1 || payload?.database?.permanentOperationalCanaryRetained !== true
    || payload?.authenticatedRouteRetryRejectedWithoutDuplicate !== true || payload?.clerkSessionsRevoked !== true
    || payload?.refundRateLimitKeysRemoved !== true || payload?.providerConfigurationChanged !== false
    || payload?.liveMoneyMoved !== false || payload?.secretsRetained !== false
  ) throw new Error("seller refund sanitized evidence drifted");
  return Object.freeze(payload);
}

export function openHostedOnboarding(config = validateConfiguration(), dependencies = {}) {
  (dependencies.verifyExecutionBindings ?? verifyExecutionBindings)(config);
  assertSignedPredecessorEvidence(
    readPrivateJson(config.signedEvidencePath, "signed payment predecessor evidence"),
    config,
  );
  const state = assertState(
    readPrivateJson(config.statePath, "seller refund recovery state"),
    config,
  );
  if (state.stage !== "account-created" || !state.stripeAccountId) {
    throw new Error("seller refund hosted onboarding requires account-created state");
  }
  const onboarding = assertOnboardingRecord(
    readPrivateJson(config.onboardingPath, "seller refund hosted-onboarding record"),
    config,
    state,
  );
  const openUrl = dependencies.openUrl ?? ((url) => spawnSync(
    "/usr/bin/open",
    [url],
    { env: childEnvironment(), stdio: "ignore" },
  ));
  const opened = openUrl(onboarding.accountLinkUrl);
  if (opened?.error || opened?.status !== 0 || opened?.signal) {
    throw new Error("seller refund hosted-onboarding browser launch failed");
  }
  return Object.freeze({
    phase: "order-payment-event-seller-refund-production-proof",
    status: "onboarding-opened",
    rawProviderIdsPersistedInOutput: false,
    secretsPersistedInOutput: false,
  });
}

export async function runSellerRefundProductionProof(config = validateConfiguration(), dependencies = {}) {
  (dependencies.verifyExecutionBindings ?? verifyExecutionBindings)(config);
  assertSignedPredecessorEvidence(readPrivateJson(config.signedEvidencePath, "signed payment predecessor evidence"), config);
  const localValues = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const ownerValues = loadPrivateEnvironment(OWNER_ENV_PATH, "migration-owner environment file");
  const database = parseDatabaseUrls(localValues, ownerValues);
  const stripeSecret = validateStripeSecret(localValues);
  const clerkSecret = required(localValues, "CLERK_SECRET_KEY");
  const redisUrl = required(localValues, "UPSTASH_REDIS_REST_URL");
  const redisToken = required(localValues, "UPSTASH_REDIS_REST_TOKEN");
  const owner = postgresClient(database.ownerDatabaseUrl, "grainline_ope_seller_refund_owner");
  const runtime = postgresClient(database.runtimeDatabaseUrl, "grainline_ope_seller_refund_runtime");
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION });
  const clerk = createClerkClient({ secretKey: clerkSecret });
  const redis = new Redis({ url: redisUrl, token: redisToken });
  let state = existsSync(config.statePath) ? assertState(readPrivateJson(config.statePath, "seller refund recovery state"), config) : null;
  await owner.connect();
  await runtime.connect();
  try {
    await (dependencies.verifyDeployment ?? verifyDeployment)(config);
    await (dependencies.verifyDatabaseBoundary ?? verifyDatabaseBoundary)(owner, runtime);
    const canary = await selectCanary(clerk, owner, state);
    if (!state) {
      state = createInitialState(config, canary);
      writePrivateJson(config.statePath, state);
    }
    const stripeOps = stripeDependencies(stripe, stripeSecret, config, state);
    const provider = await readProviderState(stripeOps);
    if (provider.stage !== 4 || provider.platform?.url !== PLATFORM_WEBHOOK_URL || provider.platform?.status !== "enabled") {
      throw new Error("seller refund proof requires the active stage-4 platform webhook");
    }
    if (state.stage === "reserved") state = updateState(config, state, { stage: "account-create-pending" });
    if (state.stage === "account-create-pending") {
      const created = await stripeOps.createAccount();
      const account = await waitFor(
        () => stripeOps.retrieveAccount(created.id),
        (candidate) => {
          try {
            assertConnectedAccount(candidate, config, state, { requireTransferActive: false });
            return true;
          } catch {
            return false;
          }
        },
        "seller refund production-aligned connected account",
        40,
        1500,
      );
      assertConnectedAccount(account, config, state, { requireTransferActive: false });
      state = updateState(config, state, { stage: "account-created", stripeAccountId: account.id });
    }
    if (state.stage === "account-created") {
      const account = assertConnectedAccount(
        await stripeOps.retrieveAccount(state.stripeAccountId),
        config,
        state,
        { requireTransferActive: false },
      );
      if (account.capabilities?.transfers !== "active") {
        const existing = readOnboardingRecord(config, state, { required: false, requireFresh: false });
        let onboarding = existing;
        if (!onboarding || onboarding.accountLinkExpiresAt <= Math.floor(Date.now() / 1000)) {
          const link = assertOnboardingLink(await stripeOps.createOnboardingLink(state.stripeAccountId));
          onboarding = writeOnboardingRecord(config, state, link);
        }
        assertOnboardingRecord(onboarding, config, state);
        return Object.freeze({
          phase: "order-payment-event-seller-refund-production-proof",
          status: "onboarding-required",
          next: "ORDER_PAYMENT_SELLER_REFUND_COMMAND=onboard ... node scripts/order-payment-event-seller-refund-production-proof.mjs",
          accountCreated: true,
          rawProviderIdsPersistedInOutput: false,
          secretsPersistedInOutput: false,
        });
      }
      removeOnboardingRecord(config, state);
      state = updateState(config, state, { stage: "payment-create-pending" });
    }
    if (state.stage === "payment-create-pending") {
      const account = assertConnectedAccount(await stripeOps.retrieveAccount(state.stripeAccountId), config, state);
      const payment = await stripeOps.createPayment(account.id);
      const chargeId = typeof payment.latest_charge === "string" ? payment.latest_charge : payment.latest_charge?.id;
      const charge = await stripeOps.retrieveCharge(chargeId);
      const identity = assertPayment(payment, charge, account.id);
      state = updateState(config, state, { stage: "payment-created", ...identity });
    }
    if (state.stage === "payment-created") {
      await (dependencies.createFixtures ?? createFixtures)(owner, state);
      state = updateState(config, state, { stage: "fixtures-created" });
    }
    let session = null;
    if (STAGES.indexOf(state.stage) >= STAGES.indexOf("fixtures-created") && STAGES.indexOf(state.stage) < STAGES.indexOf("cleanup-started")) {
      session = await createCanarySession(clerk, state.sellerClerkId);
    }
    if (state.stage === "fixtures-created") {
      const denied = await fetchRefundRoute(state.orderId, session.jwt, "https://example.invalid");
      if (denied.status !== 403 || denied.body?.error !== "Forbidden") throw new Error("seller refund route did not reject cross-origin POST");
      state = updateState(config, state, { stage: "refund-route-pending" });
    }
    if (state.stage === "refund-route-pending") {
      const response = await fetchRefundRoute(state.orderId, session.jwt);
      let refundId = response.body?.refundId;
      if (response.status === 400 && response.body?.error === "A refund has already been issued for this order.") {
        const refunds = await stripeOps.listChargeRefunds(state.chargeId);
        if (refunds.length !== 1) throw new Error("seller refund lost-response recovery found the wrong refund count");
        refundId = refunds[0].id;
      } else if (
        response.status !== 200 || response.body?.ok !== true || response.body?.refundAmountCents !== REFUND_AMOUNT_CENTS
        || !Array.isArray(response.body?.refundIds) || response.body.refundIds.length !== 1 || response.body.refundIds[0] !== refundId
      ) throw new Error("seller refund authenticated route response drifted");
      if (!/^re_[A-Za-z0-9_]+$/.test(String(refundId ?? ""))) throw new Error("seller refund route returned an invalid refund");
      const refund = await stripeOps.retrieveRefund(refundId);
      const providerEvidence = assertRefundProviderEvidence(refund, { ...state, refundId });
      state = updateState(config, state, { stage: "refund-returned", refundId, ...providerEvidence });
    }
    if (state.stage === "refund-returned") {
      const createdAfter = Math.floor(Date.parse(state.startedAt) / 1000) - 5;
      const event = await waitFor(() => stripeOps.listRefundEvents(createdAfter), (events) => findSingleRefundEvent(events, state), "seller refund Stripe event");
      const exactEvent = findSingleRefundEvent(event, state);
      state = updateState(config, state, { signedEventId: exactEvent.id });
      const snapshot = await waitFor(() => readProofSnapshot(owner, state), (row) => {
        try { assertProofSnapshot(row, state); return true; } catch { return false; }
      }, "seller refund signed confirmation");
      const proven = assertProofSnapshot(snapshot, state);
      state = updateState(config, state, { stage: "signed-confirmed",
        localPaymentEventId: proven.localPaymentEventId, signedPaymentEventId: proven.signedPaymentEventId,
        caseApplicationId: proven.caseApplicationId, notificationId: proven.notificationId, emailOutboxId: proven.emailOutboxId });
    }
    const delivered = await readProofSnapshot(owner, state);
    if (state.stage === "signed-confirmed") {
      const retry = await fetchRefundRoute(state.orderId, session.jwt);
      if (retry.status !== 400 || retry.body?.error !== "A refund has already been issued for this order.") throw new Error("seller refund route retry did not fail closed");
      assertReplayUnchanged(delivered, await readProofSnapshot(owner, state), state);
      state = updateState(config, state, { stage: "route-retry-proven" });
    }
    if (state.stage === "route-retry-proven") state = updateState(config, state, { stage: "signed-replay-pending" });
    if (state.stage === "signed-replay-pending") {
      await stripeOps.resendEvent(provider.platform.id, state.signedEventId);
      const replay = await waitFor(() => readProofSnapshot(owner, state), (row) => {
        try { assertReplayUnchanged(delivered, row, state); return true; } catch { return false; }
      }, "seller refund signed exact replay", 20, 1000);
      assertReplayUnchanged(delivered, replay, state);
      state = updateState(config, state, { stage: "signed-replayed" });
    }
    if (state.stage === "signed-replayed") state = updateState(config, state, { stage: "cleanup-started" });
    if (state.stage === "cleanup-started") {
      await revokeCanarySessions(clerk, state.sellerClerkId);
      await deleteRefundRateLimitKeys(redis, state.sellerUserId);
      const before = await readCleanupSnapshot(owner, state);
      if (Number(before.buyerCount) === 1) await (dependencies.cleanupExactRows ?? cleanupExactRows)(owner, state);
      assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
      if (!await deleteDisposableAccount(stripeOps, config, state)) {
        throw new Error("seller refund disposable account deletion failed");
      }
      removeOnboardingRecord(config, state);
      state = updateState(config, state, { stage: "cleaned" });
    }
    if (state.stage === "cleaned") {
      const sessionsRevoked = await revokeCanarySessions(clerk, state.sellerClerkId);
      const rateLimitKeysRemoved = await deleteRefundRateLimitKeys(redis, state.sellerUserId);
      const cleanupSnapshot = assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
      if (!await deleteDisposableAccount(stripeOps, config, state)) {
        throw new Error("seller refund cleaned state did not retain deleted account evidence");
      }
      const cleanup = {
        accountDeleted: true,
        applicationRowsRemoved: true,
        clerkSessionsRevoked: sessionsRevoked,
        rateLimitKeysRemoved,
        processedWebhookCount: cleanupSnapshot.processedWebhookCount,
        canaryCount: cleanupSnapshot.canaryCount,
      };
      const evidence = assertEvidence(buildEvidence(config, state, cleanup), config);
      writePrivateJson(config.evidencePath, evidence);
      unlinkSync(config.statePath);
      return evidence;
    }
    throw new Error("seller refund proof reached an unsupported recovery stage");
  } finally {
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

async function main() {
  try {
    const config = validateConfiguration();
    const result = config.command === "onboard"
      ? openHostedOnboarding(config)
      : await runSellerRefundProductionProof(config);
    process.stdout.write(`${JSON.stringify({
      phase: result.phase,
      status: result.status,
      ...(result.commit ? { commit: result.commit } : {}),
      ...(result.ciRunId ? { ciRunId: result.ciRunId } : {}),
      ...(result.deploymentId ? { deploymentId: result.deploymentId } : {}),
      ...(result.next ? { next: result.next } : {}),
      ...(Object.hasOwn(result, "accountCreated") ? { accountCreated: result.accountCreated } : {}),
      ...(Object.hasOwn(result, "rawProviderIdsPersistedInOutput")
        ? { rawProviderIdsPersistedInOutput: result.rawProviderIdsPersistedInOutput }
        : {}),
      ...(Object.hasOwn(result, "secretsPersistedInOutput")
        ? { secretsPersistedInOutput: result.secretsPersistedInOutput }
        : {}),
    })}\n`);
  } catch (error) {
    process.stderr.write(`OrderPaymentEvent seller refund production proof failed closed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
