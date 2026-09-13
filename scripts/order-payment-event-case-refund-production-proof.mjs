#!/usr/bin/env node
// Restart-safe authenticated production proof for the staff Case full-refund
// authority. Stripe operations are test-mode only. Review/merge does not
// authorize execution.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/backend";
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
import {
  assertDeletedConnectedAccountAbsence,
  assertEvidence as assertSellerRefundPredecessorEvidence,
  listAccountsBounded,
} from "./order-payment-event-seller-refund-production-proof.mjs";

const { Client } = pg;

export const CONFIRMATION = "reviewed-order-payment-case-refund-production-proof";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PLATFORM_WEBHOOK_URL = `${PRODUCTION_ORIGIN}/api/stripe/webhook`;
export const CASE_REFUND_REQUIRED_FUNCTION_SIGNATURES = Object.freeze([
  'public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)',
  'public.grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)',
  'public.grainline_case_staff_resolution_finalize(text,text)',
  'public.grainline_notification_create_case_event(text,text,public."NotificationType",text,text,text)',
]);
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const REFUND_AMOUNT_CENTS = 500;
export const TRANSFER_AMOUNT_CENTS = 475;
export const STRIPE_PROOF_METADATA_KEY = "grainline_case_refund_proof";
const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_CLI_VERSION = "1.39.0";
const VERCEL_CLI_VERSION = "58.9.0";
const PRODUCTION_DATABASE_NAME = "neondb";
const CLERK_FRONTEND_API = "clerk.thegrainline.com";
const MAX_PRIVATE_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const PIN_BODY_MAX_BYTES = 2 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const FIXTURE_PATTERN = /\bopecsr_[a-f0-9]{32}(?:_[a-z]+)?\b/g;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_PATTERN = /\b(?:acct|ch|evt|pi|re|tr|trr|we)_[A-Za-z0-9_]+\b/g;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_PATTERN = /\badmin-pin-verified=[^;\s]+/gi;
const CONNECT_ONBOARDING_URL_PATTERN = /https:\/\/connect\.stripe\.com\/setup\/[^\s"']+/gi;
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
  "fixtures-create-pending",
  "fixtures-created",
  "refund-route-pending",
  "refund-returned",
  "signed-confirmed",
  "route-replay-proven",
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
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

function resultCardinality(result) {
  if (Number.isSafeInteger(result?.rowCount)) return result.rowCount;
  if (Array.isArray(result?.rows)) return result.rows.length;
  return Number.isSafeInteger(result?.affectedRows) ? result.affectedRows : null;
}

export function redact(value) {
  return String(value ?? "")
    .replace(DATABASE_URL_PATTERN, "[redacted-database-url]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(STRIPE_OBJECT_PATTERN, "[redacted-stripe-object]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]")
    .replace(COOKIE_PATTERN, "admin-pin-verified=[redacted-cookie]")
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
  const commandName = env.ORDER_PAYMENT_CASE_REFUND_COMMAND || "run";
  if (!new Set(["run", "onboard", "restore-canary"]).has(commandName)) {
    throw new Error("Case refund proof command is invalid");
  }
  const expectedCommit = required(env, "ORDER_PAYMENT_CASE_REFUND_EXPECTED_COMMIT");
  const attemptCommit = env.ORDER_PAYMENT_CASE_REFUND_ATTEMPT_COMMIT || expectedCommit;
  const deployedSourceCommit = required(env, "ORDER_PAYMENT_CASE_REFUND_DEPLOYED_SOURCE_COMMIT");
  const attemptDeployedSourceCommit = env.ORDER_PAYMENT_CASE_REFUND_ATTEMPT_DEPLOYED_SOURCE_COMMIT
    || deployedSourceCommit;
  const sellerProofAttemptCommit = required(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_ATTEMPT_COMMIT");
  const sellerProofOperatorCommit = required(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_OPERATOR_COMMIT");
  const sellerProofSignedCommit = required(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_SIGNED_COMMIT");
  const sellerProofDeployedSourceCommit = required(
    env,
    "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_DEPLOYED_SOURCE_COMMIT",
  );
  if (![expectedCommit, attemptCommit, deployedSourceCommit, attemptDeployedSourceCommit,
    sellerProofAttemptCommit, sellerProofOperatorCommit,
    sellerProofSignedCommit, sellerProofDeployedSourceCommit]
    .every((value) => COMMIT_PATTERN.test(value))) {
    throw new Error("Case refund proof commit input is invalid");
  }
  const deploymentId = required(env, "ORDER_PAYMENT_CASE_REFUND_DEPLOYMENT_ID");
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("Case refund deployment ID is invalid");
  const attemptDeploymentId = env.ORDER_PAYMENT_CASE_REFUND_ATTEMPT_DEPLOYMENT_ID || deploymentId;
  if (!DEPLOYMENT_PATTERN.test(attemptDeploymentId)) {
    throw new Error("Case refund attempt deployment ID is invalid");
  }
  const sellerProofDeploymentId = required(
    env,
    "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_DEPLOYMENT_ID",
  );
  if (!DEPLOYMENT_PATTERN.test(sellerProofDeploymentId)) {
    throw new Error("Case refund seller predecessor deployment ID is invalid");
  }
  if (required(env, "ORDER_PAYMENT_CASE_REFUND_CONFIRM") !== CONFIRMATION) {
    throw new Error("Case refund proof confirmation is invalid");
  }
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_CASE_REFUND_MAIN_CI_RUN_ID");
  const attemptMainCiRunId = env.ORDER_PAYMENT_CASE_REFUND_ATTEMPT_MAIN_CI_RUN_ID
    ? positiveInteger(env, "ORDER_PAYMENT_CASE_REFUND_ATTEMPT_MAIN_CI_RUN_ID")
    : mainCiRunId;
  const sellerProofAttemptCiRunId = positiveInteger(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_ATTEMPT_CI_RUN_ID");
  const sellerProofOperatorCiRunId = positiveInteger(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_OPERATOR_CI_RUN_ID");
  const sellerProofSignedCiRunId = positiveInteger(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_SIGNED_CI_RUN_ID");
  const sellerProofEvidenceSha256 = required(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_EVIDENCE_SHA256");
  if (!/^[a-f0-9]{64}$/.test(sellerProofEvidenceSha256)) {
    throw new Error("Case refund seller predecessor evidence digest is invalid");
  }
  const suffix = attemptCommit.slice(0, 12);
  return Object.freeze({
    cwd,
    command: commandName,
    expectedCommit,
    attemptCommit,
    deployedSourceCommit,
    deploymentId,
    attemptDeployedSourceCommit,
    attemptDeploymentId,
    mainCiRunId,
    attemptMainCiRunId,
    stripeCliPath: required(env, "ORDER_PAYMENT_CASE_REFUND_STRIPE_CLI_PATH"),
    vercelProjectDirectory: env.VERCEL_PROJECT_DIRECTORY || "/Users/drewyoung/grainline",
    sellerProofAttemptCommit,
    sellerProofOperatorCommit,
    sellerProofSignedCommit,
    sellerProofDeployedSourceCommit,
    sellerProofDeploymentId,
    sellerProofAttemptCiRunId,
    sellerProofOperatorCiRunId,
    sellerProofSignedCiRunId,
    sellerProofEvidenceSha256,
    sellerProofEvidencePath: required(env, "ORDER_PAYMENT_CASE_REFUND_SELLER_PROOF_EVIDENCE_PATH"),
    statePath: env.ORDER_PAYMENT_CASE_REFUND_STATE_PATH
      || path.join(EVIDENCE_DIRECTORY, `order-payment-event-case-refund-state-${suffix}.json`),
    onboardingPath: path.join(EVIDENCE_DIRECTORY, `order-payment-event-case-refund-onboarding-${suffix}.json`),
    evidencePath: env.ORDER_PAYMENT_CASE_REFUND_EVIDENCE_PATH
      || path.join(EVIDENCE_DIRECTORY, `order-payment-event-case-refund-proof-${suffix}.json`),
  });
}

function fixtureId(suffix = "") {
  return `opecsr_${randomUUID().replaceAll("-", "")}${suffix}`;
}

function openingMessageId(caseId) {
  return `${caseId}_opening`;
}

export function createInitialState(config, canary) {
  const attemptId = randomUUID().replaceAll("-", "");
  return Object.freeze({
    version: 1,
    phase: "order-payment-event-case-refund-production-proof",
    attemptId,
    expectedCommit: config.attemptCommit,
    deployedSourceCommit: config.attemptDeployedSourceCommit,
    mainCiRunId: config.attemptMainCiRunId,
    deploymentId: config.attemptDeploymentId,
    sellerProofOperatorCommit: config.sellerProofOperatorCommit,
    sellerProofOperatorCiRunId: config.sellerProofOperatorCiRunId,
    startedAt: new Date().toISOString(),
    stage: "reserved",
    staffUserId: canary.userId,
    staffClerkId: canary.clerkId,
    sellerUserId: fixtureId("_seller"),
    sellerClerkId: fixtureId("_seller_clerk"),
    sellerEmail: `case-refund-seller-${attemptId}@invalid.thegrainline.com`,
    buyerUserId: fixtureId("_buyer"),
    buyerClerkId: fixtureId("_buyer_clerk"),
    buyerEmail: `case-refund-buyer-${attemptId}@invalid.thegrainline.com`,
    sellerProfileId: fixtureId("_profile"),
    listingId: fixtureId("_listing"),
    orderId: fixtureId("_order"),
    orderItemId: fixtureId("_item"),
    caseId: fixtureId("_case"),
  });
}

function nullableStripeId(value, prefix) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) {
    throw new Error("Case refund state contains an invalid provider identity");
  }
  return value;
}

export function assertState(value, config) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.version !== 1 || value.phase !== "order-payment-event-case-refund-production-proof"
    || value.expectedCommit !== config.attemptCommit
    || value.deployedSourceCommit !== config.attemptDeployedSourceCommit
    || String(value.mainCiRunId) !== String(config.attemptMainCiRunId)
    || value.deploymentId !== config.attemptDeploymentId
    || value.sellerProofOperatorCommit !== config.sellerProofOperatorCommit
    || String(value.sellerProofOperatorCiRunId) !== String(config.sellerProofOperatorCiRunId)
    || !/^[a-f0-9]{32}$/.test(String(value.attemptId ?? ""))
    || !STAGES.includes(value.stage)
    || !/^user_[A-Za-z0-9]+$/.test(String(value.staffClerkId ?? ""))) {
    throw new Error("Case refund restart state drifted");
  }
  for (const key of ["staffUserId", "sellerUserId", "sellerClerkId", "buyerUserId", "buyerClerkId", "sellerProfileId", "listingId", "orderId", "orderItemId", "caseId"]) {
    if (typeof value[key] !== "string" || value[key].length < 1 || value[key].length > 191) {
      throw new Error(`Case refund restart ${key} drifted`);
    }
  }
  for (const key of ["sellerEmail", "buyerEmail"]) {
    if (typeof value[key] !== "string" || !value[key].endsWith("@invalid.thegrainline.com")) {
      throw new Error(`Case refund restart ${key} drifted`);
    }
  }
  const normalized = {
    ...value,
    stripeAccountId: nullableStripeId(value.stripeAccountId, "acct"),
    paymentIntentId: nullableStripeId(value.paymentIntentId, "pi"),
    chargeId: nullableStripeId(value.chargeId, "ch"),
    transferId: nullableStripeId(value.transferId, "tr"),
    refundId: nullableStripeId(value.refundId, "re"),
    transferReversalId: nullableStripeId(value.transferReversalId, "trr"),
    signedEventId: nullableStripeId(value.signedEventId, "evt"),
  };
  for (const key of ["localPaymentEventId", "signedPaymentEventId", "claimId", "resolutionMessageId",
    "buyerNotificationId", "sellerNotificationId", "emailOutboxId"]) {
    if (normalized[key] !== undefined && normalized[key] !== null
      && (typeof normalized[key] !== "string" || normalized[key].length < 1 || normalized[key].length > 191
        || !/^[A-Za-z0-9:_-]+$/.test(normalized[key]))) {
      throw new Error(`Case refund restart ${key} drifted`);
    }
  }
  const stageIndex = STAGES.indexOf(value.stage);
  const requirements = [
    ["account-created", ["stripeAccountId"]],
    ["payment-created", ["paymentIntentId", "chargeId", "transferId"]],
    ["refund-returned", ["refundId", "transferReversalId"]],
    ["signed-confirmed", ["signedEventId", "localPaymentEventId", "signedPaymentEventId", "claimId", "resolutionMessageId", "buyerNotificationId", "sellerNotificationId", "emailOutboxId"]],
  ];
  for (const [stage, keys] of requirements) {
    if (stageIndex >= STAGES.indexOf(stage) && keys.some((key) => !normalized[key])) {
      throw new Error(`Case refund restart state is incomplete for ${stage}`);
    }
  }
  return Object.freeze(normalized);
}

function updateState(config, state, update) {
  const next = assertState({ ...state, ...update }, config);
  if (STAGES.indexOf(next.stage) < STAGES.indexOf(state.stage)) {
    throw new Error("Case refund restart state cannot move backward");
  }
  writePrivateJson(config.statePath, next);
  return next;
}

function childEnvironment(extra = {}) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

function command(name, args, { cwd, env, label = name, timeout = 60_000 } = {}) {
  return execFileSync(name, args, {
    cwd,
    env: env ?? childEnvironment(),
    encoding: "utf8",
    maxBuffer: MAX_PAGE_BYTES,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function readGitState(cwd) {
  return {
    branch: command("git", ["branch", "--show-current"], { cwd }).trim(),
    head: command("git", ["rev-parse", "HEAD"], { cwd }).trim(),
    status: command("git", ["status", "--porcelain"], { cwd }),
  };
}

function readGitHubCiRun(runId) {
  return JSON.parse(command("gh", ["run", "view", String(runId), "--json", "databaseId,status,conclusion,headSha,event,workflowName,headBranch,url"], {
    label: "Case refund exact-main CI lookup",
  }));
}

function verifyExecutionBindings(config) {
  assertGitState(readGitState(config.cwd), config.expectedCommit);
  parseGitHubCiRun(
    readGitHubCiRun(config.mainCiRunId),
    config.expectedCommit,
    config.mainCiRunId,
  );
}

function assertVercelProject(config) {
  const project = JSON.parse(readFileSync(path.join(config.vercelProjectDirectory, ".vercel", "project.json"), "utf8"));
  for (const [key, expected] of Object.entries(EXPECTED_PROJECT)) {
    if (project?.[key] !== expected) throw new Error("Case refund Vercel project identity drifted");
  }
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("Case refund response exceeded its bound");
  return value;
}

async function boundedJson(response) {
  const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Case refund route response was not an object");
  }
  return value;
}

async function verifyDeployment(config) {
  assertVercelProject(config);
  const raw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "api", `/v13/deployments/${config.deploymentId}`,
    "--raw", "--cwd", config.vercelProjectDirectory, "--no-color",
  ], {
    cwd: config.vercelProjectDirectory,
    env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}),
    label: "Case refund deployment lookup",
  });
  parseVercelDeployment(raw, config);
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const healthBody = JSON.parse(await boundedText(health, MAX_PRIVATE_BYTES));
  if (health.status !== 200 || healthBody?.ok !== true) throw new Error("Case refund production health failed");
  const page = await fetch(PRODUCTION_ORIGIN, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const body = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("Case refund canonical alias drifted");
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
  const ownerIdentity = await owner.query("SELECT current_user AS role, current_database() AS database");
  const runtimeIdentity = await runtime.query("SELECT current_user AS role, current_database() AS database");
  const posture = await owner.query(`
    SELECT relation.relrowsecurity AS enabled, relation.relforcerowsecurity AS forced,
      pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'SELECT') AS can_select,
      pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'INSERT') AS can_insert,
      pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'UPDATE') AS can_update,
      pg_catalog.has_table_privilege('${RUNTIME_ROLE}', 'public."OrderPaymentEvent"', 'DELETE') AS can_delete
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'OrderPaymentEvent'
  `);
  const functions = await owner.query(`
    WITH expected(signature) AS (
      SELECT pg_catalog.unnest($1::text[])
    )
    SELECT pg_catalog.count(*)::integer AS count,
      pg_catalog.count(*) FILTER (WHERE routine.oid IS NOT NULL AND routine.prosecdef = true
        AND routine.provolatile = 'v' AND routine.proparallel = 'u'
        AND routine.proconfig @> ARRAY['search_path=pg_catalog']::text[]
        AND pg_catalog.has_function_privilege('${RUNTIME_ROLE}', routine.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ))::integer AS valid
    FROM expected LEFT JOIN LATERAL (
      SELECT procedure_row.* FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = pg_catalog.to_regprocedure(expected.signature)
    ) AS routine ON true
  `, [CASE_REFUND_REQUIRED_FUNCTION_SIGNATURES]);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(posture.rows, [{ enabled: false, forced: false, can_select: true, can_insert: true, can_update: true, can_delete: true }]);
  assert.deepEqual(functions.rows, [{
    count: CASE_REFUND_REQUIRED_FUNCTION_SIGNATURES.length,
    valid: CASE_REFUND_REQUIRED_FUNCTION_SIGNATURES.length,
  }]);
}

function markerFor(config, state) {
  return sha256(`${config.attemptCommit}:${state.attemptId}:case-refund`);
}

export function buildStripeProofMetadata(config, state) {
  return Object.freeze({ [STRIPE_PROOF_METADATA_KEY]: markerFor(config, state) });
}

export function buildConnectedAccountParams(config, state) {
  return {
    country: "US",
    default_currency: "usd",
    email: "provider-canary@thegrainline.com",
    capabilities: { transfers: { requested: true } },
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    },
    business_profile: {
      mcc: "5712",
      name: "Grainline Staff Case Refund Canary",
      product_description: "Disposable Stripe test-mode staff refund reversal proof",
      url: PRODUCTION_ORIGIN,
    },
    external_account: {
      object: "bank_account",
      country: "US",
      currency: "usd",
      routing_number: "110000000",
      account_number: "000123456789",
      account_holder_name: "Grainline Staff Case Refund Canary",
      account_holder_type: "individual",
    },
    metadata: buildStripeProofMetadata(config, state),
    settings: { payouts: { schedule: { interval: "manual" } } },
  };
}

export function assertConnectedAccount(account, config, state, { requireTransferActive = true } = {}) {
  const controller = account?.controller;
  if (!account || account.deleted === true || account.livemode === true
    || !/^acct_[A-Za-z0-9_]+$/.test(String(account.id ?? ""))
    || account.metadata?.[STRIPE_PROOF_METADATA_KEY] !== markerFor(config, state)
    || account.country !== "US" || account.default_currency !== "usd"
    || controller?.fees?.payer !== "application"
    || controller?.losses?.payments !== "application"
    || controller?.requirement_collection !== "stripe"
    || controller?.stripe_dashboard?.type !== "express"
    || (requireTransferActive && account.capabilities?.transfers !== "active")) {
    throw new Error("Case refund disposable connected account drifted");
  }
  return account;
}

function buildOnboardingLinkParams(accountId) {
  if (!/^acct_[A-Za-z0-9_]+$/.test(String(accountId ?? ""))) {
    throw new Error("Case refund onboarding account ID drifted");
  }
  return {
    account: accountId,
    collection_options: { fields: "eventually_due" },
    refresh_url: `${PRODUCTION_ORIGIN}/?case_refund_canary=refresh`,
    return_url: `${PRODUCTION_ORIGIN}/?case_refund_canary=return`,
    type: "account_onboarding",
  };
}

function assertOnboardingRecord(value, config, state, requireFresh = true) {
  let parsed;
  try { parsed = new URL(value?.url); } catch { throw new Error("Case refund onboarding URL drifted"); }
  if (value?.version !== 1 || value?.phase !== "order-payment-event-case-refund-onboarding"
    || value?.attemptId !== state.attemptId || value?.expectedCommit !== config.attemptCommit
    || value?.stripeAccountId !== state.stripeAccountId
    || parsed.protocol !== "https:" || parsed.hostname !== "connect.stripe.com" || !parsed.pathname.startsWith("/setup/")
    || !Number.isSafeInteger(value?.expiresAt) || value.expiresAt <= 0
    || (requireFresh && value.expiresAt <= Math.floor(Date.now() / 1000))) {
    throw new Error("Case refund onboarding record drifted");
  }
  return value;
}

function writeOnboardingRecord(config, state, link) {
  const value = assertOnboardingRecord({
    version: 1,
    phase: "order-payment-event-case-refund-onboarding",
    expectedCommit: config.attemptCommit,
    attemptId: state.attemptId,
    stripeAccountId: state.stripeAccountId,
    url: link.url,
    expiresAt: link.expires_at,
  }, config, state);
  writePrivateJson(config.onboardingPath, value);
  return value;
}

function removeOnboardingRecord(config, state) {
  if (!existsSync(config.onboardingPath)) return;
  assertOnboardingRecord(readPrivateJson(config.onboardingPath, "Case refund onboarding record"), config, state, false);
  unlinkSync(config.onboardingPath);
}

function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") return listPromise.autoPagingToArray({ limit: 1000 });
  return (async () => {
    const rows = [];
    for await (const row of listPromise) rows.push(row);
    return rows;
  })();
}

function stripeDependencies(stripe, secretKey, config, state) {
  const idempotency = (key) => ({ idempotencyKey: `grainline-ope-case-refund-${config.attemptCommit}-${state.attemptId}-${key}` });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({ include: ["webhook_endpoint.url"], limit: 100 })),
    createAccount: () => stripe.accounts.create(buildConnectedAccountParams(config, state), idempotency("account")),
    retrieveAccount: (id) => stripe.accounts.retrieve(id),
    createOnboardingLink: (id) => stripe.accountLinks.create(buildOnboardingLinkParams(id), idempotency(`onboarding-${randomUUID()}`)),
    listAccounts: () => listAccountsBounded((params) => stripe.accounts.list(params)),
    deleteAccount: (id) => stripe.accounts.del(id),
    retrieveBalance: (id) => stripe.balance.retrieve({}, { stripeAccount: id }),
    createPayment: (accountId) => stripe.paymentIntents.create({
      amount: REFUND_AMOUNT_CENTS,
      currency: "usd",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      transfer_data: { destination: accountId, amount: TRANSFER_AMOUNT_CENTS },
      description: "Grainline staff Case refund authority proof",
      metadata: buildStripeProofMetadata(config, state),
    }, idempotency("payment")),
    retrievePayment: (id) => stripe.paymentIntents.retrieve(id),
    retrieveCharge: (id) => stripe.charges.retrieve(id, { expand: ["transfer"] }),
    retrieveRefund: (id) => stripe.refunds.retrieve(id, { expand: ["transfer_reversal"] }),
    listRefunds: (chargeId) => listAll(stripe.refunds.list({ charge: chargeId, limit: 100 })),
    listRefundEvents: (createdAfter) => listAll(stripe.events.list({ created: { gte: createdAfter }, limit: 100, type: "charge.refunded" })),
    resendEvent(endpointId, eventId) {
      const cliRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-ope-case-refund-cli-"));
      try {
        const environment = childEnvironment({ STRIPE_API_KEY: secretKey, XDG_CONFIG_HOME: cliRoot });
        const version = command(config.stripeCliPath, ["version", "--color", "off"], { env: environment, label: "Stripe CLI version" });
        if (version.trim().split("\n")[0] !== `stripe version ${STRIPE_CLI_VERSION}`) {
          throw new Error("Case refund Stripe CLI version drifted");
        }
        command(config.stripeCliPath, ["events", "resend", eventId, "--webhook-endpoint", endpointId, "--confirm", "--color", "off"], {
          env: environment,
          label: "Stripe exact Case refund resend",
        });
      } finally {
        rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  };
}

export function assertPayment(payment, charge, accountId) {
  const chargeId = typeof payment?.latest_charge === "string" ? payment.latest_charge : payment?.latest_charge?.id;
  const transfer = charge?.transfer;
  const transferId = typeof transfer === "object" && transfer ? transfer.id : null;
  const destination = typeof transfer?.destination === "string" ? transfer.destination : transfer?.destination?.id;
  if (!/^pi_[A-Za-z0-9_]+$/.test(String(payment?.id ?? "")) || payment?.livemode !== false
    || payment?.status !== "succeeded" || payment?.amount !== REFUND_AMOUNT_CENTS || payment?.currency !== "usd"
    || charge?.id !== chargeId || charge?.livemode !== false || charge?.paid !== true
    || charge?.amount !== REFUND_AMOUNT_CENTS || charge?.currency !== "usd"
    || !/^tr_[A-Za-z0-9_]+$/.test(String(transferId ?? ""))
    || transfer.amount !== TRANSFER_AMOUNT_CENTS || destination !== accountId) {
    throw new Error("Case refund destination payment drifted");
  }
  return Object.freeze({ paymentIntentId: payment.id, chargeId, transferId });
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

async function createDestinationPayment(stripeOps, accountId) {
  const created = await stripeOps.createPayment(accountId);
  if (!/^pi_[A-Za-z0-9_]+$/.test(String(created?.id ?? ""))) throw new Error("Case refund payment identity drifted");
  const payment = await waitFor(
    () => stripeOps.retrievePayment(created.id),
    (candidate) => candidate?.status === "succeeded" && /^ch_[A-Za-z0-9_]+$/.test(String(
      typeof candidate?.latest_charge === "string" ? candidate.latest_charge : candidate?.latest_charge?.id,
    )),
    "Case refund payment retrieval",
    20,
    1000,
  );
  const chargeId = typeof payment.latest_charge === "string" ? payment.latest_charge : payment.latest_charge?.id;
  const charge = await waitFor(
    () => stripeOps.retrieveCharge(chargeId),
    (candidate) => {
      try { assertPayment(payment, candidate, accountId); return true; } catch { return false; }
    },
    "Case refund destination transfer retrieval",
    20,
    1000,
  );
  return assertPayment(payment, charge, accountId);
}

async function selectCanary(clerk, owner, state = null) {
  const users = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (users.totalCount !== 1 || users.data.length !== 1) {
    throw new Error("Case refund expected exactly one operational canary");
  }
  const clerkUser = users.data[0];
  if (clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || clerkUser.banned || clerkUser.locked
    || clerkUser.publicMetadata?.grainlineOperationalCanary
      !== "notification-rls-route-and-production-canary") {
    throw new Error("Case refund operational canary identity drifted");
  }
  const result = await owner.query(`
    SELECT account.id, account."clerkId", account.role::text,
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE "userId" = account.id) AS sellers
    FROM public."User" AS account
    WHERE account."clerkId" = $1 AND account."deletedAt" IS NULL AND account.banned = false
  `, [clerkUser.id]);
  if (resultCardinality(result) !== 1) throw new Error("Case refund canary database identity drifted");
  const candidate = result.rows[0];
  if (state && (candidate.id !== state.staffUserId || candidate.clerkId !== state.staffClerkId)) {
    throw new Error("Case refund restart canary identity drifted");
  }
  if (Number(candidate.sellers) !== 0
    || (!state && candidate.role !== "USER")
    || (state && !new Set(["USER", "EMPLOYEE"]).has(candidate.role))) {
    throw new Error("Case refund canary role or profile posture drifted");
  }
  const sessions = await clerk.sessions.getSessionList({
    limit: 100,
    status: "active",
    userId: candidate.clerkId,
  });
  if (!state && (sessions.totalCount !== 0 || sessions.data.length !== 0)) {
    throw new Error("Case refund canary has a pre-existing active session");
  }
  return Object.freeze({ userId: candidate.id, clerkId: candidate.clerkId });
}

export async function ensureTemporaryStaffRole(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const result = await owner.query(`
      UPDATE public."User"
         SET role='EMPLOYEE'::public."Role", "updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1 AND "clerkId"=$2 AND role='USER'::public."Role"
         AND banned=false AND "deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM public."SellerProfile" WHERE "userId"=$1)
       RETURNING id
    `, [state.staffUserId, state.staffClerkId]);
    if (resultCardinality(result) === 0) {
      const existing = await owner.query(`
        SELECT id FROM public."User"
         WHERE id=$1 AND "clerkId"=$2 AND role='EMPLOYEE'::public."Role"
           AND banned=false AND "deletedAt" IS NULL
           AND NOT EXISTS (SELECT 1 FROM public."SellerProfile" WHERE "userId"=$1)
      `, [state.staffUserId, state.staffClerkId]);
      if (resultCardinality(existing) !== 1) throw new Error("Case refund temporary staff promotion drifted");
    } else if (resultCardinality(result) !== 1) {
      throw new Error("Case refund temporary staff promotion was not singular");
    }
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function restoreCanaryRole(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const result = await owner.query(`
      UPDATE public."User"
         SET role='USER'::public."Role", "updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1 AND "clerkId"=$2 AND role='EMPLOYEE'::public."Role"
         AND banned=false AND "deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM public."SellerProfile" WHERE "userId"=$1)
       RETURNING id
    `, [state.staffUserId, state.staffClerkId]);
    if (resultCardinality(result) === 0) {
      const existing = await owner.query(`
        SELECT id FROM public."User"
         WHERE id=$1 AND "clerkId"=$2 AND role='USER'::public."Role"
           AND banned=false AND "deletedAt" IS NULL
           AND NOT EXISTS (SELECT 1 FROM public."SellerProfile" WHERE "userId"=$1)
      `, [state.staffUserId, state.staffClerkId]);
      if (resultCardinality(existing) !== 1) throw new Error("Case refund canary role restoration drifted");
    } else if (resultCardinality(result) !== 1) {
      throw new Error("Case refund canary role restoration was not singular");
    }
    await owner.query("COMMIT");
    return true;
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) throw new Error("Case refund Clerk cookie response drifted");
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (separator <= 0 || !/^[A-Za-z0-9_]+$/.test(name) || !content || content.length > 8_192) {
      throw new Error("Case refund Clerk cookie shape drifted");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) throw new Error("Case refund Clerk cookie jar drifted");
  return value;
}

async function createCanarySession(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const signInToken = await clerk.signInTokens.createSignInToken({ userId: clerkUserId, expiresInSeconds: 60 });
  if (!/^sit_[A-Za-z0-9]+$/.test(String(signInToken?.id ?? ""))
    || signInToken.userId !== clerkUserId
    || typeof signInToken.token !== "string"
    || signInToken.token.length < 32
    || signInToken.token.length > 4_096) {
    throw new Error("Case refund Clerk ticket creation failed");
  }
  const jar = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: PRODUCTION_ORIGIN },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = await boundedJson(clientResponse);
  if (clientResponse.status !== 200 || (clientPayload.response ?? clientPayload).object !== "client") {
    throw new Error("Case refund Clerk handshake failed");
  }
  const exchange = await fetch(`https://${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: clerkCookieHeader(jar),
      origin: PRODUCTION_ORIGIN,
    },
    body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchange, jar);
  const exchangePayload = await boundedJson(exchange);
  const attempt = exchangePayload.response ?? exchangePayload;
  const sessionId = attempt.created_session_id;
  if (exchange.status !== 200 || attempt.object !== "sign_in_attempt" || attempt.status !== "complete"
    || !/^sess_[A-Za-z0-9]+$/.test(String(sessionId ?? ""))) {
    throw new Error("Case refund Clerk ticket exchange failed");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Case refund Clerk session token drifted");
  }
  return Object.freeze({ jwt: token.jwt, sessionId });
}

async function revokeCanarySessions(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const after = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  return after.totalCount === 0 && after.data.length === 0;
}

export function extractAdminPinCookie(headers) {
  const values = headers?.getSetCookie?.()
    ?? (headers?.get?.("set-cookie") ? [headers.get("set-cookie")] : []);
  const matches = values
    .map((value) => String(value).split(";", 1)[0])
    .filter((value) => value.startsWith("admin-pin-verified="));
  if (matches.length !== 1 || matches[0].length > 2048) {
    throw new Error("Case refund Admin-PIN cookie response drifted");
  }
  return matches[0];
}

async function verifyAdminPin(jwt, pin) {
  if (typeof pin !== "string" || pin.length < 1 || pin.length > 256) {
    throw new Error("Case refund Admin PIN input drifted");
  }
  const response = await fetch(`${PRODUCTION_ORIGIN}/api/admin/verify-pin`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      "cache-control": "no-store",
      "content-type": "application/json",
      origin: PRODUCTION_ORIGIN,
    },
    body: JSON.stringify({ pin }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await boundedJson(response);
  if (response.status !== 200 || body?.ok !== true) {
    throw new Error("Case refund Admin PIN verification failed");
  }
  return extractAdminPinCookie(response.headers);
}

function loopbackPage(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Grainline staff refund proof</title></head><body style="font-family:system-ui;max-width:38rem;margin:4rem auto;padding:1rem"><h1>Staff Case refund proof</h1><p>Enter the Grainline Admin PIN. It is sent only to this loopback process, forwarded once to the normal production PIN endpoint, and is never logged or persisted.</p><form method="post" action="/${nonce}"><label>Admin PIN <input required autofocus type="password" name="pin" autocomplete="off" maxlength="256"></label><button type="submit">Continue proof</button></form></body></html>`;
}

export async function acquireAdminPinInput(dependencies = {}) {
  if (dependencies.pin !== undefined) {
    if (typeof dependencies.pin !== "string" || dependencies.pin.length < 1 || dependencies.pin.length > 256) {
      throw new Error("Case refund Admin PIN input drifted");
    }
    return dependencies.pin;
  }
  const nonce = randomBytes(24).toString("hex");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close(() => error ? reject(error) : resolve(value));
    };
    const server = createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url === `/${nonce}`) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          response.end(loopbackPage(nonce));
          return;
        }
        if (request.method !== "POST" || request.url !== `/${nonce}`) {
          response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
          response.end("Not found");
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > PIN_BODY_MAX_BYTES) throw new Error("Case refund loopback PIN body exceeded its bound");
          chunks.push(chunk);
        }
        const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const pin = params.get("pin") ?? "";
        if (pin.length < 1 || pin.length > 256) throw new Error("Case refund Admin PIN input drifted");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end("<!doctype html><html><body><h1>PIN received locally</h1><p>The proof is continuing. You may close this window.</p></body></html>");
        finish(null, pin);
      } catch (error) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end("<!doctype html><html><body><h1>PIN handoff failed</h1><p>The proof stopped safely. Return to Codex.</p></body></html>");
        finish(error);
      }
    });
    server.on("error", (error) => finish(error));
    const timeout = setTimeout(() => finish(new Error("Case refund Admin-PIN handoff timed out")), 10 * 60 * 1000);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return finish(new Error("Case refund loopback listener drifted"));
      const url = `http://127.0.0.1:${address.port}/${nonce}`;
      const opened = spawnSync("/usr/bin/open", [url], { stdio: "ignore", timeout: 10_000 });
      if (opened.status !== 0) finish(new Error("Case refund loopback browser did not open"));
    });
  });
}

async function fetchCaseResolution(caseId, jwt, adminCookie, origin = PRODUCTION_ORIGIN) {
  const response = await fetch(`${PRODUCTION_ORIGIN}/api/cases/${encodeURIComponent(caseId)}/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      cookie: adminCookie,
      "cache-control": "no-store",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ resolution: "REFUND_FULL" }),
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
  });
  return { status: response.status, body: await boundedJson(response) };
}

export async function createFixtures(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const collision = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id IN ($1::text, $2::text)
          OR "clerkId" IN ($3::text, $4::text) OR email IN ($5::text, $6::text)) AS users,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$7::text
          OR "userId"=$1::text OR "stripeAccountId"=$8::text) AS sellers,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$9::text) AS listings,
        (SELECT count(*)::integer FROM public."Order" WHERE id=$10::text
          OR "stripePaymentIntentId"=$11::text OR "stripeChargeId"=$12::text) AS orders,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$13::text) AS items,
        (SELECT count(*)::integer FROM public."Case" WHERE id=$14::text OR "orderId"=$10::text) AS cases,
        (SELECT count(*)::integer FROM public."CaseMessage" WHERE id=$15::text) AS messages
    `, [state.sellerUserId, state.buyerUserId, state.sellerClerkId, state.buyerClerkId,
      state.sellerEmail, state.buyerEmail, state.sellerProfileId, state.stripeAccountId,
      state.listingId, state.orderId, state.paymentIntentId, state.chargeId,
      state.orderItemId, state.caseId, openingMessageId(state.caseId)]);
    if (!Object.values(collision.rows[0] ?? {}).every((value) => Number(value) === 0)) {
      throw new Error("Case refund fixture identity collided");
    }
    const staff = await owner.query(`
      SELECT id FROM public."User"
       WHERE id=$1::text AND "clerkId"=$2::text AND role='USER'::public."Role"
         AND banned=false AND "deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM public."SellerProfile" WHERE "userId"=$1::text)
       FOR UPDATE
    `, [state.staffUserId, state.staffClerkId]);
    if (resultCardinality(staff) !== 1) throw new Error("Case refund canary fixture posture drifted");
    await owner.query(`
      INSERT INTO public."User" (id, "clerkId", email, name, role, "notificationPreferences", "updatedAt") VALUES
        ($1, $2, $3, 'Grainline Case Refund Proof Seller', 'USER', '{}'::jsonb, CURRENT_TIMESTAMP),
        ($4, $5, $6, 'Grainline Case Refund Proof Buyer', 'USER', '{"EMAIL_REFUND_ISSUED":false}'::jsonb, CURRENT_TIMESTAMP)
    `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail,
      state.buyerUserId, state.buyerClerkId, state.buyerEmail]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized", "stripeAccountId",
        "chargesEnabled", "stripeAccountVersion", "stripeControllerType", "vacationMode", "updatedAt"
      ) VALUES ($1, $2, 'Grainline Case Refund Proof', 'grainline case refund proof', $3,
        true, 'v1', 'express', true, CURRENT_TIMESTAMP)
    `, [state.sellerProfileId, state.sellerUserId, state.stripeAccountId]);
    await owner.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "shipsWithinDays", "isPrivate", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'case-refund-production-proof',
        'Disposable vacation-hidden staff Case refund production proof fixture',
        500, 'usd', 'SOLD_OUT', 'IN_STOCK', 0, 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [state.listingId, state.sellerProfileId]);
    await owner.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "stripePaymentIntentId", "stripeChargeId", "stripeTransferId",
        currency, "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents", "paidAt", "fulfillmentStatus"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'usd', 500, 0, 0, CURRENT_TIMESTAMP, 'PENDING')
    `, [state.orderId, state.buyerUserId, state.sellerProfileId,
      state.paymentIntentId, state.chargeId, state.transferId]);
    await owner.query(`
      INSERT INTO public."OrderItem" (id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents", "listingSnapshot")
      VALUES ($1, $2, $3, $4, 1, 500, $5::jsonb)
    `, [state.orderItemId, state.orderId, state.listingId, state.sellerProfileId,
      JSON.stringify({ title: "case-refund-production-proof", capturedAt: new Date().toISOString() })]);
    await owner.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description, status, "sellerRespondBy", "updatedAt"
      ) VALUES ($1, $2, $3, $4, 'OTHER',
        'Disposable staff Case refund production proof fixture', 'UNDER_REVIEW',
        CURRENT_TIMESTAMP + INTERVAL '48 hours', CURRENT_TIMESTAMP)
    `, [state.caseId, state.orderId, state.buyerUserId, state.sellerUserId]);
    await owner.query(`
      INSERT INTO public."CaseMessage" (id, "caseId", "authorId", "authorKind", body, "createdAt")
      VALUES ($1, $2, $3, 'BUYER',
        'Disposable opening evidence for the staff Case refund production proof.', CURRENT_TIMESTAMP)
    `, [openingMessageId(state.caseId), state.caseId, state.buyerUserId]);
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readFixtureSnapshot(owner, state) {
  const result = await owner.query(`
    SELECT
      (SELECT count(*)::integer FROM public."User" WHERE id=$1 AND "clerkId"=$2 AND email=$3
        AND name='Grainline Case Refund Proof Seller' AND role='USER') AS seller_user,
      (SELECT count(*)::integer FROM public."User" WHERE id=$4 AND "clerkId"=$5 AND email=$6
        AND name='Grainline Case Refund Proof Buyer' AND role='USER'
        AND "notificationPreferences"='{"EMAIL_REFUND_ISSUED":false}'::jsonb) AS buyer_user,
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$7 AND "userId"=$1
        AND "stripeAccountId"=$8 AND "displayName"='Grainline Case Refund Proof'
        AND "vacationMode"=true AND "chargesEnabled"=true) AS seller_profile,
      (SELECT count(*)::integer FROM public."Listing" WHERE id=$9 AND "sellerId"=$7
        AND title='case-refund-production-proof' AND "priceCents"=500 AND "stockQuantity"=0
        AND status='SOLD_OUT' AND "listingType"='IN_STOCK' AND "isPrivate"=true) AS listing,
      (SELECT count(*)::integer FROM public."Order" WHERE id=$10 AND "buyerId"=$4
        AND "sellerProfileId"=$7 AND "stripePaymentIntentId"=$11 AND "stripeChargeId"=$12
        AND "stripeTransferId"=$13 AND "itemsSubtotalCents"=500 AND "paidAt" IS NOT NULL) AS order_row,
      (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$14 AND "orderId"=$10
        AND "listingId"=$9 AND "sellerProfileId"=$7 AND quantity=1 AND "priceCents"=500) AS order_item,
      (SELECT count(*)::integer FROM public."Case" WHERE id=$15 AND "orderId"=$10
        AND "buyerId"=$4 AND "sellerId"=$1 AND status='UNDER_REVIEW' AND resolution IS NULL) AS case_row,
      (SELECT count(*)::integer FROM public."CaseMessage" WHERE id=$16 AND "caseId"=$15
        AND "authorId"=$4 AND "authorKind"='BUYER') AS opening_message,
      (SELECT count(*)::integer FROM public."User" WHERE id=$17 AND "clerkId"=$18
        AND role='USER' AND banned=false AND "deletedAt" IS NULL) AS staff
  `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail,
    state.buyerUserId, state.buyerClerkId, state.buyerEmail,
    state.sellerProfileId, state.stripeAccountId, state.listingId,
    state.orderId, state.paymentIntentId, state.chargeId, state.transferId,
    state.orderItemId, state.caseId, openingMessageId(state.caseId),
    state.staffUserId, state.staffClerkId]);
  return result.rows[0];
}

export function classifyFixtureSnapshot(snapshot) {
  const counts = Object.fromEntries(Object.entries(snapshot ?? {}).map(([key, value]) => [key, Number(value)]));
  const values = Object.values(counts);
  if (values.length !== 9 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 1)) {
    throw new Error("Case refund fixture snapshot drifted");
  }
  if (values.every((value) => value === 1)) return "complete";
  if (values.slice(0, -1).every((value) => value === 0) && counts.staff === 1) return "absent";
  throw new Error("Case refund fixture creation was partial");
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
  assertStripeRefundObject(refund, "staff Case refund provider evidence");
  const reversal = refund?.transfer_reversal;
  const reversalId = typeof reversal === "object" && reversal ? reversal.id : null;
  if (refund?.id !== state.refundId || refund?.amount !== REFUND_AMOUNT_CENTS
    || refund?.currency !== "usd" || !["pending", "requires_action", "succeeded"].includes(refund?.status)
    || refund?.payment_intent !== state.paymentIntentId || refund?.charge !== state.chargeId
    || !/^trr_[A-Za-z0-9_]+$/.test(String(reversalId ?? ""))
    || reversal.amount !== TRANSFER_AMOUNT_CENTS || reversal.transfer !== state.transferId) {
    throw new Error("Staff Case refund provider evidence drifted");
  }
  return Object.freeze({ transferReversalId: reversalId });
}

export async function readProofSnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId"=$1 AND "eventType"='REFUND') AS "paymentCount",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId"='local:case_refund_recorded:' || $2) AS "localPaymentEventId",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS "signedPaymentEventId",
        (SELECT reason FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS "signedReason",
        (SELECT metadata->>'resolutionClaimId' FROM public."OrderPaymentEvent" WHERE "stripeEventId"='local:case_refund_recorded:' || $2) AS "localClaimId",
        (SELECT metadata->>'transferReversalId' FROM public."OrderPaymentEvent" WHERE "stripeEventId"='local:case_refund_recorded:' || $2) AS "localTransferReversalId",
        (SELECT metadata->>'transferReversalAmountCents' FROM public."OrderPaymentEvent" WHERE "stripeEventId"='local:case_refund_recorded:' || $2) AS "localTransferReversalAmount",
        (SELECT metadata->>'latestRefundId' FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS "signedLatestRefundId",
        (SELECT metadata->>'totalRefundedCents' FROM public."OrderPaymentEvent" WHERE "stripeEventId"=$3) AS "signedTotalRefunded",
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE "orderId"=$1 AND "stripeObjectId"=$2 AND "stripeObjectType"='refund') AS "refundObjectCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id=$3 AND type='charge.refunded'
          AND "sourceObjectId"=$4 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS "webhookCount",
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id=$3) AS "webhookGeneration",
        (SELECT "sellerRefundId" FROM public."Order" WHERE id=$1) AS "orderRefundId",
        (SELECT "sellerRefundAmountCents" FROM public."Order" WHERE id=$1) AS "orderRefundAmount",
        (SELECT "caseResolutionClaimId" IS NULL FROM public."Order" WHERE id=$1) AS "orderLeaseCleared",
        (SELECT "reviewNeeded" FROM public."Order" WHERE id=$1) AS "reviewNeeded",
        (SELECT "stockQuantity" FROM public."Listing" WHERE id=$5) AS stock,
        (SELECT status::text FROM public."Listing" WHERE id=$5) AS "listingStatus",
        (SELECT status::text FROM public."Case" WHERE id=$6) AS "caseStatus",
        (SELECT resolution::text FROM public."Case" WHERE id=$6) AS "caseResolution",
        (SELECT "refundAmountCents" FROM public."Case" WHERE id=$6) AS "caseRefundAmount",
        (SELECT "stripeRefundId" FROM public."Case" WHERE id=$6) AS "caseRefundId",
        (SELECT "resolvedById" FROM public."Case" WHERE id=$6) AS "caseResolvedBy",
        (SELECT id FROM public."CaseResolutionClaim" WHERE "caseId"=$6 AND "orderId"=$1) AS "claimId",
        (SELECT status::text FROM public."CaseResolutionClaim" WHERE "caseId"=$6 AND "orderId"=$1) AS "claimStatus",
        (SELECT "orderPaymentEventId" FROM public."CaseResolutionClaim" WHERE "caseId"=$6 AND "orderId"=$1) AS "claimPaymentEventId",
        (SELECT id FROM public."CaseMessage" WHERE "caseId"=$6 AND "authorId"=$7 AND "authorKind"='STAFF'
          AND id LIKE 'case_resolution_message_%') AS "resolutionMessageId",
        (SELECT count(*)::integer FROM public."Notification" WHERE "userId"=$8 AND type='REFUND_ISSUED'
          AND "sourceType"='case' AND "sourceId"=$6 AND "relatedUserId"=$7) AS "buyerNotificationCount",
        (SELECT id FROM public."Notification" WHERE "userId"=$8 AND type='REFUND_ISSUED'
          AND "sourceType"='case' AND "sourceId"=$6 AND "relatedUserId"=$7) AS "buyerNotificationId",
        (SELECT count(*)::integer FROM public."Notification" WHERE "userId"=$9 AND type='CASE_MESSAGE'
          AND "sourceType"='case_message' AND "relatedUserId"=$7) AS "sellerNotificationCount",
        (SELECT id FROM public."Notification" WHERE "userId"=$9 AND type='CASE_MESSAGE'
          AND "sourceType"='case_message' AND "relatedUserId"=$7) AS "sellerNotificationId",
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE "userId"=$8 AND "preferenceKey"='EMAIL_REFUND_ISSUED'
          AND "sourceType"='case' AND status='SKIPPED') AS "outboxCount",
        (SELECT id FROM public."EmailOutbox" WHERE "userId"=$8 AND "preferenceKey"='EMAIL_REFUND_ISSUED'
          AND "sourceType"='case' AND status='SKIPPED') AS "emailOutboxId",
        (SELECT count(*)::integer FROM public."AdminAuditLog" WHERE "adminId"=$7 AND action='RESOLVE_CASE'
          AND "targetType"='CASE' AND "targetId"=$6) AS "adminAuditCount",
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId"=$7 AND action='CASE_REFUND_RECORDED'
          AND "targetType"='ORDER' AND "targetId"=$1) AS "localAuditCount",
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE "actorId"=$3 AND action='STRIPE_REFUND_RECORDED'
          AND "targetType"='ORDER' AND "targetId"=$1) AS "signedAuditCount"
    `, [state.orderId, state.refundId, state.signedEventId, state.chargeId,
      state.listingId, state.caseId, state.staffUserId, state.buyerUserId, state.sellerUserId]);
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
    localClaimId: snapshot?.localClaimId ?? null,
    localTransferReversalId: snapshot?.localTransferReversalId ?? null,
    localTransferReversalAmount: Number(snapshot?.localTransferReversalAmount),
    signedLatestRefundId: snapshot?.signedLatestRefundId ?? null,
    signedTotalRefunded: Number(snapshot?.signedTotalRefunded),
    refundObjectCount: Number(snapshot?.refundObjectCount),
    webhookCount: Number(snapshot?.webhookCount),
    webhookGeneration: String(snapshot?.webhookGeneration ?? ""),
    orderRefundId: snapshot?.orderRefundId ?? null,
    orderRefundAmount: Number(snapshot?.orderRefundAmount),
    orderLeaseCleared: snapshot?.orderLeaseCleared,
    reviewNeeded: snapshot?.reviewNeeded,
    stock: Number(snapshot?.stock),
    listingStatus: snapshot?.listingStatus,
    caseStatus: snapshot?.caseStatus,
    caseResolution: snapshot?.caseResolution,
    caseRefundAmount: Number(snapshot?.caseRefundAmount),
    caseRefundId: snapshot?.caseRefundId ?? null,
    caseResolvedBy: snapshot?.caseResolvedBy ?? null,
    claimId: snapshot?.claimId ?? null,
    claimStatus: snapshot?.claimStatus ?? null,
    claimPaymentEventId: snapshot?.claimPaymentEventId ?? null,
    resolutionMessageId: snapshot?.resolutionMessageId ?? null,
    buyerNotificationCount: Number(snapshot?.buyerNotificationCount),
    buyerNotificationId: snapshot?.buyerNotificationId ?? null,
    sellerNotificationCount: Number(snapshot?.sellerNotificationCount),
    sellerNotificationId: snapshot?.sellerNotificationId ?? null,
    outboxCount: Number(snapshot?.outboxCount),
    emailOutboxId: snapshot?.emailOutboxId ?? null,
    adminAuditCount: Number(snapshot?.adminAuditCount),
    localAuditCount: Number(snapshot?.localAuditCount),
    signedAuditCount: Number(snapshot?.signedAuditCount),
  };
  if (normalized.paymentCount !== 2 || normalized.refundObjectCount !== 2
    || normalized.webhookCount !== 1 || !/^[1-9][0-9]*$/.test(normalized.webhookGeneration)
    || !new Set(["local_refund_confirmed", "local_refund_pending_confirmation"]).has(normalized.signedReason)
    || normalized.localClaimId !== normalized.claimId
    || normalized.localTransferReversalId !== state.transferReversalId
    || normalized.localTransferReversalAmount !== TRANSFER_AMOUNT_CENTS
    || normalized.signedLatestRefundId !== state.refundId
    || normalized.signedTotalRefunded !== REFUND_AMOUNT_CENTS
    || normalized.orderRefundId !== state.refundId || normalized.orderRefundAmount !== REFUND_AMOUNT_CENTS
    || normalized.orderLeaseCleared !== true || normalized.reviewNeeded !== true
    || normalized.stock !== 1 || normalized.listingStatus !== "SOLD_OUT"
    || normalized.caseStatus !== "RESOLVED" || normalized.caseResolution !== "REFUND_FULL"
    || normalized.caseRefundAmount !== REFUND_AMOUNT_CENTS || normalized.caseRefundId !== state.refundId
    || normalized.caseResolvedBy !== state.staffUserId || normalized.claimStatus !== "FINALIZED"
    || normalized.claimPaymentEventId !== normalized.localPaymentEventId
    || normalized.resolutionMessageId !== `case_resolution_message_${normalized.claimId}`
    || normalized.buyerNotificationCount !== 1 || normalized.sellerNotificationCount !== 1
    || normalized.outboxCount !== 1 || normalized.adminAuditCount !== 1
    || normalized.localAuditCount !== 1 || normalized.signedAuditCount !== 1
    || !normalized.localPaymentEventId || !normalized.signedPaymentEventId || !normalized.claimId
    || !normalized.buyerNotificationId || !normalized.sellerNotificationId || !normalized.emailOutboxId
    || (expected.localPaymentEventId && normalized.localPaymentEventId !== expected.localPaymentEventId)
    || (expected.signedPaymentEventId && normalized.signedPaymentEventId !== expected.signedPaymentEventId)
    || (expected.claimId && normalized.claimId !== expected.claimId)
    || (expected.resolutionMessageId && normalized.resolutionMessageId !== expected.resolutionMessageId)
    || (expected.buyerNotificationId && normalized.buyerNotificationId !== expected.buyerNotificationId)
    || (expected.sellerNotificationId && normalized.sellerNotificationId !== expected.sellerNotificationId)
    || (expected.emailOutboxId && normalized.emailOutboxId !== expected.emailOutboxId)) {
    throw new Error("Staff Case refund production effects drifted");
  }
  return Object.freeze(normalized);
}

export function assertReplayUnchanged(before, after, state) {
  const first = assertProofSnapshot(before, state);
  const replay = assertProofSnapshot(after, state, first);
  for (const key of ["webhookGeneration", "localPaymentEventId", "signedPaymentEventId", "claimId",
    "resolutionMessageId", "buyerNotificationId", "sellerNotificationId", "emailOutboxId"]) {
    if (first[key] !== replay[key]) throw new Error(`Staff Case refund replay changed ${key}`);
  }
  return replay;
}

function balanceTotal(balance) {
  return [...(balance?.available ?? []), ...(balance?.pending ?? [])]
    .reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);
}

async function deleteDisposableAccount(stripeOps, config, state) {
  let current;
  try {
    current = await stripeOps.retrieveAccount(state.stripeAccountId);
  } catch (error) {
    return assertDeletedConnectedAccountAbsence(error, await stripeOps.listAccounts(), state.stripeAccountId);
  }
  if (current?.deleted === true) return current.id === state.stripeAccountId;
  assertConnectedAccount(current, config, state);
  if (balanceTotal(await stripeOps.retrieveBalance(state.stripeAccountId)) !== 0) {
    throw new Error("Case refund disposable account retained a nonzero balance");
  }
  const deleted = await stripeOps.deleteAccount(state.stripeAccountId);
  return deleted?.deleted === true && deleted.id === state.stripeAccountId;
}

async function deleteExact(client, sql, parameters, expected, label) {
  const result = await client.query(sql, parameters);
  if (resultCardinality(result) !== expected) throw new Error(`Case refund cleanup ${label} drifted`);
}

export async function cleanupExactRows(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const exact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id=$1 AND "clerkId"=$2 AND email=$3
          AND name='Grainline Case Refund Proof Seller') AS seller_user,
        (SELECT count(*)::integer FROM public."User" WHERE id=$4 AND "clerkId"=$5 AND email=$6
          AND name='Grainline Case Refund Proof Buyer' AND "notificationPreferences"='{"EMAIL_REFUND_ISSUED":false}'::jsonb) AS buyer_user,
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$7 AND "userId"=$1 AND "stripeAccountId"=$8
          AND "displayName"='Grainline Case Refund Proof' AND "vacationMode"=true) AS seller_profile,
        (SELECT count(*)::integer FROM public."Listing" WHERE id=$9 AND "sellerId"=$7
          AND title='case-refund-production-proof' AND "priceCents"=500 AND "stockQuantity"=1
          AND status='SOLD_OUT' AND "isPrivate"=true) AS listing,
        (SELECT count(*)::integer FROM public."Order" WHERE id=$10 AND "buyerId"=$4 AND "sellerProfileId"=$7
          AND "stripePaymentIntentId"=$11 AND "stripeChargeId"=$12 AND "stripeTransferId"=$13
          AND "sellerRefundId"=$14 AND "sellerRefundAmountCents"=500) AS order_row,
        (SELECT count(*)::integer FROM public."Case" WHERE id=$15 AND "orderId"=$10 AND "buyerId"=$4
          AND "sellerId"=$1 AND status='RESOLVED' AND resolution='REFUND_FULL' AND "resolvedById"=$16) AS case_row,
        (SELECT count(*)::integer FROM public."CaseMessage" WHERE "caseId"=$15
          AND id IN ($25, $26)) AS case_messages,
        (SELECT count(*)::integer FROM public."CaseResolutionClaim" WHERE id=$17 AND "caseId"=$15
          AND "orderId"=$10 AND "staffActorId"=$16 AND status='FINALIZED') AS claim,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$27 AND "orderId"=$10) AS order_item,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($18, $19) AND "orderId"=$10) AS payments,
        (SELECT count(*)::integer FROM public."Notification" WHERE id IN ($20, $21)) AS notifications,
        (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id=$22 AND status='SKIPPED') AS outbox,
        (SELECT count(*)::integer FROM public."AdminAuditLog" WHERE "adminId"=$16 AND action='RESOLVE_CASE'
          AND "targetType"='CASE' AND "targetId"=$15) AS admin_audit,
        (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE
          ("actorId"=$16 AND action='CASE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$10)
          OR ("actorId"=$23 AND action='STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$10)) AS system_audits,
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id=$23 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS webhook,
        (SELECT count(*)::integer FROM public."User" WHERE id=$16 AND "clerkId"=$24 AND role='USER') AS staff
    `, [state.sellerUserId, state.sellerClerkId, state.sellerEmail,
      state.buyerUserId, state.buyerClerkId, state.buyerEmail,
      state.sellerProfileId, state.stripeAccountId, state.listingId,
      state.orderId, state.paymentIntentId, state.chargeId, state.transferId,
      state.refundId, state.caseId, state.staffUserId, state.claimId,
      state.localPaymentEventId, state.signedPaymentEventId,
      state.buyerNotificationId, state.sellerNotificationId, state.emailOutboxId,
      state.signedEventId, state.staffClerkId, openingMessageId(state.caseId),
      state.resolutionMessageId, state.orderItemId]);
    const expected = { seller_user: 1, buyer_user: 1, seller_profile: 1, listing: 1,
      order_row: 1, case_row: 1, case_messages: 2, claim: 1, order_item: 1,
      payments: 2, notifications: 2, outbox: 1, admin_audit: 1,
      system_audits: 2, webhook: 1, staff: 1 };
    for (const [key, count] of Object.entries(expected)) {
      if (Number(exact.rows[0]?.[key]) !== count) throw new Error(`Case refund cleanup ${key} drifted`);
    }
    await deleteExact(owner, `DELETE FROM public."Notification" WHERE id IN ($1, $2) RETURNING id`,
      [state.buyerNotificationId, state.sellerNotificationId], 2, "notifications");
    await deleteExact(owner, `DELETE FROM public."EmailOutbox" WHERE id=$1 RETURNING id`,
      [state.emailOutboxId], 1, "outbox");
    await deleteExact(owner, `DELETE FROM public."AdminAuditLog" WHERE "adminId"=$1 AND action='RESOLVE_CASE'
      AND "targetType"='CASE' AND "targetId"=$2 RETURNING id`, [state.staffUserId, state.caseId], 1, "resolution audit");
    await deleteExact(owner, `DELETE FROM public."SystemAuditLog" WHERE
      ("actorId"=$1 AND action='CASE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$3)
      OR ("actorId"=$2 AND action='STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$3)
      RETURNING id`, [state.staffUserId, state.signedEventId, state.orderId], 2, "system audits");
    await deleteExact(owner, `DELETE FROM public."CaseResolutionClaim" WHERE id=$1 RETURNING id`, [state.claimId], 1, "claim");
    await deleteExact(owner, `DELETE FROM public."OrderPaymentEvent" WHERE id IN ($1, $2) RETURNING id`,
      [state.localPaymentEventId, state.signedPaymentEventId], 2, "payment evidence");
    await deleteExact(owner, `DELETE FROM public."CaseMessage" WHERE id IN ($1, $2) RETURNING id`,
      [openingMessageId(state.caseId), state.resolutionMessageId], 2, "Case messages");
    await deleteExact(owner, `DELETE FROM public."OrderItem" WHERE id=$1 RETURNING id`, [state.orderItemId], 1, "OrderItem");
    await deleteExact(owner, `DELETE FROM public."Case" WHERE id=$1 RETURNING id`, [state.caseId], 1, "Case");
    await deleteExact(owner, `DELETE FROM public."Order" WHERE id=$1 RETURNING id`, [state.orderId], 1, "Order");
    await deleteExact(owner, `DELETE FROM public."Listing" WHERE id=$1 RETURNING id`, [state.listingId], 1, "Listing");
    await deleteExact(owner, `DELETE FROM public."SellerProfile" WHERE id=$1 RETURNING id`, [state.sellerProfileId], 1, "SellerProfile");
    await deleteExact(owner, `DELETE FROM public."User" WHERE id IN ($1, $2) RETURNING id`,
      [state.sellerUserId, state.buyerUserId], 2, "fixture Users");
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCleanupSnapshot(owner, state) {
  const result = await owner.query(`
    SELECT
      (SELECT count(*)::integer FROM public."User" WHERE id IN ($1, $2)) AS "fixtureUserCount",
      (SELECT count(*)::integer FROM public."SellerProfile" WHERE id=$3) AS "sellerCount",
      (SELECT count(*)::integer FROM public."Listing" WHERE id=$4) AS "listingCount",
      (SELECT count(*)::integer FROM public."Order" WHERE id=$5) AS "orderCount",
      (SELECT count(*)::integer FROM public."OrderItem" WHERE id=$16) AS "orderItemCount",
      (SELECT count(*)::integer FROM public."Case" WHERE id=$6) AS "caseCount",
      (SELECT count(*)::integer FROM public."CaseMessage" WHERE id IN ($17, $18)) AS "caseMessageCount",
      (SELECT count(*)::integer FROM public."CaseResolutionClaim" WHERE id=$7) AS "claimCount",
      (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($8, $9)) AS "paymentCount",
      (SELECT count(*)::integer FROM public."Notification" WHERE id IN ($10, $11)) AS "notificationCount",
      (SELECT count(*)::integer FROM public."EmailOutbox" WHERE id=$12) AS "outboxCount",
      (SELECT count(*)::integer FROM public."AdminAuditLog" WHERE "adminId"=$14
        AND action='RESOLVE_CASE' AND "targetType"='CASE' AND "targetId"=$6) AS "resolutionAuditCount",
      (SELECT count(*)::integer FROM public."SystemAuditLog" WHERE
        ("actorId"=$14 AND action='CASE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$5)
        OR ("actorId"=$13 AND action='STRIPE_REFUND_RECORDED' AND "targetType"='ORDER' AND "targetId"=$5)) AS "systemAuditCount",
      (SELECT count(*)::integer FROM public."AdminAuditLog" WHERE "adminId"=$14
        AND action='ADMIN_PIN_VERIFY_OK' AND "targetType"='USER' AND "targetId"=$14
        AND "createdAt">=$19::timestamptz) AS "pinAuditCount",
      (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id=$13 AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS "processedWebhookCount",
      (SELECT count(*)::integer FROM public."User" WHERE id=$14 AND "clerkId"=$15 AND role='USER'
        AND banned=false AND "deletedAt" IS NULL) AS "canaryCount"
  `, [state.sellerUserId, state.buyerUserId, state.sellerProfileId, state.listingId,
    state.orderId, state.caseId, state.claimId, state.localPaymentEventId,
    state.signedPaymentEventId, state.buyerNotificationId, state.sellerNotificationId,
    state.emailOutboxId, state.signedEventId, state.staffUserId, state.staffClerkId,
    state.orderItemId, openingMessageId(state.caseId), state.resolutionMessageId, state.startedAt]);
  return result.rows[0];
}

export function assertCleanupSnapshot(snapshot) {
  const normalized = Object.fromEntries(Object.entries(snapshot ?? {}).map(([key, value]) => [key, Number(value)]));
  for (const key of ["fixtureUserCount", "sellerCount", "listingCount", "orderCount", "orderItemCount",
    "caseCount", "caseMessageCount", "claimCount", "paymentCount", "notificationCount", "outboxCount",
    "resolutionAuditCount", "systemAuditCount"]) {
    if (normalized[key] !== 0) throw new Error("Case refund application cleanup is incomplete");
  }
  if (normalized.processedWebhookCount !== 1 || normalized.canaryCount !== 1
    || !Number.isInteger(normalized.pinAuditCount) || normalized.pinAuditCount < 1) {
    throw new Error("Case refund retained evidence or canary drifted");
  }
  return Object.freeze(normalized);
}

export function buildEvidence(config, state, cleanup) {
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    phase: "order-payment-event-case-refund-production-proof",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    attemptCommit: config.attemptCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    attemptDeployedSourceCommit: config.attemptDeployedSourceCommit,
    ciRunId: config.mainCiRunId,
    attemptCiRunId: config.attemptMainCiRunId,
    deploymentId: config.deploymentId,
    attemptDeploymentId: config.attemptDeploymentId,
    sellerRefundPredecessorOperatorCommit: config.sellerProofOperatorCommit,
    sellerRefundPredecessorOperatorCiRunId: config.sellerProofOperatorCiRunId,
    sellerRefundPredecessorDeployedSourceCommit: config.sellerProofDeployedSourceCommit,
    sellerRefundPredecessorDeploymentId: config.sellerProofDeploymentId,
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
      resolutionClaimSha256: sha256(state.claimId),
      resolutionMessageSha256: sha256(state.resolutionMessageId),
      buyerNotificationSha256: sha256(state.buyerNotificationId),
      sellerNotificationSha256: sha256(state.sellerNotificationId),
      emailOutboxSha256: sha256(state.emailOutboxId),
      stockRestoredAndReactivated: true,
      caseResolvedByAuthenticatedStaff: true,
      emailDeliverySkippedByPreference: true,
      temporaryApplicationRowsRemoved: cleanup.applicationRowsRemoved,
      retainedProcessedWebhookLeases: cleanup.processedWebhookCount,
      retainedAdminPinAuditRows: cleanup.pinAuditCount,
      permanentOperationalCanaryRetained: cleanup.canaryCount === 1,
      operationalCanaryRoleRestored: cleanup.roleRestored === true,
    },
    normalAdminPinChallengeProven: true,
    rawAdminPinPersisted: false,
    authenticatedRouteReplayRejectedWithoutDuplicate: true,
    clerkSessionsRevoked: cleanup.clerkSessionsRevoked,
    rateLimitTelemetry: "bounded TTL entries retained",
    productionChangedByProof: true,
    databaseChangeAfterCleanup: "one processed Stripe test-mode charge.refunded replay lease retained",
    externalResidueAfterCleanup: "immutable Stripe test objects plus ordinary provider, security-audit and bounded-TTL rate-limit telemetry retained",
    providerConfigurationChanged: false,
    liveMoneyMoved: false,
    secretsRetained: false,
  });
}

export function assertEvidence(payload, config) {
  const hex = /^[a-f0-9]{64}$/;
  const hashes = [
    payload?.stripe?.connectedAccountSha256, payload?.stripe?.paymentIntentSha256,
    payload?.stripe?.chargeSha256, payload?.stripe?.transferSha256,
    payload?.stripe?.refundSha256, payload?.stripe?.reversalSha256,
    payload?.stripe?.signedEventSha256, payload?.database?.localPaymentEventSha256,
    payload?.database?.signedPaymentEventSha256, payload?.database?.resolutionClaimSha256,
    payload?.database?.resolutionMessageSha256, payload?.database?.buyerNotificationSha256,
    payload?.database?.sellerNotificationSha256, payload?.database?.emailOutboxSha256,
  ];
  if (payload?.phase !== "order-payment-event-case-refund-production-proof"
    || payload?.status !== "passed" || payload?.mode !== "test"
    || payload?.commit !== config.expectedCommit || payload?.attemptCommit !== config.attemptCommit
    || payload?.deployedSourceCommit !== config.deployedSourceCommit
    || payload?.attemptDeployedSourceCommit !== config.attemptDeployedSourceCommit
    || String(payload?.ciRunId) !== String(config.mainCiRunId)
    || String(payload?.attemptCiRunId) !== String(config.attemptMainCiRunId)
    || payload?.deploymentId !== config.deploymentId
    || payload?.attemptDeploymentId !== config.attemptDeploymentId
    || payload?.sellerRefundPredecessorOperatorCommit !== config.sellerProofOperatorCommit
    || String(payload?.sellerRefundPredecessorOperatorCiRunId) !== String(config.sellerProofOperatorCiRunId)
    || payload?.sellerRefundPredecessorDeployedSourceCommit !== config.sellerProofDeployedSourceCommit
    || payload?.sellerRefundPredecessorDeploymentId !== config.sellerProofDeploymentId
    || !hashes.every((value) => hex.test(value ?? ""))
    || payload?.stripe?.buyerRefundAmountCents !== REFUND_AMOUNT_CENTS
    || payload?.stripe?.transferReversalAmountCents !== TRANSFER_AMOUNT_CENTS
    || payload?.stripe?.exactSignedReplayProven !== true
    || payload?.stripe?.disposableConnectedAccountDeleted !== true
    || payload?.database?.stockRestoredAndReactivated !== true
    || payload?.database?.caseResolvedByAuthenticatedStaff !== true
    || payload?.database?.emailDeliverySkippedByPreference !== true
    || payload?.database?.temporaryApplicationRowsRemoved !== true
    || payload?.database?.retainedProcessedWebhookLeases !== 1
    || !Number.isInteger(payload?.database?.retainedAdminPinAuditRows)
    || payload.database.retainedAdminPinAuditRows < 1
    || payload?.database?.permanentOperationalCanaryRetained !== true
    || payload?.database?.operationalCanaryRoleRestored !== true
    || payload?.normalAdminPinChallengeProven !== true || payload?.rawAdminPinPersisted !== false
    || payload?.authenticatedRouteReplayRejectedWithoutDuplicate !== true
    || payload?.clerkSessionsRevoked !== true
    || payload?.rateLimitTelemetry !== "bounded TTL entries retained"
    || payload?.providerConfigurationChanged !== false || payload?.liveMoneyMoved !== false
    || payload?.secretsRetained !== false) {
    throw new Error("Case refund sanitized evidence drifted");
  }
  return Object.freeze(payload);
}

export function assertSellerRefundPredecessor(config) {
  assertPrivateRegularFile(config.sellerProofEvidencePath, "seller refund predecessor evidence");
  const bytes = readFileSync(config.sellerProofEvidencePath);
  if (sha256(bytes) !== config.sellerProofEvidenceSha256) {
    throw new Error("Case refund seller predecessor evidence checksum drifted");
  }
  return assertSellerRefundPredecessorEvidence(
    JSON.parse(bytes.toString("utf8")),
    {
      expectedCommit: config.sellerProofAttemptCommit,
      deployedSourceCommit: config.sellerProofDeployedSourceCommit,
      mainCiRunId: config.sellerProofAttemptCiRunId,
      deploymentId: config.sellerProofDeploymentId,
      operatorCommit: config.sellerProofOperatorCommit,
      operatorCiRunId: config.sellerProofOperatorCiRunId,
      signedProofCommit: config.sellerProofSignedCommit,
      signedProofCiRunId: config.sellerProofSignedCiRunId,
    },
  );
}

export function openHostedOnboarding(config = validateConfiguration(), dependencies = {}) {
  (dependencies.verifyExecutionBindings ?? verifyExecutionBindings)(config);
  assertSellerRefundPredecessor(config);
  const state = assertState(readPrivateJson(config.statePath, "Case refund restart state"), config);
  if (state.stage !== "account-created" || !state.stripeAccountId) {
    throw new Error("Case refund hosted onboarding requires account-created state");
  }
  const onboarding = assertOnboardingRecord(
    readPrivateJson(config.onboardingPath, "Case refund onboarding record"),
    config,
    state,
  );
  const openUrl = dependencies.openUrl ?? ((url) => spawnSync(
    "/usr/bin/open",
    [url],
    { env: childEnvironment(), stdio: "ignore" },
  ));
  const opened = openUrl(onboarding.url);
  if (opened?.error || opened?.status !== 0 || opened?.signal) {
    throw new Error("Case refund hosted-onboarding browser launch failed");
  }
  return Object.freeze({
    phase: "order-payment-event-case-refund-production-proof",
    status: "onboarding-opened",
    rawProviderIdsPersistedInOutput: false,
    secretsPersistedInOutput: false,
  });
}

export async function runCaseRefundProductionProof(config = validateConfiguration(), dependencies = {}) {
  (dependencies.verifyExecutionBindings ?? verifyExecutionBindings)(config);
  assertSellerRefundPredecessor(config);
  const localValues = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const ownerValues = loadPrivateEnvironment(OWNER_ENV_PATH, "migration-owner environment file");
  const database = parseDatabaseUrls(localValues, ownerValues);
  const stripeSecret = validateStripeSecret(localValues);
  const clerkSecret = required(localValues, "CLERK_SECRET_KEY");
  const owner = postgresClient(database.ownerDatabaseUrl, "grainline_ope_case_refund_owner");
  const runtime = postgresClient(database.runtimeDatabaseUrl, "grainline_ope_case_refund_runtime");
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION });
  const clerk = createClerkClient({ secretKey: clerkSecret });
  let state = existsSync(config.statePath)
    ? assertState(readPrivateJson(config.statePath, "Case refund restart state"), config)
    : null;
  let authContext = null;
  let primaryError = null;
  let ownerConnected = false;
  let runtimeConnected = false;
  try {
    await owner.connect();
    ownerConnected = true;
    await runtime.connect();
    runtimeConnected = true;
    await (dependencies.verifyDeployment ?? verifyDeployment)(config);
    await (dependencies.verifyDatabaseBoundary ?? verifyDatabaseBoundary)(owner, runtime);
    const canary = await selectCanary(clerk, owner, state);
    if (!state) {
      if (config.command === "restore-canary") {
        throw new Error("Case refund canary recovery has no restart state");
      }
      state = createInitialState(config, canary);
      writePrivateJson(config.statePath, state);
    }
    if (config.command === "restore-canary") {
      const sessionsRevoked = await revokeCanarySessions(clerk, state.staffClerkId);
      const roleRestored = await restoreCanaryRole(owner, state);
      return Object.freeze({
        phase: "order-payment-event-case-refund-production-proof",
        status: "canary-restored",
        sessionsRevoked,
        roleRestored,
        restartStatePreserved: true,
      });
    }

    const stripeOps = stripeDependencies(stripe, stripeSecret, config, state);
    const provider = await readProviderState(stripeOps);
    if (provider.stage !== 4 || provider.platform?.url !== PLATFORM_WEBHOOK_URL
      || provider.platform?.status !== "enabled") {
      throw new Error("Case refund proof requires the active stage-4 platform webhook");
    }

    if (state.stage === "reserved") {
      state = updateState(config, state, { stage: "account-create-pending" });
    }
    if (state.stage === "account-create-pending") {
      const created = await stripeOps.createAccount();
      const account = await waitFor(
        () => stripeOps.retrieveAccount(created.id),
        (candidate) => {
          try {
            assertConnectedAccount(candidate, config, state, { requireTransferActive: false });
            return true;
          } catch { return false; }
        },
        "Case refund connected account",
        40,
        1500,
      );
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
        let onboarding = existsSync(config.onboardingPath)
          ? assertOnboardingRecord(readPrivateJson(config.onboardingPath, "Case refund onboarding record"), config, state, false)
          : null;
        if (!onboarding || onboarding.expiresAt <= Math.floor(Date.now() / 1000)) {
          onboarding = writeOnboardingRecord(config, state, await stripeOps.createOnboardingLink(account.id));
        }
        assertOnboardingRecord(onboarding, config, state);
        return Object.freeze({
          phase: "order-payment-event-case-refund-production-proof",
          status: "onboarding-required",
          next: "ORDER_PAYMENT_CASE_REFUND_COMMAND=onboard ... node scripts/order-payment-event-case-refund-production-proof.mjs",
          accountCreated: true,
          rawProviderIdsPersistedInOutput: false,
          secretsPersistedInOutput: false,
        });
      }
      removeOnboardingRecord(config, state);
      state = updateState(config, state, { stage: "payment-create-pending" });
    }
    if (state.stage === "payment-create-pending") {
      assertConnectedAccount(await stripeOps.retrieveAccount(state.stripeAccountId), config, state);
      const identity = await createDestinationPayment(stripeOps, state.stripeAccountId);
      if ((await stripeOps.listRefunds(identity.chargeId)).length !== 0) {
        throw new Error("Case refund fresh payment already had refund activity");
      }
      state = updateState(config, state, { stage: "payment-created", ...identity });
    }
    if (state.stage === "payment-created") {
      state = updateState(config, state, { stage: "fixtures-create-pending" });
    }
    if (state.stage === "fixtures-create-pending") {
      const classification = classifyFixtureSnapshot(await readFixtureSnapshot(owner, state));
      if (classification === "absent") await (dependencies.createFixtures ?? createFixtures)(owner, state);
      if (classifyFixtureSnapshot(await readFixtureSnapshot(owner, state)) !== "complete") {
        throw new Error("Case refund fixture recovery did not converge");
      }
      if ((await stripeOps.listRefunds(state.chargeId)).length !== 0) {
        throw new Error("Case refund fixture payment acquired unexpected refund activity");
      }
      state = updateState(config, state, { stage: "fixtures-created" });
    }

    const getAuthContext = async () => {
      if (authContext) return authContext;
      let pin = await acquireAdminPinInput(dependencies.adminPinDependencies ?? {});
      const session = await createCanarySession(clerk, state.staffClerkId);
      await ensureTemporaryStaffRole(owner, state);
      try {
        const adminCookie = await verifyAdminPin(session.jwt, pin);
        authContext = Object.freeze({ ...session, adminCookie });
      } finally {
        pin = null;
        await restoreCanaryRole(owner, state);
      }
      return authContext;
    };
    const callAsTemporaryStaff = async (callback) => {
      const auth = await getAuthContext();
      await ensureTemporaryStaffRole(owner, state);
      try {
        return await callback(auth);
      } finally {
        await restoreCanaryRole(owner, state);
      }
    };

    if (state.stage === "fixtures-created") {
      await callAsTemporaryStaff(async (auth) => {
        const denied = await fetchCaseResolution(state.caseId, auth.jwt, auth.adminCookie, "https://example.invalid");
        if (denied.status !== 403 || denied.body?.error !== "Forbidden") {
          throw new Error("Case refund route did not reject cross-origin POST");
        }
      });
      state = updateState(config, state, { stage: "refund-route-pending" });
    }
    if (state.stage === "refund-route-pending") {
      const response = await callAsTemporaryStaff((auth) => fetchCaseResolution(
        state.caseId,
        auth.jwt,
        auth.adminCookie,
      ));
      const acceptedResponse = response.status === 200 && response.body?.ok === true
        && response.body?.caseId === state.caseId && response.body?.orderId === state.orderId
        && response.body?.resolution === "REFUND_FULL";
      const recoveredResponse = response.status === 409
        && response.body?.error === "Case or refund state changed. Refresh and try again.";
      if (!acceptedResponse && !recoveredResponse) {
        throw new Error("Case refund authenticated route response drifted");
      }
      const refunds = await waitFor(
        () => stripeOps.listRefunds(state.chargeId),
        (rows) => rows.length === 1 && /^re_[A-Za-z0-9_]+$/.test(String(rows[0]?.id ?? "")),
        "Case refund provider result",
        20,
        1000,
      );
      const refundId = refunds[0].id;
      const refund = await waitFor(
        () => stripeOps.retrieveRefund(refundId),
        (candidate) => {
          try {
            assertRefundProviderEvidence(candidate, { ...state, refundId });
            return candidate.status === "succeeded";
          } catch { return false; }
        },
        "Case refund transfer reversal",
        40,
        1000,
      );
      const providerEvidence = assertRefundProviderEvidence(refund, { ...state, refundId });
      state = updateState(config, state, { stage: "refund-returned", refundId, ...providerEvidence });
    }
    if (state.stage === "refund-returned") {
      const createdAfter = Math.floor(Date.parse(state.startedAt) / 1000) - 5;
      const events = await waitFor(
        () => stripeOps.listRefundEvents(createdAfter),
        (rows) => Boolean(findSingleRefundEvent(rows, state)),
        "Case refund signed event",
      );
      const signedEvent = findSingleRefundEvent(events, state);
      state = updateState(config, state, { signedEventId: signedEvent.id });
      const snapshot = await waitFor(
        () => readProofSnapshot(owner, state),
        (row) => {
          try { assertProofSnapshot(row, state); return true; } catch { return false; }
        },
        "Case refund signed confirmation",
      );
      const proven = assertProofSnapshot(snapshot, state);
      state = updateState(config, state, {
        stage: "signed-confirmed",
        localPaymentEventId: proven.localPaymentEventId,
        signedPaymentEventId: proven.signedPaymentEventId,
        claimId: proven.claimId,
        resolutionMessageId: proven.resolutionMessageId,
        buyerNotificationId: proven.buyerNotificationId,
        sellerNotificationId: proven.sellerNotificationId,
        emailOutboxId: proven.emailOutboxId,
      });
    }
    const delivered = await readProofSnapshot(owner, state);
    if (state.stage === "signed-confirmed") {
      const retry = await callAsTemporaryStaff((auth) => fetchCaseResolution(
        state.caseId,
        auth.jwt,
        auth.adminCookie,
      ));
      if (retry.status !== 409
        || retry.body?.error !== "Case or refund state changed. Refresh and try again.") {
        throw new Error("Case refund authenticated route replay did not fail closed");
      }
      assertReplayUnchanged(delivered, await readProofSnapshot(owner, state), state);
      state = updateState(config, state, { stage: "route-replay-proven" });
    }
    if (state.stage === "route-replay-proven") {
      state = updateState(config, state, { stage: "signed-replay-pending" });
    }
    if (state.stage === "signed-replay-pending") {
      await stripeOps.resendEvent(provider.platform.id, state.signedEventId);
      const replay = await waitFor(
        () => readProofSnapshot(owner, state),
        (row) => {
          try { assertReplayUnchanged(delivered, row, state); return true; } catch { return false; }
        },
        "Case refund exact signed replay",
        20,
        1000,
      );
      assertReplayUnchanged(delivered, replay, state);
      state = updateState(config, state, { stage: "signed-replayed" });
    }
    if (state.stage === "signed-replayed") {
      state = updateState(config, state, { stage: "cleanup-started" });
    }
    if (state.stage === "cleanup-started") {
      await revokeCanarySessions(clerk, state.staffClerkId);
      await restoreCanaryRole(owner, state);
      const before = await readCleanupSnapshot(owner, state);
      if (Number(before.fixtureUserCount) === 2) {
        await (dependencies.cleanupExactRows ?? cleanupExactRows)(owner, state);
      }
      assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
      if (!await deleteDisposableAccount(stripeOps, config, state)) {
        throw new Error("Case refund disposable account deletion failed");
      }
      removeOnboardingRecord(config, state);
      state = updateState(config, state, { stage: "cleaned" });
    }
    if (state.stage === "cleaned") {
      const sessionsRevoked = await revokeCanarySessions(clerk, state.staffClerkId);
      const roleRestored = await restoreCanaryRole(owner, state);
      const cleanupSnapshot = assertCleanupSnapshot(await readCleanupSnapshot(owner, state));
      if (!await deleteDisposableAccount(stripeOps, config, state)) {
        throw new Error("Case refund cleaned state did not retain deleted-account evidence");
      }
      const cleanup = {
        accountDeleted: true,
        applicationRowsRemoved: true,
        clerkSessionsRevoked: sessionsRevoked,
        roleRestored,
        processedWebhookCount: cleanupSnapshot.processedWebhookCount,
        pinAuditCount: cleanupSnapshot.pinAuditCount,
        canaryCount: cleanupSnapshot.canaryCount,
      };
      const evidence = assertEvidence(buildEvidence(config, state, cleanup), config);
      writePrivateJson(config.evidencePath, evidence);
      unlinkSync(config.statePath);
      return evidence;
    }
    throw new Error("Case refund proof reached an unsupported recovery stage");
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const safetyErrors = [];
    if (state && ownerConnected) {
      try { await revokeCanarySessions(clerk, state.staffClerkId); } catch (error) { safetyErrors.push(error); }
      try { await restoreCanaryRole(owner, state); } catch (error) { safetyErrors.push(error); }
    }
    const endings = await Promise.allSettled([
      ownerConnected ? owner.end() : Promise.resolve(),
      runtimeConnected ? runtime.end() : Promise.resolve(),
    ]);
    for (const result of endings) if (result.status === "rejected") safetyErrors.push(result.reason);
    if (safetyErrors.length > 0) {
      throw new AggregateError(
        primaryError ? [primaryError, ...safetyErrors] : safetyErrors,
        "Case refund proof safety cleanup failed",
      );
    }
  }
}

async function main() {
  try {
    const config = validateConfiguration();
    const result = config.command === "onboard"
      ? openHostedOnboarding(config)
      : await runCaseRefundProductionProof(config);
    process.stdout.write(`${JSON.stringify({
      phase: result.phase,
      status: result.status,
      ...(result.commit ? { commit: result.commit } : {}),
      ...(result.ciRunId ? { ciRunId: result.ciRunId } : {}),
      ...(result.deploymentId ? { deploymentId: result.deploymentId } : {}),
      ...(result.next ? { next: result.next } : {}),
      ...(Object.hasOwn(result, "restartStatePreserved")
        ? { restartStatePreserved: result.restartStatePreserved }
        : {}),
      ...(Object.hasOwn(result, "rawProviderIdsPersistedInOutput")
        ? { rawProviderIdsPersistedInOutput: result.rawProviderIdsPersistedInOutput }
        : {}),
      ...(Object.hasOwn(result, "secretsPersistedInOutput")
        ? { secretsPersistedInOutput: result.secretsPersistedInOutput }
        : {}),
    })}\n`);
  } catch (error) {
    process.stderr.write(`OrderPaymentEvent Case refund production proof failed closed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
