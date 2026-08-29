#!/usr/bin/env node
// Restart-safe, Stripe-test-mode-only proof for the signed OrderPaymentEvent
// refund and dispute families. Review/merge does not authorize execution.
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
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";
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

export const CONFIRMATION = "reviewed-order-payment-signed-production-proof";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PLATFORM_WEBHOOK_URL = `${PRODUCTION_ORIGIN}/api/stripe/webhook`;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const REFUND_AMOUNT_CENTS = 500;
export const DISPUTE_AMOUNT_CENTS = 500;
export const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_CLI_VERSION = "1.39.0";
const VERCEL_CLI_VERSION = "58.9.0";
const PRODUCTION_DATABASE_NAME = "neondb";
const MAX_PRIVATE_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const STRIPE_OBJECT_PATTERN = /\b(?:ch|dp|evt|pi|re|we)_[A-Za-z0-9_]+\b/g;
const DATABASE_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CANARY_ID_PATTERN = /\bope(?:b|su|sp|l|o|i)_[a-f0-9]{32}(?:_(?:refund|dispute))?\b/g;
const CANARY_CLERK_PATTERN = /\border_payment_proof_(?:buyer|seller)_[a-f0-9]{32}\b/g;
const CANARY_EMAIL_PATTERN = /\border-payment-proof-(?:buyer|seller)-[a-f0-9]{32}@example\.invalid\b/g;
const EXPECTED_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});
const STAGES = Object.freeze([
  "reserved",
  "refund-charge-created",
  "refund-fixture-created",
  "refund-created",
  "refund-event-ready",
  "refund-delivered",
  "refund-replay-pending",
  "refund-replayed",
  "dispute-charge-created",
  "all-fixtures-created",
  "dispute-event-ready",
  "dispute-delivery-resend-pending",
  "dispute-delivered",
  "dispute-replay-pending",
  "dispute-replayed",
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
    .replace(CANARY_ID_PATTERN, "[redacted-canary-id]")
    .replace(CANARY_CLERK_PATTERN, "[redacted-canary-clerk-id]")
    .replace(CANARY_EMAIL_PATTERN, "[redacted-canary-email]");
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
  if (stat.size > MAX_PRIVATE_BYTES) throw new Error(`${label} exceeded its size bound`);
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
  if (existsSync(nextPath)) throw new Error("stale signed proof state update exists");
  writePrivateJson(nextPath, value);
  renameSync(nextPath, filePath);
  chmodSync(filePath, 0o600);
}

export function assertPendingStateTransition(currentValue, nextValue, config) {
  const current = assertState(currentValue, config);
  const next = assertState(nextValue, config);
  if (STAGES.indexOf(next.stage) !== STAGES.indexOf(current.stage) + 1) {
    throw new Error("signed payment pending state is not the exact next stage");
  }
  for (const [key, value] of Object.entries(current)) {
    if (key === "stage") continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(value)) {
      throw new Error("signed payment pending state changed sealed prior data");
    }
  }
  return next;
}

function readRecoveryState(config) {
  const nextPath = `${config.statePath}.next`;
  if (!existsSync(config.statePath)) {
    if (existsSync(nextPath)) throw new Error("signed payment recovery state update is orphaned");
    return null;
  }
  const current = readPrivateJson(config.statePath, "signed payment recovery state");
  if (!existsSync(nextPath)) return assertState(current, config);
  const next = assertPendingStateTransition(
    current,
    readPrivateJson(nextPath, "signed payment pending recovery state"),
    config,
  );
  renameSync(nextPath, config.statePath);
  chmodSync(config.statePath, 0o600);
  assertPrivateRegularFile(config.statePath, "signed payment recovered state");
  return next;
}

function readPrivateEnvironment(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  return parseDotenv(readFileSync(filePath, "utf8"));
}

export function validateConfiguration(env = process.env) {
  if (env.ORDER_PAYMENT_SIGNED_PROOF_CONFIRM !== CONFIRMATION) {
    throw new Error("signed payment proof confirmation is invalid");
  }
  const expectedCommit = required(env, "ORDER_PAYMENT_SIGNED_PROOF_EXPECTED_COMMIT");
  const preparationCommit = env.ORDER_PAYMENT_SIGNED_PROOF_PREPARATION_COMMIT
    ? required(env, "ORDER_PAYMENT_SIGNED_PROOF_PREPARATION_COMMIT")
    : expectedCommit;
  const deployedSourceCommit = required(
    env,
    "ORDER_PAYMENT_SIGNED_PROOF_DEPLOYED_SOURCE_COMMIT",
  );
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_SIGNED_PROOF_CI_RUN_ID");
  const preparationCiRunId = env.ORDER_PAYMENT_SIGNED_PROOF_PREPARATION_CI_RUN_ID
    ? positiveInteger(env, "ORDER_PAYMENT_SIGNED_PROOF_PREPARATION_CI_RUN_ID")
    : mainCiRunId;
  const deploymentId = required(env, "ORDER_PAYMENT_SIGNED_PROOF_DEPLOYMENT_ID");
  if (!COMMIT_PATTERN.test(expectedCommit)) throw new Error("expected commit is invalid");
  if (!COMMIT_PATTERN.test(preparationCommit)) {
    throw new Error("preparation commit is invalid");
  }
  if (!COMMIT_PATTERN.test(deployedSourceCommit)) {
    throw new Error("deployed source commit is invalid");
  }
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) throw new Error("deployment ID is invalid");
  const evidencePath = path.resolve(required(env, "ORDER_PAYMENT_SIGNED_PROOF_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath)
      !== `order-payment-event-signed-production-proof-${expectedCommit}.json`
  ) throw new Error("signed payment proof evidence path is not fresh and exact");
  const statePath = path.join(
    EVIDENCE_DIRECTORY,
    `order-payment-event-signed-production-proof-state-${preparationCommit}.json`,
  );
  const vercelProjectDirectory = path.resolve(
    required(env, "ORDER_PAYMENT_SIGNED_PROOF_VERCEL_PROJECT_DIRECTORY"),
  );
  const stripeCliPath = path.resolve(
    env.ORDER_PAYMENT_SIGNED_PROOF_STRIPE_CLI_PATH || "/opt/homebrew/bin/stripe",
  );
  return Object.freeze({
    deployedSourceCommit,
    deploymentId,
    evidencePath,
    expectedCommit,
    mainCiRunId,
    preparationCiRunId,
    preparationCommit,
    statePath,
    stripeCliPath,
    vercelProjectDirectory,
  });
}

export function disposableDatabaseIdentity(attemptId) {
  if (!UUID_V4_PATTERN.test(String(attemptId ?? ""))) {
    throw new Error("signed payment proof attempt identity is invalid");
  }
  const suffix = attemptId.replaceAll("-", "");
  return Object.freeze({
    buyerId: `opeb_${suffix}`,
    buyerClerkId: `order_payment_proof_buyer_${suffix}`,
    buyerEmail: `order-payment-proof-buyer-${suffix}@example.invalid`,
    sellerUserId: `opesu_${suffix}`,
    sellerClerkId: `order_payment_proof_seller_${suffix}`,
    sellerEmail: `order-payment-proof-seller-${suffix}@example.invalid`,
    sellerProfileId: `opesp_${suffix}`,
    refundListingId: `opel_${suffix}_refund`,
    disputeListingId: `opel_${suffix}_dispute`,
    refundOrderId: `opeo_${suffix}_refund`,
    disputeOrderId: `opeo_${suffix}_dispute`,
    refundOrderItemId: `opei_${suffix}_refund`,
    disputeOrderItemId: `opei_${suffix}_dispute`,
  });
}

function exactString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

export function assertState(value, config) {
  const identityKeys = Object.keys(disposableDatabaseIdentity(value?.attemptId));
  const allowedKeys = new Set([
    "phase", "stage", "commit", "deployedSourceCommit", "ciRunId", "deploymentId",
    "attemptId", "startedSeconds", ...identityKeys,
    "refundPaymentIntentId", "refundChargeId", "refundId", "refundEventId",
    "refundPaymentEventId", "disputePaymentIntentId", "disputeChargeId",
    "disputeId", "disputeEventId", "disputePaymentEventId", "caseId",
    "notificationId",
  ]);
  if (
    value?.phase !== "order-payment-event-signed-production-proof-state"
    || !STAGES.includes(value?.stage)
    || value?.commit !== config.preparationCommit
    || value?.deployedSourceCommit !== config.deployedSourceCommit
    || Number(value?.ciRunId) !== config.preparationCiRunId
    || value?.deploymentId !== config.deploymentId
    || !UUID_V4_PATTERN.test(String(value?.attemptId ?? ""))
    || !Number.isSafeInteger(value?.startedSeconds)
    || value.startedSeconds <= 0
  ) throw new Error("signed payment proof recovery state drifted");
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("signed payment proof recovery state contains an unknown field");
  }
  const identity = disposableDatabaseIdentity(value.attemptId);
  for (const [key, expected] of Object.entries(identity)) {
    if (value[key] !== expected) throw new Error("signed payment fixture identity drifted");
  }
  const requiredByStage = {
    "refund-charge-created": ["refundPaymentIntentId", "refundChargeId"],
    "refund-fixture-created": ["refundPaymentIntentId", "refundChargeId"],
    "refund-created": ["refundPaymentIntentId", "refundChargeId", "refundId"],
    "refund-event-ready": ["refundPaymentIntentId", "refundChargeId", "refundId", "refundEventId"],
    "refund-delivered": ["refundPaymentEventId"],
    "refund-replay-pending": ["refundPaymentEventId"],
    "refund-replayed": ["refundPaymentEventId"],
    "dispute-charge-created": ["disputePaymentIntentId", "disputeChargeId"],
    "all-fixtures-created": ["disputePaymentIntentId", "disputeChargeId"],
    "dispute-event-ready": ["disputeId", "disputeEventId"],
    "dispute-delivery-resend-pending": ["disputeId", "disputeEventId"],
    "dispute-delivered": ["disputePaymentEventId", "caseId", "notificationId"],
    "dispute-replay-pending": ["disputePaymentEventId", "caseId", "notificationId"],
    "dispute-replayed": ["disputePaymentEventId", "caseId", "notificationId"],
    "cleanup-started": ["disputePaymentEventId", "caseId", "notificationId"],
    cleaned: ["disputePaymentEventId", "caseId", "notificationId"],
  };
  const index = STAGES.indexOf(value.stage);
  for (let position = 1; position <= index; position += 1) {
    for (const key of requiredByStage[STAGES[position]] ?? []) exactString(value[key], `state ${key}`);
  }
  return Object.freeze({ ...value });
}

function stateWithIdentity(config) {
  const attemptId = randomUUID();
  return assertState({
    phase: "order-payment-event-signed-production-proof-state",
    stage: "reserved",
    commit: config.preparationCommit,
    deployedSourceCommit: config.deployedSourceCommit,
    ciRunId: config.preparationCiRunId,
    deploymentId: config.deploymentId,
    attemptId,
    startedSeconds: Math.floor(Date.now() / 1000) - 5,
    ...disposableDatabaseIdentity(attemptId),
  }, config);
}

function updateState(config, state, update) {
  const next = assertState({ ...state, ...update }, config);
  replacePrivateJson(config.statePath, next);
  return next;
}

function resultCardinality(result) {
  return Number.isSafeInteger(result?.rowCount) ? result.rowCount : result?.rows?.length;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function createDisposableDatabaseFixtures(owner, state, family) {
  if (!new Set(["refund", "dispute"]).has(family)) throw new Error("fixture family is invalid");
  const isRefund = family === "refund";
  const listingId = isRefund ? state.refundListingId : state.disputeListingId;
  const orderId = isRefund ? state.refundOrderId : state.disputeOrderId;
  const orderItemId = isRefund ? state.refundOrderItemId : state.disputeOrderItemId;
  const paymentIntentId = isRefund ? state.refundPaymentIntentId : state.disputePaymentIntentId;
  const chargeId = isRefund ? state.refundChargeId : state.disputeChargeId;
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const candidates = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User"
          WHERE id IN ($1, $4) OR "clerkId" IN ($2, $5) OR email IN ($3, $6)) AS users,
        (SELECT count(*)::integer FROM public."SellerProfile"
          WHERE id = $7 OR "userId" = $4) AS sellers,
        (SELECT count(*)::integer FROM public."Listing" WHERE id = $8) AS listings,
        (SELECT count(*)::integer FROM public."Order"
          WHERE id = $9 OR "stripePaymentIntentId" = $10 OR "stripeChargeId" = $11) AS orders,
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id = $12) AS items
    `, [
      state.buyerId, state.buyerClerkId, state.buyerEmail,
      state.sellerUserId, state.sellerClerkId, state.sellerEmail,
      state.sellerProfileId, listingId, orderId, paymentIntentId, chargeId, orderItemId,
    ]);
    const row = candidates.rows[0];
    const sharedExact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User"
          WHERE id = $1 AND "clerkId" = $2 AND email = $3 AND role = 'USER'
            AND "deletedAt" IS NULL AND banned = false) AS buyer,
        (SELECT count(*)::integer FROM public."User"
          WHERE id = $4 AND "clerkId" = $5 AND email = $6 AND role = 'USER'
            AND "deletedAt" IS NULL AND banned = false) AS seller_user,
        (SELECT count(*)::integer FROM public."SellerProfile"
          WHERE id = $7 AND "userId" = $4
            AND "displayName" = 'Grainline Payment Proof'
            AND "displayNameNormalized" = 'grainline payment proof'
            AND "vacationMode" = true) AS seller
    `, [
      state.buyerId, state.buyerClerkId, state.buyerEmail,
      state.sellerUserId, state.sellerClerkId, state.sellerEmail,
      state.sellerProfileId,
    ]);
    const sharedAbsent = Number(row?.users) === 0 && Number(row?.sellers) === 0;
    const exactShared = Object.values(sharedExact.rows[0] ?? {}).every((count) => Number(count) === 1);
    if (sharedAbsent) {
      await owner.query(`
        INSERT INTO public."User" (id, "clerkId", email, name, role, "updatedAt")
        VALUES
          ($1, $2, $3, 'Grainline Payment Proof Buyer', 'USER', CURRENT_TIMESTAMP),
          ($4, $5, $6, 'Grainline Payment Proof Seller', 'USER', CURRENT_TIMESTAMP)
      `, [
        state.buyerId, state.buyerClerkId, state.buyerEmail,
        state.sellerUserId, state.sellerClerkId, state.sellerEmail,
      ]);
      await owner.query(`
        INSERT INTO public."SellerProfile" (
          id, "userId", "displayName", "displayNameNormalized", "vacationMode", "updatedAt"
        ) VALUES ($1, $2, 'Grainline Payment Proof', 'grainline payment proof', true, CURRENT_TIMESTAMP)
      `, [state.sellerProfileId, state.sellerUserId]);
    } else if (!exactShared) {
      throw new Error("signed payment shared fixture identity collided");
    }
    const familyAbsent = Number(row?.listings) === 0 && Number(row?.orders) === 0 && Number(row?.items) === 0;
    if (familyAbsent) {
      await owner.query(`
        INSERT INTO public."Listing" (
          id, "sellerId", title, description, "priceCents", currency, status,
          "listingType", "isPrivate", "reservedForUserId", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 'Disposable private signed payment production proof fixture',
          500, 'usd', 'ACTIVE', 'MADE_TO_ORDER', true, $4,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [listingId, state.sellerProfileId, `payment-proof-${family}`, state.buyerId]);
      await owner.query(`
        INSERT INTO public."Order" (
          id, "buyerId", "sellerProfileId", "stripePaymentIntentId", "stripeChargeId",
          currency, "itemsSubtotalCents", "paidAt"
        ) VALUES ($1, $2, $3, $4, $5, 'usd', 500, CURRENT_TIMESTAMP)
      `, [orderId, state.buyerId, state.sellerProfileId, paymentIntentId, chargeId]);
      await owner.query(`
        INSERT INTO public."OrderItem" (
          id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents", "listingSnapshot"
        ) VALUES ($1, $2, $3, $4, 1, 500, $5::jsonb)
      `, [
        orderItemId,
        orderId,
        listingId,
        state.sellerProfileId,
        JSON.stringify({ title: `payment-proof-${family}`, capturedAt: new Date().toISOString() }),
      ]);
    } else {
      const exactFamily = await owner.query(`
        SELECT
          (SELECT count(*)::integer FROM public."Listing"
            WHERE id = $1 AND "sellerId" = $2 AND title = $8
              AND description = 'Disposable private signed payment production proof fixture'
              AND "priceCents" = 500 AND currency = 'usd' AND status = 'ACTIVE'
              AND "listingType" = 'MADE_TO_ORDER' AND "isPrivate" = true
              AND "reservedForUserId" = $3) AS listing,
          (SELECT count(*)::integer FROM public."Order"
            WHERE id = $4 AND "buyerId" = $3 AND "sellerProfileId" = $2
              AND "stripePaymentIntentId" = $5 AND "stripeChargeId" = $6
              AND currency = 'usd' AND "itemsSubtotalCents" = 500
              AND "paidAt" IS NOT NULL) AS order_row,
          (SELECT count(*)::integer FROM public."OrderItem"
            WHERE id = $7 AND "orderId" = $4 AND "listingId" = $1
              AND "sellerProfileId" = $2 AND quantity = 1 AND "priceCents" = 500) AS item
      `, [
        listingId, state.sellerProfileId, state.buyerId, orderId,
        paymentIntentId, chargeId, orderItemId, `payment-proof-${family}`,
      ]);
      if (!Object.values(exactFamily.rows[0] ?? {}).every((count) => Number(count) === 1)) {
        throw new Error("signed payment family fixture identity collided");
      }
    }
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readDeliverySnapshot(owner, state, refundObjectId = state.refundId) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id IN ($1, $2)) AS "userCount",
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $3) AS "sellerCount",
        (SELECT count(*)::integer FROM public."Listing" WHERE id IN ($4, $5)) AS "listingCount",
        (SELECT count(*)::integer FROM public."Order" WHERE id IN ($6, $7)) AS "orderCount",
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id IN ($8, $9)) AS "itemCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent"
          WHERE id = $10 AND type = 'charge.refunded' AND "sourceObjectId" = $11) AS "refundWebhookCount",
        (SELECT "processedAt" IS NOT NULL FROM public."StripeWebhookEvent" WHERE id = $10) AS "refundProcessed",
        (SELECT "lastError" IS NULL FROM public."StripeWebhookEvent" WHERE id = $10) AS "refundErrorClear",
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id = $10) AS "refundGeneration",
        (SELECT extract(epoch FROM "updatedAt" AT TIME ZONE 'UTC')::text
          FROM public."StripeWebhookEvent" WHERE id = $10) AS "refundWebhookEpoch",
        (SELECT count(*)::integer FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = $10 AND "orderId" = $6 AND "eventType" = 'REFUND'
            AND "stripeObjectType" = 'refund' AND "stripeObjectId" = $12) AS "refundPaymentCount",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $10) AS "refundPaymentEventId",
        (SELECT reason FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $10) AS "refundReason",
        (SELECT metadata->>'latestRefundId'
          FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $10) AS "refundLatestRefundId",
        (SELECT metadata->>'localRefundEvidenceId'
          FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $10) AS "refundEvidenceId",
        (SELECT metadata->>'localRefundEvidenceAction'
          FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $10) AS "refundEvidenceAction",
        (SELECT count(*)::integer FROM public."SystemAuditLog"
          WHERE "actorId" = $10 AND action = 'STRIPE_REFUND_RECORDED'
            AND "targetType" = 'ORDER' AND "targetId" = $6) AS "refundAuditCount",
        (SELECT "sellerRefundId" FROM public."Order" WHERE id = $6) AS "orderRefundId",
        (SELECT "sellerRefundAmountCents" FROM public."Order" WHERE id = $6) AS "orderRefundAmount",
        (SELECT "reviewNeeded" FROM public."Order" WHERE id = $6) AS "refundReviewNeeded",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent"
          WHERE id = $13 AND type = 'charge.dispute.created' AND "sourceObjectId" = $14) AS "disputeWebhookCount",
        (SELECT "processedAt" IS NOT NULL FROM public."StripeWebhookEvent" WHERE id = $13) AS "disputeProcessed",
        (SELECT "lastError" IS NULL FROM public."StripeWebhookEvent" WHERE id = $13) AS "disputeErrorClear",
        (SELECT "claimGeneration"::text FROM public."StripeWebhookEvent" WHERE id = $13) AS "disputeGeneration",
        (SELECT extract(epoch FROM "updatedAt" AT TIME ZONE 'UTC')::text
          FROM public."StripeWebhookEvent" WHERE id = $13) AS "disputeWebhookEpoch",
        (SELECT count(*)::integer FROM public."OrderPaymentEvent"
          WHERE "stripeEventId" = $13 AND "orderId" = $7 AND "eventType" = 'DISPUTE'
            AND "stripeObjectType" = 'dispute' AND "stripeObjectId" = $14) AS "disputePaymentCount",
        (SELECT id FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $13) AS "disputePaymentEventId",
        (SELECT count(*)::integer FROM public."CaseStripeDisputeApplication" AS application
          JOIN public."OrderPaymentEvent" AS payment ON payment.id = application."paymentEventId"
          WHERE payment."stripeEventId" = $13 AND application."orderId" = $7
            AND application.action = 'create') AS "caseApplicationCount",
        (SELECT application."caseId" FROM public."CaseStripeDisputeApplication" AS application
          JOIN public."OrderPaymentEvent" AS payment ON payment.id = application."paymentEventId"
          WHERE payment."stripeEventId" = $13) AS "caseId",
        (SELECT count(*)::integer FROM public."Case" AS case_row
          JOIN public."OrderPaymentEvent" AS payment ON payment.id = case_row."openedByPaymentEventId"
          WHERE payment."stripeEventId" = $13 AND case_row."orderId" = $7
            AND case_row."buyerId" = $1 AND case_row."sellerId" = $2
            AND case_row.status = 'UNDER_REVIEW') AS "caseCount",
        (SELECT count(*)::integer FROM public."Notification"
          WHERE "userId" = $2 AND type = 'PAYMENT_DISPUTE'
            AND "sourceType" = 'order_payment' AND "sourceId" = $13
            AND "relatedUserId" = $1) AS "notificationCount",
        (SELECT id FROM public."Notification"
          WHERE "userId" = $2 AND type = 'PAYMENT_DISPUTE'
            AND "sourceType" = 'order_payment' AND "sourceId" = $13
            AND "relatedUserId" = $1) AS "notificationId",
        (SELECT count(*)::integer FROM public."SystemAuditLog"
          WHERE "actorId" = $13 AND action = 'STRIPE_DISPUTE_RECORDED'
            AND "targetType" = 'ORDER' AND "targetId" = $7) AS "disputeAuditCount",
        (SELECT count(*)::integer FROM public."SystemAuditLog" AS audit
          JOIN public."Case" AS case_row ON case_row.id = audit."targetId"
          WHERE audit."actorId" = $13 AND audit.action = 'CASE_STRIPE_DISPUTE_APPLIED'
            AND audit."targetType" = 'CASE' AND case_row."orderId" = $7) AS "caseAuditCount",
        (SELECT "reviewNeeded" FROM public."Order" WHERE id = $7) AS "disputeReviewNeeded"
    `, [
      state.buyerId,
      state.sellerUserId,
      state.sellerProfileId,
      state.refundListingId,
      state.disputeListingId,
      state.refundOrderId,
      state.disputeOrderId,
      state.refundOrderItemId,
      state.disputeOrderItemId,
      state.refundEventId ?? null,
      state.refundChargeId ?? null,
      refundObjectId ?? null,
      state.disputeEventId ?? null,
      state.disputeId ?? null,
    ]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export function assertDeliverySnapshot(snapshot, expected = {}) {
  const expectedRefundObjectId = exactString(
    expected.refundObjectId,
    "expected signed refund object",
  );
  if (!new Set(["external_event", "provider_refund"]).has(expected.refundRepresentation)) {
    throw new Error("expected signed refund representation is invalid");
  }
  const expectedLatestRefundId = expected.refundRepresentation === "provider_refund"
    ? expectedRefundObjectId
    : null;
  const normalized = {
    userCount: Number(snapshot?.userCount),
    sellerCount: Number(snapshot?.sellerCount),
    listingCount: Number(snapshot?.listingCount),
    orderCount: Number(snapshot?.orderCount),
    itemCount: Number(snapshot?.itemCount),
    refundWebhookCount: Number(snapshot?.refundWebhookCount),
    refundProcessed: snapshot?.refundProcessed,
    refundErrorClear: snapshot?.refundErrorClear,
    refundGeneration: exactString(snapshot?.refundGeneration, "refund generation"),
    refundWebhookEpoch: exactString(snapshot?.refundWebhookEpoch, "refund webhook epoch"),
    refundPaymentCount: Number(snapshot?.refundPaymentCount),
    refundPaymentEventId: exactString(snapshot?.refundPaymentEventId, "refund payment event"),
    refundReason: snapshot?.refundReason ?? null,
    refundLatestRefundId: snapshot?.refundLatestRefundId ?? null,
    refundEvidenceId: snapshot?.refundEvidenceId ?? null,
    refundEvidenceAction: snapshot?.refundEvidenceAction ?? null,
    refundAuditCount: Number(snapshot?.refundAuditCount),
    orderRefundId: exactString(snapshot?.orderRefundId, "Order refund id"),
    orderRefundAmount: Number(snapshot?.orderRefundAmount),
    refundReviewNeeded: snapshot?.refundReviewNeeded,
    disputeWebhookCount: Number(snapshot?.disputeWebhookCount),
    disputeProcessed: snapshot?.disputeProcessed,
    disputeErrorClear: snapshot?.disputeErrorClear,
    disputeGeneration: exactString(snapshot?.disputeGeneration, "dispute generation"),
    disputeWebhookEpoch: exactString(snapshot?.disputeWebhookEpoch, "dispute webhook epoch"),
    disputePaymentCount: Number(snapshot?.disputePaymentCount),
    disputePaymentEventId: exactString(snapshot?.disputePaymentEventId, "dispute payment event"),
    caseApplicationCount: Number(snapshot?.caseApplicationCount),
    caseId: exactString(snapshot?.caseId, "Case id"),
    caseCount: Number(snapshot?.caseCount),
    notificationCount: Number(snapshot?.notificationCount),
    notificationId: exactString(snapshot?.notificationId, "notification id"),
    disputeAuditCount: Number(snapshot?.disputeAuditCount),
    caseAuditCount: Number(snapshot?.caseAuditCount),
    disputeReviewNeeded: snapshot?.disputeReviewNeeded,
  };
  if (
    normalized.userCount !== 2
    || normalized.sellerCount !== 1
    || normalized.listingCount !== 2
    || normalized.orderCount !== 2
    || normalized.itemCount !== 2
    || normalized.refundWebhookCount !== 1
    || normalized.refundProcessed !== true
    || normalized.refundErrorClear !== true
    || !/^[1-9][0-9]*$/.test(normalized.refundGeneration)
    || normalized.refundPaymentCount !== 1
    || normalized.refundReason !== "external_refund"
    || normalized.refundLatestRefundId !== expectedLatestRefundId
    || normalized.refundEvidenceId !== null
    || normalized.refundEvidenceAction !== null
    || normalized.refundAuditCount !== 1
    || normalized.orderRefundId !== expectedRefundObjectId
    || normalized.orderRefundAmount !== REFUND_AMOUNT_CENTS
    || normalized.refundReviewNeeded !== true
    || normalized.disputeWebhookCount !== 1
    || normalized.disputeProcessed !== true
    || normalized.disputeErrorClear !== true
    || !/^[1-9][0-9]*$/.test(normalized.disputeGeneration)
    || normalized.disputePaymentCount !== 1
    || normalized.caseApplicationCount !== 1
    || normalized.caseCount !== 1
    || normalized.notificationCount !== 1
    || normalized.disputeAuditCount !== 1
    || normalized.caseAuditCount !== 1
    || normalized.disputeReviewNeeded !== true
    || (expected.refundPaymentEventId
      && normalized.refundPaymentEventId !== expected.refundPaymentEventId)
    || (expected.disputePaymentEventId
      && normalized.disputePaymentEventId !== expected.disputePaymentEventId)
    || (expected.caseId && normalized.caseId !== expected.caseId)
    || (expected.notificationId && normalized.notificationId !== expected.notificationId)
  ) throw new Error("signed payment delivery did not reach the exact reviewed state");
  return Object.freeze(normalized);
}

export function assertReplayUnchanged(before, after, expected) {
  const first = assertDeliverySnapshot(before, expected);
  const replay = assertDeliverySnapshot(after, {
    ...expected,
    refundPaymentEventId: first.refundPaymentEventId,
    disputePaymentEventId: first.disputePaymentEventId,
    caseId: first.caseId,
    notificationId: first.notificationId,
  });
  for (const key of [
    "refundGeneration",
    "refundWebhookEpoch",
    "refundPaymentEventId",
    "disputeGeneration",
    "disputeWebhookEpoch",
    "disputePaymentEventId",
    "caseId",
    "notificationId",
  ]) {
    if (first[key] !== replay[key]) throw new Error(`exact signed retry changed ${key}`);
  }
  return Object.freeze(replay);
}

async function assertNoForeignKeyDependents(client, relation, id) {
  const constraints = await client.query(`
    SELECT
      child_namespace.nspname AS "schemaName",
      child.relname AS "tableName",
      pg_catalog.array_agg(child_attribute.attname::text ORDER BY child_key_row.ordinality) AS "childColumns",
      pg_catalog.array_agg(parent_attribute.attname::text ORDER BY child_key_row.ordinality) AS "parentColumns"
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
      WITH ORDINALITY AS child_key_row(child_key, ordinality) ON true
    JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
      WITH ORDINALITY AS parent_key_row(parent_key, ordinality)
      ON parent_key_row.ordinality = child_key_row.ordinality
    JOIN pg_catalog.pg_attribute AS child_attribute
      ON child_attribute.attrelid = constraint_row.conrelid
     AND child_attribute.attnum = child_key_row.child_key
    JOIN pg_catalog.pg_attribute AS parent_attribute
      ON parent_attribute.attrelid = constraint_row.confrelid
     AND parent_attribute.attnum = parent_key_row.parent_key
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = $1::pg_catalog.regclass
    GROUP BY child_namespace.nspname, child.relname, constraint_row.oid
    ORDER BY child_namespace.nspname, child.relname, constraint_row.oid
  `, [relation]);
  for (const constraint of constraints.rows) {
    if (
      !Array.isArray(constraint.childColumns)
      || !Array.isArray(constraint.parentColumns)
      || constraint.childColumns.length === 0
      || constraint.childColumns.length !== constraint.parentColumns.length
    ) throw new Error("signed payment cleanup foreign key shape drifted");
    const child = `${quoteIdentifier(constraint.schemaName)}.${quoteIdentifier(constraint.tableName)}`;
    const parent = relation;
    const join = constraint.childColumns.map((column, index) => (
      `child.${quoteIdentifier(column)} IS NOT DISTINCT FROM parent.${quoteIdentifier(constraint.parentColumns[index])}`
    )).join(" AND ");
    const dependent = await client.query(`
      SELECT count(*)::integer AS count
        FROM ${child} AS child
        JOIN ${parent} AS parent ON ${join}
       WHERE parent.id = $1
    `, [id]);
    if (dependent.rows[0]?.count !== 0) {
      throw new Error("signed payment cleanup found an unexpected dependent row");
    }
  }
}

export async function cleanupExactRows(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const exact = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User"
          WHERE id = $8 AND "clerkId" = $20 AND email = $21
            AND name = 'Grainline Payment Proof Buyer' AND role = 'USER'
            AND "deletedAt" IS NULL AND banned = false) AS buyer_user,
        (SELECT count(*)::integer FROM public."User"
          WHERE id = $9 AND "clerkId" = $22 AND email = $23
            AND name = 'Grainline Payment Proof Seller' AND role = 'USER'
            AND "deletedAt" IS NULL AND banned = false) AS seller_user,
        (SELECT count(*)::integer FROM public."SellerProfile"
          WHERE id = $11 AND "userId" = $9
            AND "displayName" = 'Grainline Payment Proof'
            AND "displayNameNormalized" = 'grainline payment proof'
            AND "vacationMode" = true) AS seller,
        (SELECT count(*)::integer FROM public."Listing"
          WHERE id = $12 AND "sellerId" = $11 AND title = 'payment-proof-refund'
            AND "priceCents" = 500 AND currency = 'usd' AND status = 'ACTIVE'
            AND "listingType" = 'MADE_TO_ORDER' AND "isPrivate" = true
            AND "reservedForUserId" = $8) AS refund_listing,
        (SELECT count(*)::integer FROM public."Listing"
          WHERE id = $13 AND "sellerId" = $11 AND title = 'payment-proof-dispute'
            AND "priceCents" = 500 AND currency = 'usd' AND status = 'ACTIVE'
            AND "listingType" = 'MADE_TO_ORDER' AND "isPrivate" = true
            AND "reservedForUserId" = $8) AS dispute_listing,
        (SELECT count(*)::integer FROM public."Order"
          WHERE id = $3 AND "buyerId" = $8 AND "sellerProfileId" = $11
            AND "stripePaymentIntentId" = $16 AND "stripeChargeId" = $17
            AND currency = 'usd' AND "itemsSubtotalCents" = 500
            AND "paidAt" IS NOT NULL) AS refund_order,
        (SELECT count(*)::integer FROM public."Order"
          WHERE id = $6 AND "buyerId" = $8 AND "sellerProfileId" = $11
            AND "stripePaymentIntentId" = $18 AND "stripeChargeId" = $19
            AND currency = 'usd' AND "itemsSubtotalCents" = 500
            AND "paidAt" IS NOT NULL) AS dispute_order,
        (SELECT count(*)::integer FROM public."OrderItem"
          WHERE id = $14 AND "orderId" = $3 AND "listingId" = $12
            AND "sellerProfileId" = $11 AND quantity = 1 AND "priceCents" = 500) AS refund_item,
        (SELECT count(*)::integer FROM public."OrderItem"
          WHERE id = $15 AND "orderId" = $6 AND "listingId" = $13
            AND "sellerProfileId" = $11 AND quantity = 1 AND "priceCents" = 500) AS dispute_item,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent"
          WHERE id = $1 AND "stripeEventId" = $2 AND "orderId" = $3) AS refund_payment,
        (SELECT count(*)::integer FROM public."OrderPaymentEvent"
          WHERE id = $4 AND "stripeEventId" = $5 AND "orderId" = $6) AS dispute_payment,
        (SELECT count(*)::integer FROM public."CaseStripeDisputeApplication"
          WHERE "paymentEventId" = $4 AND "caseId" = $7 AND "orderId" = $6 AND action = 'create') AS application,
        (SELECT count(*)::integer FROM public."Case"
          WHERE id = $7 AND "orderId" = $6 AND "buyerId" = $8 AND "sellerId" = $9
            AND "openedByPaymentEventId" = $4) AS case_row,
        (SELECT count(*)::integer FROM public."Notification"
          WHERE id = $10 AND "userId" = $9 AND type = 'PAYMENT_DISPUTE'
            AND "sourceType" = 'order_payment' AND "sourceId" = $5
            AND "relatedUserId" = $8) AS notification,
        (SELECT count(*)::integer FROM public."SystemAuditLog"
          WHERE ("actorId" = $2 AND action = 'STRIPE_REFUND_RECORDED'
                   AND "targetType" = 'ORDER' AND "targetId" = $3)
             OR ("actorId" = $5 AND action = 'STRIPE_DISPUTE_RECORDED'
                   AND "targetType" = 'ORDER' AND "targetId" = $6)
             OR ("actorId" = $5 AND action = 'CASE_STRIPE_DISPUTE_APPLIED'
                   AND "targetType" = 'CASE' AND "targetId" = $7)) AS audits
    `, [
      state.refundPaymentEventId, state.refundEventId, state.refundOrderId,
      state.disputePaymentEventId, state.disputeEventId, state.disputeOrderId,
      state.caseId, state.buyerId, state.sellerUserId, state.notificationId,
      state.sellerProfileId, state.refundListingId, state.disputeListingId,
      state.refundOrderItemId, state.disputeOrderItemId,
      state.refundPaymentIntentId, state.refundChargeId,
      state.disputePaymentIntentId, state.disputeChargeId,
      state.buyerClerkId, state.buyerEmail, state.sellerClerkId, state.sellerEmail,
    ]);
    const row = exact.rows[0];
    if (
      Number(row?.buyer_user) !== 1
      || Number(row?.seller_user) !== 1
      || Number(row?.seller) !== 1
      || Number(row?.refund_listing) !== 1
      || Number(row?.dispute_listing) !== 1
      || Number(row?.refund_order) !== 1
      || Number(row?.dispute_order) !== 1
      || Number(row?.refund_item) !== 1
      || Number(row?.dispute_item) !== 1
      || Number(row?.refund_payment) !== 1
      || Number(row?.dispute_payment) !== 1
      || Number(row?.application) !== 1
      || Number(row?.case_row) !== 1
      || Number(row?.notification) !== 1
      || Number(row?.audits) !== 3
    ) throw new Error("signed payment exact cleanup relationship drifted");

    const deletions = [
      await owner.query(`DELETE FROM public."Notification" WHERE id = $1 RETURNING id`, [state.notificationId]),
      await owner.query(`DELETE FROM public."CaseStripeDisputeApplication" WHERE "paymentEventId" = $1 RETURNING "paymentEventId"`, [state.disputePaymentEventId]),
      await owner.query(`DELETE FROM public."Case" WHERE id = $1 RETURNING id`, [state.caseId]),
      await owner.query(`
        DELETE FROM public."SystemAuditLog"
         WHERE ("actorId" = $1 AND action = 'STRIPE_REFUND_RECORDED'
                  AND "targetType" = 'ORDER' AND "targetId" = $2)
            OR ("actorId" = $3 AND action = 'STRIPE_DISPUTE_RECORDED'
                  AND "targetType" = 'ORDER' AND "targetId" = $4)
            OR ("actorId" = $3 AND action = 'CASE_STRIPE_DISPUTE_APPLIED'
                  AND "targetType" = 'CASE' AND "targetId" = $5)
        RETURNING id
      `, [state.refundEventId, state.refundOrderId, state.disputeEventId, state.disputeOrderId, state.caseId]),
      await owner.query(`DELETE FROM public."OrderPaymentEvent" WHERE id IN ($1, $2) RETURNING id`, [state.refundPaymentEventId, state.disputePaymentEventId]),
      await owner.query(`DELETE FROM public."OrderItem" WHERE id IN ($1, $2) RETURNING id`, [state.refundOrderItemId, state.disputeOrderItemId]),
    ];
    const expectedCounts = [1, 1, 1, 3, 2, 2];
    deletions.forEach((result, index) => {
      if (resultCardinality(result) !== expectedCounts[index]) {
        throw new Error("signed payment cleanup cardinality drifted");
      }
    });

    await assertNoForeignKeyDependents(owner, 'public."Order"', state.refundOrderId);
    await assertNoForeignKeyDependents(owner, 'public."Order"', state.disputeOrderId);
    const deletedOrders = await owner.query(
      `DELETE FROM public."Order" WHERE id IN ($1, $2) RETURNING id`,
      [state.refundOrderId, state.disputeOrderId],
    );
    await assertNoForeignKeyDependents(owner, 'public."Listing"', state.refundListingId);
    await assertNoForeignKeyDependents(owner, 'public."Listing"', state.disputeListingId);
    const deletedListings = await owner.query(
      `DELETE FROM public."Listing" WHERE id IN ($1, $2) RETURNING id`,
      [state.refundListingId, state.disputeListingId],
    );
    await assertNoForeignKeyDependents(owner, 'public."SellerProfile"', state.sellerProfileId);
    const deletedSeller = await owner.query(
      `DELETE FROM public."SellerProfile" WHERE id = $1 RETURNING id`,
      [state.sellerProfileId],
    );
    await assertNoForeignKeyDependents(owner, 'public."User"', state.buyerId);
    await assertNoForeignKeyDependents(owner, 'public."User"', state.sellerUserId);
    const deletedUsers = await owner.query(
      `DELETE FROM public."User" WHERE id IN ($1, $2) RETURNING id`,
      [state.buyerId, state.sellerUserId],
    );
    if (
      resultCardinality(deletedOrders) !== 2
      || resultCardinality(deletedListings) !== 2
      || resultCardinality(deletedSeller) !== 1
      || resultCardinality(deletedUsers) !== 2
    ) throw new Error("signed payment parent cleanup cardinality drifted");
    await owner.query("COMMIT");
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCleanupSnapshot(owner, state) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public."User" WHERE id IN ($1, $2)) AS "userCount",
        (SELECT count(*)::integer FROM public."SellerProfile" WHERE id = $3) AS "sellerCount",
        (SELECT count(*)::integer FROM public."Listing" WHERE id IN ($4, $5)) AS "listingCount",
        (SELECT count(*)::integer FROM public."Order" WHERE id IN ($6, $7)) AS "orderCount",
        (SELECT count(*)::integer FROM public."OrderItem" WHERE id IN ($8, $9)) AS "itemCount",
        (SELECT count(*)::integer FROM public."OrderPaymentEvent" WHERE id IN ($10, $11)) AS "paymentCount",
        (SELECT count(*)::integer FROM public."Case" WHERE id = $12) AS "caseCount",
        (SELECT count(*)::integer FROM public."Notification" WHERE id = $13) AS "notificationCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent" WHERE id IN ($14, $15)) AS "webhookCount",
        (SELECT count(*)::integer FROM public."StripeWebhookEvent"
          WHERE id IN ($14, $15) AND "processedAt" IS NOT NULL AND "lastError" IS NULL) AS "processedWebhookCount"
    `, [
      state.buyerId, state.sellerUserId, state.sellerProfileId,
      state.refundListingId, state.disputeListingId,
      state.refundOrderId, state.disputeOrderId,
      state.refundOrderItemId, state.disputeOrderItemId,
      state.refundPaymentEventId, state.disputePaymentEventId,
      state.caseId, state.notificationId,
      state.refundEventId, state.disputeEventId,
    ]);
    await owner.query("ROLLBACK");
    return result.rows[0];
  } catch (error) {
    try { await owner.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export function assertCleanupSnapshot(snapshot) {
  const normalized = Object.fromEntries([
    "userCount", "sellerCount", "listingCount", "orderCount", "itemCount",
    "paymentCount", "caseCount", "notificationCount", "webhookCount",
    "processedWebhookCount",
  ].map((key) => [key, Number(snapshot?.[key])]));
  if (
    normalized.userCount !== 0
    || normalized.sellerCount !== 0
    || normalized.listingCount !== 0
    || normalized.orderCount !== 0
    || normalized.itemCount !== 0
    || normalized.paymentCount !== 0
    || normalized.caseCount !== 0
    || normalized.notificationCount !== 0
    || normalized.webhookCount !== 2
    || normalized.processedWebhookCount !== 2
  ) throw new Error("signed payment exact cleanup did not reach the reviewed state");
  return Object.freeze(normalized);
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

function verifyGitHubCi(config) {
  const githubEnvironment = childEnvironment({
    ...(typeof process.env.GH_TOKEN === "string" ? { GH_TOKEN: process.env.GH_TOKEN } : {}),
    ...(typeof process.env.GITHUB_TOKEN === "string"
      ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      : {}),
  });
  const raw = execFileSync("gh", [
    "run", "view", String(config.mainCiRunId), "--json",
    "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
  ], {
    encoding: "utf8",
    env: githubEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseGitHubCiRun(raw, config.expectedCommit, config.mainCiRunId);
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
  const deploymentRaw = command("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "api",
    `/v13/deployments/${config.deploymentId}`,
    "--raw", "--cwd", config.vercelProjectDirectory, "--no-color",
  ], {
    cwd: config.vercelProjectDirectory,
    env: childEnvironment(process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {}),
    label: "Vercel production deployment API lookup",
  });
  parseVercelDeployment(deploymentRaw, config);
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const healthBody = JSON.parse(await boundedText(health, MAX_PRIVATE_BYTES));
  if (health.status !== 200 || healthBody?.ok !== true) throw new Error("production health failed");
  const page = await fetch(PRODUCTION_ORIGIN, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const body = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !body.includes(`dpl=${config.deploymentId}`)) {
    throw new Error("canonical alias is not the reviewed deployment");
  }
  return Object.freeze({ canonicalDeploymentMarker: true, healthStatus: 200 });
}

function postgresClient(connectionString, applicationName) {
  const parsed = new URL(connectionString);
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
}

async function verifyDatabaseBoundary(owner, runtime) {
  // node-postgres clients serialize queries; issuing multiple owner queries on
  // one client concurrently is deprecated and can make proof ordering opaque.
  const ownerIdentity = await owner.query(
    "SELECT current_user AS role, current_database() AS database",
  );
  const runtimeIdentity = await runtime.query(
    "SELECT current_user AS role, current_database() AS database",
  );
  const posture = await owner.query(`
      SELECT
        relation.relrowsecurity AS enabled,
        relation.relforcerowsecurity AS forced,
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."OrderPaymentEvent"', 'SELECT') AS can_select,
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."OrderPaymentEvent"', 'INSERT') AS can_insert,
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."OrderPaymentEvent"', 'UPDATE') AS can_update,
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."OrderPaymentEvent"', 'DELETE') AS can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = 'OrderPaymentEvent'
    `);
  const functions = await owner.query(`
      WITH expected(signature) AS (
        VALUES
          ('public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)'),
          ('public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'),
          ('public.grainline_case_stripe_dispute_apply(text)'),
          ('public.grainline_notification_create_order_event(text,text,public."NotificationType",text,text,text)')
      )
      SELECT
        pg_catalog.count(*)::integer AS count,
        pg_catalog.count(*) FILTER (
          WHERE routine.oid IS NOT NULL
            AND routine.prosecdef = true
            AND routine.provolatile = 'v'
            AND routine.proparallel = 'u'
            AND routine.proconfig @> ARRAY['search_path=pg_catalog']::text[]
            AND pg_catalog.has_function_privilege(
              'grainline_app_runtime', routine.oid, 'EXECUTE'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
            )
        )::integer AS valid
      FROM expected
      LEFT JOIN LATERAL (
        SELECT procedure_row.*
          FROM pg_catalog.pg_proc AS procedure_row
         WHERE procedure_row.oid = pg_catalog.to_regprocedure(expected.signature)
      ) AS routine ON true
    `);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(posture.rows, [{
    enabled: false,
    forced: false,
    can_select: true,
    can_insert: true,
    can_update: true,
    can_delete: true,
  }]);
  assert.deepEqual(functions.rows, [{ count: 4, valid: 4 }]);
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
  const idempotency = (key) => ({
    idempotencyKey: `grainline-ope-signed-${config.preparationCommit}-${attemptId}-${key}`,
  });
  return {
    listClassicEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    listV2Destinations: () => listAll(stripe.v2.core.eventDestinations.list({
      include: ["webhook_endpoint.url"], limit: 100,
    })),
    createRefundPaymentIntent: () => stripe.paymentIntents.create({
      amount: REFUND_AMOUNT_CENTS,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Grainline signed refund authority proof",
      metadata: { grainline_order_payment_proof: sha256(`${config.preparationCommit}:${attemptId}:refund`) },
    }, idempotency("refund-payment-intent")),
    createRefund: (chargeId) => stripe.refunds.create({
      charge: chargeId,
      amount: REFUND_AMOUNT_CENTS,
      metadata: { grainline_order_payment_proof: sha256(`${config.preparationCommit}:${attemptId}:refund`) },
    }, idempotency("refund")),
    createDisputePaymentIntent: () => stripe.paymentIntents.create({
      amount: DISPUTE_AMOUNT_CENTS,
      currency: "usd",
      payment_method: "pm_card_createDispute",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Grainline signed dispute authority proof",
      metadata: { grainline_order_payment_proof: sha256(`${config.preparationCommit}:${attemptId}:dispute`) },
    }, idempotency("dispute-payment-intent")),
    listRefundEvents: (createdAfter) => listAll(stripe.events.list({
      created: { gte: createdAfter }, limit: 100, type: "charge.refunded",
    })),
    retrieveEvent: (eventId) => stripe.events.retrieve(eventId),
    listDisputeEvents: (createdAfter) => listAll(stripe.events.list({
      created: { gte: createdAfter }, limit: 100, type: "charge.dispute.created",
    })),
    resendEvent(endpointId, eventId) {
      const cliRoot = mkdtempSync(path.join(os.tmpdir(), "grainline-ope-signed-cli-"));
      try {
        const environment = childEnvironment({ STRIPE_API_KEY: secretKey, XDG_CONFIG_HOME: cliRoot });
        const version = command(config.stripeCliPath, ["version", "--color", "off"], {
          env: environment,
          label: "Stripe CLI version check",
        });
        if (String(version).trim().split("\n")[0] !== `stripe version ${STRIPE_CLI_VERSION}`) {
          throw new Error(`Stripe CLI version drifted from ${STRIPE_CLI_VERSION}`);
        }
        command(config.stripeCliPath, [
          "events", "resend", eventId,
          "--webhook-endpoint", endpointId,
          "--confirm", "--color", "off",
        ], { env: environment, label: "Stripe exact signed payment resend" });
      } finally {
        rmSync(cliRoot, { force: true, recursive: true });
      }
    },
  };
}

function paymentIntentIdentity(intent, expectedAmount, label) {
  const chargeId = typeof intent?.latest_charge === "string"
    ? intent.latest_charge
    : intent?.latest_charge?.id;
  if (
    !/^pi_[A-Za-z0-9_]+$/.test(String(intent?.id ?? ""))
    || !/^ch_[A-Za-z0-9_]+$/.test(String(chargeId ?? ""))
    || intent?.livemode !== false
    || intent?.status !== "succeeded"
    || intent?.amount !== expectedAmount
    || intent?.currency !== "usd"
  ) throw new Error(`${label} payment intent did not reach the reviewed test state`);
  return Object.freeze({ chargeId, paymentIntentId: intent.id });
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
  const matches = events.filter((event) => (
    event?.type === "charge.refunded"
    && event?.livemode === false
    && event?.data?.object?.id === state.refundChargeId
    && event.data.object.refunded === true
    && event.data.object.amount === REFUND_AMOUNT_CENTS
    && event.data.object.amount_refunded === REFUND_AMOUNT_CENTS
    && event.data.object.currency === "usd"
    && event.data.object.payment_intent === state.refundPaymentIntentId
    && event.data.object.transfer == null
  ));
  if (matches.length !== 1) return null;
  return matches[0];
}

export function signedRefundSourceIdentity(event, state) {
  if (
    event?.id !== state.refundEventId
    || !Number.isSafeInteger(event?.created)
    || event.created <= 0
    || findSingleRefundEvent([event], state) !== event
  ) {
    throw new Error("signed refund source event identity drifted");
  }
  const refundCollection = event.data.object.refunds;
  const refunds = refundCollection == null ? [] : refundCollection.data;
  if (!Array.isArray(refunds)) {
    throw new Error("signed refund source collection is malformed");
  }
  const successful = refunds
    .filter((refund) => String(refund?.status ?? "").toLowerCase() === "succeeded")
    .sort((left, right) => Number(right?.created ?? 0) - Number(left?.created ?? 0));
  if (successful.length === 0) {
    return Object.freeze({
      objectId: `external:${state.refundEventId}`,
      representation: "external_event",
    });
  }
  if (successful.length !== 1) {
    throw new Error("signed refund embedded identity is ambiguous");
  }
  const refund = successful[0];
  if (
    refund?.id !== state.refundId
    || refund?.amount !== REFUND_AMOUNT_CENTS
    || !Number.isSafeInteger(refund?.created)
    || refund.created <= 0
    || refund.created > event.created
  ) throw new Error("signed refund embedded identity drifted");
  return Object.freeze({
    objectId: refund.id,
    representation: "provider_refund",
  });
}

function findSingleDisputeEvent(events, state) {
  const matches = events.filter((event) => {
    const chargeId = typeof event?.data?.object?.charge === "string"
      ? event.data.object.charge
      : event?.data?.object?.charge?.id;
    return event?.type === "charge.dispute.created"
      && event?.livemode === false
      && chargeId === state.disputeChargeId;
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

export function buildEvidence(config, state, cleanup, provider, refundIdentity) {
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    phase: "order-payment-event-signed-production-proof",
    status: "passed",
    mode: "test",
    commit: config.expectedCommit,
    preparationCommit: config.preparationCommit,
    preparationCiRunId: config.preparationCiRunId,
    deployedSourceCommit: config.deployedSourceCommit,
    ciRunId: config.mainCiRunId,
    deploymentId: config.deploymentId,
    providerStage: provider.stage,
    stripe: {
      refundPaymentIntentSha256: sha256(state.refundPaymentIntentId),
      refundChargeSha256: sha256(state.refundChargeId),
      refundIdSha256: sha256(state.refundId),
      refundEventSha256: sha256(state.refundEventId),
      signedRefundObjectSha256: sha256(refundIdentity.objectId),
      signedRefundIdentityRepresentation: refundIdentity.representation,
      disputePaymentIntentSha256: sha256(state.disputePaymentIntentId),
      disputeChargeSha256: sha256(state.disputeChargeId),
      disputeIdSha256: sha256(state.disputeId),
      disputeEventSha256: sha256(state.disputeEventId),
      refundAmountCents: REFUND_AMOUNT_CENTS,
      disputeAmountCents: DISPUTE_AMOUNT_CENTS,
      requiredResendTransitionsCompleted: 3,
      exactReplayProofs: 2,
    },
    database: {
      refundPaymentEventSha256: sha256(state.refundPaymentEventId),
      disputePaymentEventSha256: sha256(state.disputePaymentEventId),
      caseSha256: sha256(state.caseId),
      notificationSha256: sha256(state.notificationId),
      retainedProcessedWebhookLeases: cleanup.processedWebhookCount,
      temporaryApplicationRowsRemoved: cleanup.userCount === 0
        && cleanup.sellerCount === 0
        && cleanup.listingCount === 0
        && cleanup.orderCount === 0
        && cleanup.itemCount === 0
        && cleanup.paymentCount === 0
        && cleanup.caseCount === 0
        && cleanup.notificationCount === 0,
      exactRetriesLeftApplicationIdentitiesUnchanged: true,
    },
    productionChangedByProof: true,
    databaseChangeAfterCleanup: "two processed Stripe test-mode webhook replay leases retained",
    externalResidueAfterCleanup:
      "Stripe test objects plus ordinary signed-delivery and observability telemetry retained",
    providerConfigurationChanged: false,
    liveMoneyMoved: false,
    rawIdentifiersPersistedInEvidence: false,
    secretsPersistedInEvidence: false,
    activationReadyFromThisProofAlone: false,
    nextBoundary: "seller refund, blocked-checkout refund and staff Case refund live proofs",
  });
}

export function shouldReadApplicationDelivery(stage) {
  return ["dispute-delivered", "dispute-replay-pending", "dispute-replayed"].includes(stage);
}

function assertEvidence(value, config) {
  const hex = /^[a-f0-9]{64}$/;
  const hashes = [
    value?.stripe?.refundPaymentIntentSha256,
    value?.stripe?.refundChargeSha256,
    value?.stripe?.refundIdSha256,
    value?.stripe?.refundEventSha256,
    value?.stripe?.signedRefundObjectSha256,
    value?.stripe?.disputePaymentIntentSha256,
    value?.stripe?.disputeChargeSha256,
    value?.stripe?.disputeIdSha256,
    value?.stripe?.disputeEventSha256,
    value?.database?.refundPaymentEventSha256,
    value?.database?.disputePaymentEventSha256,
    value?.database?.caseSha256,
    value?.database?.notificationSha256,
  ];
  if (
    value?.phase !== "order-payment-event-signed-production-proof"
    || value?.status !== "passed"
    || value?.mode !== "test"
    || value?.commit !== config.expectedCommit
    || value?.preparationCommit !== config.preparationCommit
    || Number(value?.preparationCiRunId) !== config.preparationCiRunId
    || value?.deployedSourceCommit !== config.deployedSourceCommit
    || Number(value?.ciRunId) !== config.mainCiRunId
    || value?.deploymentId !== config.deploymentId
    || value?.providerStage !== 4
    || hashes.some((hash) => !hex.test(String(hash ?? "")))
    || value?.stripe?.refundAmountCents !== REFUND_AMOUNT_CENTS
    || !new Set(["external_event", "provider_refund"]).has(
      value?.stripe?.signedRefundIdentityRepresentation,
    )
    || value?.stripe?.disputeAmountCents !== DISPUTE_AMOUNT_CENTS
    || value?.stripe?.requiredResendTransitionsCompleted !== 3
    || value?.stripe?.exactReplayProofs !== 2
    || value?.database?.retainedProcessedWebhookLeases !== 2
    || value?.database?.temporaryApplicationRowsRemoved !== true
    || value?.database?.exactRetriesLeftApplicationIdentitiesUnchanged !== true
    || value?.productionChangedByProof !== true
    || value?.databaseChangeAfterCleanup
      !== "two processed Stripe test-mode webhook replay leases retained"
    || value?.externalResidueAfterCleanup
      !== "Stripe test objects plus ordinary signed-delivery and observability telemetry retained"
    || value?.providerConfigurationChanged !== false
    || value?.liveMoneyMoved !== false
    || value?.rawIdentifiersPersistedInEvidence !== false
    || value?.secretsPersistedInEvidence !== false
    || value?.activationReadyFromThisProofAlone !== false
  ) throw new Error("signed payment proof evidence drifted");
  return Object.freeze(value);
}

export async function runOrderPaymentSignedProductionProof({ env = process.env, dependencies = {} } = {}) {
  const config = validateConfiguration(env);
  if (existsSync(config.evidencePath)) {
    const completed = assertEvidence(readPrivateJson(config.evidencePath, "signed payment evidence"), config);
    const retained = readRecoveryState(config);
    if (retained) {
      if (
        retained.stage !== "cleaned"
        || sha256(retained.refundPaymentIntentId)
          !== completed.stripe.refundPaymentIntentSha256
        || sha256(retained.refundChargeId) !== completed.stripe.refundChargeSha256
        || sha256(retained.refundId) !== completed.stripe.refundIdSha256
        || sha256(retained.refundEventId) !== completed.stripe.refundEventSha256
        || sha256(retained.disputePaymentIntentId)
          !== completed.stripe.disputePaymentIntentSha256
        || sha256(retained.disputeChargeId) !== completed.stripe.disputeChargeSha256
        || sha256(retained.disputeId) !== completed.stripe.disputeIdSha256
        || sha256(retained.disputeEventId) !== completed.stripe.disputeEventSha256
        || sha256(retained.refundPaymentEventId)
          !== completed.database.refundPaymentEventSha256
        || sha256(retained.disputePaymentEventId)
          !== completed.database.disputePaymentEventSha256
        || sha256(retained.caseId) !== completed.database.caseSha256
        || sha256(retained.notificationId) !== completed.database.notificationSha256
      ) throw new Error("completed evidence does not bind cleaned recovery state");
      unlinkSync(config.statePath);
    }
    return completed;
  }
  const cwd = path.resolve(config.vercelProjectDirectory);
  assertGitState((dependencies.readGitState ?? readGitState)(cwd), config.expectedCommit);
  (dependencies.verifyGitHubCi ?? verifyGitHubCi)(config);
  (dependencies.assertVercelProject ?? assertVercelProject)(config);
  await (dependencies.verifyDeployment ?? verifyDeployment)(config);

  const localValues = dependencies.localValues
    ?? readPrivateEnvironment(LOCAL_ENV_PATH, "runtime environment");
  const ownerValues = dependencies.ownerValues
    ?? readPrivateEnvironment(OWNER_ENV_PATH, "owner environment");
  const secretKey = validateStripeSecret(localValues);
  const { ownerDatabaseUrl, runtimeDatabaseUrl } = parseDatabaseUrls(localValues, ownerValues);
  const owner = dependencies.owner ?? postgresClient(
    ownerDatabaseUrl,
    "grainline-order-payment-signed-proof-owner",
  );
  const runtime = dependencies.runtime ?? postgresClient(
    runtimeDatabaseUrl,
    "grainline-order-payment-signed-proof-runtime",
  );
  await owner.connect();
  await runtime.connect();
  let state;
  try {
    await (dependencies.verifyDatabaseBoundary ?? verifyDatabaseBoundary)(owner, runtime);
    const recovered = readRecoveryState(config);
    if (recovered) {
      state = recovered;
    } else {
      state = stateWithIdentity(config);
      writePrivateJson(config.statePath, state);
    }
    const stripe = dependencies.stripe ?? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
    const stripeOps = dependencies.stripeOps
      ?? stripeDependencies(stripe, secretKey, config, state.attemptId);
    let refundIdentity;
    const resolveRefundIdentity = async () => {
      if (refundIdentity) return refundIdentity;
      refundIdentity = signedRefundSourceIdentity(
        await stripeOps.retrieveEvent(state.refundEventId),
        state,
      );
      return refundIdentity;
    };
    const provider = await readProviderState(stripeOps);
    if (
      provider.stage !== 4
      || provider.platform?.url !== PLATFORM_WEBHOOK_URL
      || provider.platform?.status !== "enabled"
    ) throw new Error("signed payment proof requires exact enabled provider stage 4");

    if (state.stage === "reserved") {
      const identity = paymentIntentIdentity(
        await stripeOps.createRefundPaymentIntent(),
        REFUND_AMOUNT_CENTS,
        "refund",
      );
      state = updateState(config, state, {
        stage: "refund-charge-created",
        refundPaymentIntentId: identity.paymentIntentId,
        refundChargeId: identity.chargeId,
      });
    }
    if (state.stage === "refund-charge-created") {
      await (dependencies.createDisposableDatabaseFixtures
        ?? createDisposableDatabaseFixtures)(owner, state, "refund");
      state = updateState(config, state, { stage: "refund-fixture-created" });
    }
    if (state.stage === "refund-fixture-created") {
      const refund = assertStripeRefundObject(
        await stripeOps.createRefund(state.refundChargeId),
        "signed payment refund",
      );
      if (
        refund?.status !== "succeeded"
        || refund?.amount !== REFUND_AMOUNT_CENTS
        || refund?.currency !== "usd"
      ) throw new Error("refund did not reach the reviewed Stripe test state");
      state = updateState(config, state, { stage: "refund-created", refundId: refund.id });
    }
    if (state.stage === "refund-created") {
      const event = await waitFor(
        async () => findSingleRefundEvent(await stripeOps.listRefundEvents(state.startedSeconds), state),
        Boolean,
        "charge.refunded source event",
      );
      state = updateState(config, state, { stage: "refund-event-ready", refundEventId: event.id });
    }
    let refundDelivery;
    if (state.stage === "refund-event-ready") {
      const expectedRefund = await resolveRefundIdentity();
      refundDelivery = await waitFor(
        () => readDeliverySnapshot(owner, state, expectedRefund.objectId),
        (row) => Number(row?.refundPaymentCount) === 1 && row?.refundProcessed === true,
        "signed refund delivery",
      );
      if (
        Number(refundDelivery?.refundWebhookCount) !== 1
        || refundDelivery?.refundErrorClear !== true
        || Number(refundDelivery?.refundAuditCount) !== 1
        || refundDelivery?.refundReason !== "external_refund"
        || refundDelivery?.refundLatestRefundId !== (
          expectedRefund.representation === "provider_refund"
            ? expectedRefund.objectId
            : null
        )
        || refundDelivery?.refundEvidenceId != null
        || refundDelivery?.refundEvidenceAction != null
        || refundDelivery?.orderRefundId !== expectedRefund.objectId
        || Number(refundDelivery?.orderRefundAmount) !== REFUND_AMOUNT_CENTS
        || refundDelivery?.refundReviewNeeded !== true
      ) throw new Error("signed refund delivery did not reach the exact reviewed state");
      state = updateState(config, state, {
        stage: "refund-delivered",
        refundPaymentEventId: exactString(
          refundDelivery.refundPaymentEventId,
          "refund payment event",
        ),
      });
    }
    if (state.stage === "refund-delivered") {
      state = updateState(config, state, { stage: "refund-replay-pending" });
    }
    if (state.stage === "refund-replay-pending") {
      const expectedRefund = await resolveRefundIdentity();
      const before = await readDeliverySnapshot(owner, state, expectedRefund.objectId);
      await stripeOps.resendEvent(provider.platform.id, state.refundEventId);
      const after = await waitFor(
        () => readDeliverySnapshot(owner, state, expectedRefund.objectId),
        (row) => row?.refundProcessed === true,
        "signed refund exact retry",
        20,
        1000,
      );
      for (const key of ["refundGeneration", "refundWebhookEpoch", "refundPaymentEventId"]) {
        if (before[key] !== after[key]) throw new Error(`exact refund retry changed ${key}`);
      }
      state = updateState(config, state, { stage: "refund-replayed" });
    }
    if (state.stage === "refund-replayed") {
      const identity = paymentIntentIdentity(
        await stripeOps.createDisputePaymentIntent(),
        DISPUTE_AMOUNT_CENTS,
        "dispute",
      );
      state = updateState(config, state, { stage: "dispute-charge-created", ...{
        disputePaymentIntentId: identity.paymentIntentId,
        disputeChargeId: identity.chargeId,
      } });
    }
    if (state.stage === "dispute-charge-created") {
      await (dependencies.createDisposableDatabaseFixtures
        ?? createDisposableDatabaseFixtures)(owner, state, "dispute");
      state = updateState(config, state, { stage: "all-fixtures-created" });
    }
    if (state.stage === "all-fixtures-created") {
      const event = await waitFor(
        async () => findSingleDisputeEvent(await stripeOps.listDisputeEvents(state.startedSeconds), state),
        Boolean,
        "charge.dispute.created source event",
      );
      const disputeId = exactString(event?.data?.object?.id, "Stripe dispute id");
      state = updateState(config, state, {
        stage: "dispute-event-ready",
        disputeEventId: event.id,
        disputeId,
      });
    }
    let delivered;
    if (state.stage === "dispute-event-ready") {
      state = updateState(config, state, { stage: "dispute-delivery-resend-pending" });
    }
    if (state.stage === "dispute-delivery-resend-pending") {
      // The special test payment may emit before its Order fixture exists.
      // An exact resend after fixture insertion makes delivery deterministic.
      const expectedRefund = await resolveRefundIdentity();
      await stripeOps.resendEvent(provider.platform.id, state.disputeEventId);
      delivered = assertDeliverySnapshot(await waitFor(
        () => readDeliverySnapshot(owner, state, expectedRefund.objectId),
        (row) => Number(row?.disputePaymentCount) === 1 && row?.disputeProcessed === true,
        "signed dispute delivery",
      ), {
        refundObjectId: expectedRefund.objectId,
        refundRepresentation: expectedRefund.representation,
      });
      state = updateState(config, state, {
        stage: "dispute-delivered",
        disputePaymentEventId: delivered.disputePaymentEventId,
        caseId: delivered.caseId,
        notificationId: delivered.notificationId,
      });
    }
    if (!delivered && shouldReadApplicationDelivery(state.stage)) {
      const expectedRefund = await resolveRefundIdentity();
      delivered = assertDeliverySnapshot(await readDeliverySnapshot(
        owner,
        state,
        expectedRefund.objectId,
      ), {
        refundObjectId: expectedRefund.objectId,
        refundRepresentation: expectedRefund.representation,
        refundPaymentEventId: state.refundPaymentEventId,
        disputePaymentEventId: state.disputePaymentEventId,
        caseId: state.caseId,
        notificationId: state.notificationId,
      });
    }
    if (state.stage === "dispute-delivered") {
      state = updateState(config, state, { stage: "dispute-replay-pending" });
    }
    if (state.stage === "dispute-replay-pending") {
      const expectedRefund = await resolveRefundIdentity();
      await stripeOps.resendEvent(provider.platform.id, state.disputeEventId);
      const replay = await waitFor(
        () => readDeliverySnapshot(owner, state, expectedRefund.objectId),
        (row) => {
          try {
            assertReplayUnchanged(delivered, row, {
              refundObjectId: expectedRefund.objectId,
              refundRepresentation: expectedRefund.representation,
            });
            return true;
          } catch {
            return false;
          }
        },
        "signed dispute exact retry",
        20,
        1000,
      );
      assertReplayUnchanged(delivered, replay, {
        refundObjectId: expectedRefund.objectId,
        refundRepresentation: expectedRefund.representation,
      });
      state = updateState(config, state, { stage: "dispute-replayed" });
    }
    if (state.stage === "dispute-replayed") {
      state = updateState(config, state, { stage: "cleanup-started" });
    }
    const readCleanup = dependencies.readCleanupSnapshot ?? readCleanupSnapshot;
    if (state.stage === "cleanup-started") {
      const before = await readCleanup(owner, state);
      const pending = Number(before?.userCount) === 2
        && Number(before?.sellerCount) === 1
        && Number(before?.listingCount) === 2
        && Number(before?.orderCount) === 2
        && Number(before?.itemCount) === 2
        && Number(before?.paymentCount) === 2
        && Number(before?.caseCount) === 1
        && Number(before?.notificationCount) === 1
        && Number(before?.webhookCount) === 2
        && Number(before?.processedWebhookCount) === 2;
      if (pending) {
        await (dependencies.cleanupExactRows ?? cleanupExactRows)(owner, state);
      } else {
        assertCleanupSnapshot(before);
      }
      assertCleanupSnapshot(await readCleanup(owner, state));
      state = updateState(config, state, { stage: "cleaned" });
    }
    const cleanup = assertCleanupSnapshot(await readCleanup(owner, state));
    const finalProvider = await readProviderState(stripeOps);
    if (finalProvider.stage !== 4 || finalProvider.platform?.url !== PLATFORM_WEBHOOK_URL) {
      throw new Error("provider topology drifted during signed payment proof");
    }
    await (dependencies.verifyDeployment ?? verifyDeployment)(config);
    const expectedRefund = await resolveRefundIdentity();
    const evidence = assertEvidence(
      buildEvidence(config, state, cleanup, finalProvider, expectedRefund),
      config,
    );
    writePrivateJson(config.evidencePath, evidence);
    unlinkSync(config.statePath);
    return evidence;
  } finally {
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

async function main() {
  try {
    const result = await runOrderPaymentSignedProductionProof();
    process.stdout.write(`${JSON.stringify({
      ciRunId: result.ciRunId,
      commit: result.commit,
      deploymentId: result.deploymentId,
      phase: result.phase,
      status: result.status,
    })}\n`);
  } catch (error) {
    process.stderr.write(`OrderPaymentEvent signed production proof failed closed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
