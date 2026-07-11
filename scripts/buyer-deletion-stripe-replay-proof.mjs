#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRIPE_API_VERSION = "2025-10-29.clover";
const CONFIRMATION_VALUE = "test-mode-replay";
const DB_CONFIRMATION_VALUE = "staging-or-local-read";
const EVIDENCE_MAX_ISSUES = 20;
const BLOCKED_CHECKOUT_REVIEW_MARKER = "Order was held for staff review.";
const BLOCKED_REFUND_ACTION = "BLOCKED_CHECKOUT_REFUND_RECORDED";
const CHECKOUT_CREATED_ACTION = "STRIPE_CHECKOUT_ORDER_CREATED";

const BUYER_INVALID_REASONS = {
  deleted: "Buyer account was deleted before payment completion.",
  missing: "Buyer account could not be verified at payment completion.",
  suspended: "Buyer account was suspended before payment completion.",
};

const BUYER_PII_FIELDS = [
  "buyerEmail",
  "buyerName",
  "shipToLine1",
  "shipToLine2",
  "shipToCity",
  "shipToState",
  "shipToPostalCode",
  "shipToCountry",
  "quotedToLine1",
  "quotedToLine2",
  "quotedToCity",
  "quotedToState",
  "quotedToPostalCode",
  "quotedToCountry",
  "quotedToName",
  "quotedToPhone",
  "giftNote",
  "shippoShipmentId",
  "shippoRateObjectId",
];

const DB_ENV_ASSIGNMENT_PATTERN =
  /["']?\b(?:DATABASE_URL|DIRECT_URL|BUYER_DELETION_REPLAY_PROOF_[A-Z0-9_]+|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"')]+/gi;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const PASSWORD_ASSIGNMENT_PATTERN =
  /["']?\b(?:password|pass|pwd|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(DB_ENV_ASSIGNMENT_PATTERN, "[redacted-buyer-deletion-replay-proof-env]")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password-assignment]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  if (error instanceof Error) return redact(error.message || error.name);
  return redact(String(error));
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hashValue(value) {
  return createHash("sha256").update(String(value ?? "")).digest("base64url").slice(0, 16);
}

function hashStripeId(value) {
  if (!value) return null;
  const prefix = String(value).split("_").slice(0, 2).join("_");
  return { prefix, hash: hashValue(value) };
}

function evidencePathFromEnv(env) {
  const raw = required(env, "BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) {
    throw new Error("BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH must not contain null bytes");
  }
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function parseExpectedBuyerState(value) {
  if (!value) return "any-invalid";
  if (!Object.hasOwn(BUYER_INVALID_REASONS, value)) {
    throw new Error("BUYER_DELETION_REPLAY_PROOF_EXPECTED_BUYER_STATE must be deleted, suspended, or missing");
  }
  return value;
}

export function parseConfig(env = process.env) {
  if (env.BUYER_DELETION_REPLAY_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`BUYER_DELETION_REPLAY_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  if (env.BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM !== DB_CONFIRMATION_VALUE) {
    throw new Error(`BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM=${DB_CONFIRMATION_VALUE} is required`);
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test-mode secret key");
  }
  const sessionId = required(env, "BUYER_DELETION_REPLAY_PROOF_SESSION_ID");
  if (!sessionId.startsWith("cs_test_")) {
    throw new Error("BUYER_DELETION_REPLAY_PROOF_SESSION_ID must be a Stripe test-mode Checkout Session id");
  }
  const expectedEventId = env.BUYER_DELETION_REPLAY_PROOF_EVENT_ID || null;
  if (expectedEventId && !expectedEventId.startsWith("evt_")) {
    throw new Error("BUYER_DELETION_REPLAY_PROOF_EVENT_ID must start with evt_ when provided");
  }
  return {
    databaseUrl,
    evidencePath: evidencePathFromEnv(env),
    expectedBuyerState: parseExpectedBuyerState(env.BUYER_DELETION_REPLAY_PROOF_EXPECTED_BUYER_STATE),
    expectedEventId,
    secretKey,
    sessionId,
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function createPrismaClient(databaseUrl) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

function stripeObjectId(value) {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function stripeChargeIdFromSession(session) {
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const latestCharge = paymentIntent?.latest_charge ?? null;
  if (typeof latestCharge === "string") return latestCharge;
  return latestCharge?.id ?? null;
}

function buyerStateReason(sourceBuyer) {
  if (!sourceBuyer) return { state: "missing", reason: BUYER_INVALID_REASONS.missing };
  if (sourceBuyer.banned) return { state: "suspended", reason: BUYER_INVALID_REASONS.suspended };
  if (sourceBuyer.deletedAt) return { state: "deleted", reason: BUYER_INVALID_REASONS.deleted };
  return { state: "current", reason: null };
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function metadataValue(metadata, key) {
  const object = jsonObject(metadata);
  return object[key] ?? null;
}

function firstMatchingRefundEvent(order) {
  return order.paymentEvents.find((event) => {
    const metadata = jsonObject(event.metadata);
    return (
      event.eventType === "REFUND" &&
      event.stripeObjectId === order.sellerRefundId &&
      metadata.localAction === BLOCKED_REFUND_ACTION
    );
  }) ?? null;
}

function sanitizedProofSnapshot({
  checkoutAudit,
  config,
  event,
  order,
  refundAudit,
  refundEvent,
  session,
  sourceBuyer,
  sourceBuyerState,
  webhookEvent,
}) {
  const piiFieldsWithValues = order
    ? BUYER_PII_FIELDS.filter((field) => order[field] != null)
    : [];
  const paymentIntentId = stripeObjectId(session?.payment_intent);
  const chargeId = session ? stripeChargeIdFromSession(session) : null;

  return {
    session: {
      idHash: hashValue(config.sessionId),
      livemode: session?.livemode ?? null,
      paymentStatus: session?.payment_status ?? null,
      amountTotalCents: session?.amount_total ?? null,
      currency: session?.currency ?? null,
      checkoutMode: session?.metadata?.cartId ? "cart" : session?.metadata?.listingId ? "single" : "unknown",
      metadataBuyerIdHash: session?.metadata?.buyerId ? hashValue(session.metadata.buyerId) : null,
      paymentIntentIdHash: hashStripeId(paymentIntentId),
      chargeIdHash: hashStripeId(chargeId),
    },
    sourceBuyer: {
      idHash: session?.metadata?.buyerId ? hashValue(session.metadata.buyerId) : null,
      rowFound: Boolean(sourceBuyer),
      state: sourceBuyerState?.state ?? null,
      banned: sourceBuyer?.banned === true,
      deletedAtPresent: Boolean(sourceBuyer?.deletedAt),
    },
    order: order
      ? {
          idHash: hashValue(order.id),
          buyerDetached: order.buyerId == null,
          buyerDataPurged: Boolean(order.buyerDataPurgedAt),
          piiFieldsWithValues,
          paid: Boolean(order.paidAt),
          reviewNeeded: order.reviewNeeded,
          reviewReason: sourceBuyerState?.reason ?? null,
          refundRecorded: Boolean(order.sellerRefundId?.startsWith("re_")),
          refundAmountCents: order.sellerRefundAmountCents ?? null,
          refundLockCleared: order.sellerRefundLockedAt == null,
          paymentIntentMatchesStripe: !paymentIntentId || order.stripePaymentIntentId === paymentIntentId,
          chargeMatchesStripe: !chargeId || order.stripeChargeId === chargeId,
        }
      : null,
    evidence: {
      expectedEventIdHash: config.expectedEventId ? hashValue(config.expectedEventId) : null,
      retrievedEventIdHash: event?.id ? hashValue(event.id) : null,
      checkoutAuditIdHash: checkoutAudit?.id ? hashValue(checkoutAudit.id) : null,
      checkoutAuditActorIdHash: checkoutAudit?.actorId ? hashValue(checkoutAudit.actorId) : null,
      webhookEventProcessed: Boolean(webhookEvent?.processedAt),
      refundEventIdHash: refundEvent?.id ? hashValue(refundEvent.id) : null,
      refundAuditIdHash: refundAudit?.id ? hashValue(refundAudit.id) : null,
    },
  };
}

async function collectProof({ config, prisma, stripe }) {
  const issues = [];
  const session = await stripe.checkout.sessions.retrieve(config.sessionId, {
    expand: ["payment_intent.latest_charge"],
  });
  const paymentIntentId = stripeObjectId(session.payment_intent);
  const chargeId = stripeChargeIdFromSession(session);
  const sessionBuyerId = session.metadata?.buyerId ?? null;

  addIssue(issues, session.livemode === false, "Stripe Checkout Session must be test mode");
  addIssue(issues, session.payment_status === "paid", "Stripe Checkout Session must be paid");
  addIssue(issues, Boolean(sessionBuyerId), "Stripe Checkout Session metadata must retain the original buyerId");

  let retrievedEvent = null;
  if (config.expectedEventId) {
    retrievedEvent = await stripe.events.retrieve(config.expectedEventId);
    addIssue(issues, retrievedEvent.livemode === false, "Stripe event must be test mode");
    addIssue(
      issues,
      retrievedEvent.type === "checkout.session.completed" ||
        retrievedEvent.type === "checkout.session.async_payment_succeeded",
      "Stripe event must be a checkout completion event",
    );
    addIssue(
      issues,
      stripeObjectId(retrievedEvent.data?.object) === config.sessionId,
      "Stripe event object must be the proof Checkout Session",
    );
  }

  const sourceBuyer = sessionBuyerId
    ? await prisma.user.findUnique({
        where: { id: sessionBuyerId },
        select: { id: true, banned: true, deletedAt: true },
      })
    : null;
  const sourceBuyerState = buyerStateReason(sourceBuyer);
  addIssue(
    issues,
    sourceBuyerState.reason != null,
    "Source buyer row must be missing, suspended, or deleted when the replay is processed",
  );
  addIssue(
    issues,
    config.expectedBuyerState === "any-invalid" || sourceBuyerState.state === config.expectedBuyerState,
    `Source buyer state must be ${config.expectedBuyerState}`,
  );

  const order = await prisma.order.findUnique({
    where: { stripeSessionId: config.sessionId },
    select: {
      id: true,
      buyerId: true,
      buyerEmail: true,
      buyerName: true,
      shipToLine1: true,
      shipToLine2: true,
      shipToCity: true,
      shipToState: true,
      shipToPostalCode: true,
      shipToCountry: true,
      quotedToLine1: true,
      quotedToLine2: true,
      quotedToCity: true,
      quotedToState: true,
      quotedToPostalCode: true,
      quotedToCountry: true,
      quotedToName: true,
      quotedToPhone: true,
      giftNote: true,
      shippoShipmentId: true,
      shippoRateObjectId: true,
      buyerDataPurgedAt: true,
      paidAt: true,
      reviewNeeded: true,
      reviewNote: true,
      sellerRefundId: true,
      sellerRefundAmountCents: true,
      sellerRefundLockedAt: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
      stripeSessionId: true,
      paymentEvents: {
        where: { eventType: "REFUND" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          stripeEventId: true,
          stripeObjectId: true,
          stripeObjectType: true,
          eventType: true,
          amountCents: true,
          currency: true,
          status: true,
          reason: true,
          description: true,
          metadata: true,
        },
      },
    },
  });

  addIssue(issues, Boolean(order), "No local Order row was found for the proof Checkout Session");
  let checkoutAudit = null;
  let refundAudit = null;
  let refundEvent = null;
  let webhookEvent = null;

  if (order) {
    const piiFieldsWithValues = BUYER_PII_FIELDS.filter((field) => order[field] != null);
    refundEvent = firstMatchingRefundEvent(order);

    addIssue(issues, order.buyerId == null, "Blocked buyer replay order must not retain buyerId");
    addIssue(issues, piiFieldsWithValues.length === 0, `Blocked buyer replay order retained PII fields: ${piiFieldsWithValues.join(", ")}`);
    addIssue(issues, Boolean(order.buyerDataPurgedAt), "Blocked buyer replay order must stamp buyerDataPurgedAt");
    addIssue(issues, Boolean(order.paidAt), "Blocked buyer replay order must be tied to a paid checkout");
    addIssue(issues, order.reviewNeeded === true, "Blocked buyer replay order must be held for staff review");
    addIssue(
      issues,
      Boolean(order.reviewNote?.includes(BLOCKED_CHECKOUT_REVIEW_MARKER)),
      "Blocked buyer replay reviewNote must include the blocked-checkout review marker",
    );
    addIssue(
      issues,
      !sourceBuyerState.reason || Boolean(order.reviewNote?.includes(sourceBuyerState.reason)),
      "Blocked buyer replay reviewNote must include the source buyer invalid reason",
    );
    addIssue(
      issues,
      Boolean(order.sellerRefundId?.startsWith("re_")),
      "Blocked buyer replay order must record the automatic Stripe refund id",
    );
    addIssue(issues, order.sellerRefundLockedAt == null, "Blocked buyer replay refund lock must be cleared");
    if (typeof session.amount_total === "number") {
      addIssue(
        issues,
        order.sellerRefundAmountCents === session.amount_total,
        "Blocked buyer replay refund amount must match the paid Checkout Session total",
      );
    }
    if (paymentIntentId) {
      addIssue(
        issues,
        order.stripePaymentIntentId === paymentIntentId,
        "Local Order stripePaymentIntentId must match the Stripe Checkout Session payment intent",
      );
    }
    if (chargeId) {
      addIssue(issues, order.stripeChargeId === chargeId, "Local Order stripeChargeId must match the Stripe charge");
    }

    addIssue(issues, Boolean(refundEvent), "Blocked buyer replay must have a BLOCKED_CHECKOUT_REFUND_RECORDED refund ledger row");
    if (refundEvent) {
      const refundMetadata = jsonObject(refundEvent.metadata);
      const refundAccounting = jsonObject(refundMetadata.refundAccounting);
      addIssue(issues, refundEvent.stripeObjectType === "refund", "Refund ledger row must identify a Stripe refund object");
      addIssue(issues, refundEvent.amountCents === order.sellerRefundAmountCents, "Refund ledger amount must match the Order refund amount");
      addIssue(
        issues,
        metadataValue(refundEvent.metadata, "localAction") === BLOCKED_REFUND_ACTION,
        "Refund ledger metadata.localAction must be BLOCKED_CHECKOUT_REFUND_RECORDED",
      );
      addIssue(
        issues,
        refundAccounting.buyerRefundAmountCents === order.sellerRefundAmountCents,
        "Refund ledger accounting evidence must preserve buyer refund amount",
      );
      addIssue(
        issues,
        !["failed", "canceled"].includes(String(refundEvent.status ?? "").toLowerCase()),
        "Refund ledger status must not be failed or canceled",
      );
    }

    checkoutAudit = await prisma.systemAuditLog.findFirst({
      where: {
        action: CHECKOUT_CREATED_ACTION,
        targetType: "ORDER",
        targetId: order.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, actorId: true, actorType: true, reason: true, metadata: true },
    });
    addIssue(issues, Boolean(checkoutAudit), "Checkout-created SystemAuditLog row is missing");
    if (checkoutAudit) {
      addIssue(issues, checkoutAudit.actorType === "webhook", "Checkout-created audit row must be actorType=webhook");
      addIssue(
        issues,
        !sourceBuyerState.reason || checkoutAudit.reason === sourceBuyerState.reason,
        "Checkout-created audit row must preserve the buyer invalid reason",
      );
      addIssue(
        issues,
        metadataValue(checkoutAudit.metadata, "invalidReason") === sourceBuyerState.reason,
        "Checkout-created audit metadata.invalidReason must preserve the buyer invalid reason",
      );
    }

    refundAudit = await prisma.systemAuditLog.findFirst({
      where: {
        action: BLOCKED_REFUND_ACTION,
        targetType: "ORDER",
        targetId: order.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, actorId: true, actorType: true, reason: true, metadata: true },
    });
    addIssue(issues, Boolean(refundAudit), "Blocked-checkout refund SystemAuditLog row is missing");
    if (refundAudit) {
      addIssue(issues, refundAudit.actorType === "webhook", "Blocked-checkout refund audit row must be actorType=webhook");
      addIssue(
        issues,
        !sourceBuyerState.reason || refundAudit.reason === sourceBuyerState.reason,
        "Blocked-checkout refund audit row must preserve the buyer invalid reason",
      );
      addIssue(
        issues,
        metadataValue(refundAudit.metadata, "stripeRefundId") === order.sellerRefundId,
        "Blocked-checkout refund audit metadata must preserve the Stripe refund id",
      );
    }

    const webhookEventId = config.expectedEventId ?? checkoutAudit?.actorId ?? null;
    if (webhookEventId) {
      webhookEvent = await prisma.stripeWebhookEvent.findUnique({
        where: { id: webhookEventId },
        select: { id: true, type: true, processedAt: true, lastError: true },
      });
      addIssue(issues, Boolean(webhookEvent), "StripeWebhookEvent row is missing for the replay event");
      if (webhookEvent) {
        addIssue(
          issues,
          webhookEvent.type === "checkout.session.completed" ||
            webhookEvent.type === "checkout.session.async_payment_succeeded",
          "StripeWebhookEvent must be a checkout completion type",
        );
        addIssue(issues, Boolean(webhookEvent.processedAt), "StripeWebhookEvent must be marked processed");
        addIssue(issues, !webhookEvent.lastError, "StripeWebhookEvent must not retain lastError after replay");
      }
    } else {
      issues.push("No webhook event id was available from env or checkout audit actorId");
    }
  }

  return {
    actionableCount: issues.length,
    proof: sanitizedProofSnapshot({
      checkoutAudit,
      config,
      event: retrievedEvent,
      order,
      refundAudit,
      refundEvent,
      session,
      sourceBuyer,
      sourceBuyerState,
      webhookEvent,
    }),
    issues,
  };
}

export function buildEvidencePayload({ actionableCount, config, issues, proof, startedAt, completedAt, status }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.BUYER_DELETION_REPLAY_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.BUYER_DELETION_REPLAY_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    stripe: {
      apiVersion: STRIPE_API_VERSION,
      mode: "test",
      sessionIdHash: config?.sessionId ? hashValue(config.sessionId) : null,
      expectedEventIdHash: config?.expectedEventId ? hashValue(config.expectedEventId) : null,
    },
    expectedBuyerState: config?.expectedBuyerState ?? null,
    actionableFindingCount: actionableCount,
    proof,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runBuyerDeletionReplayProof(env = process.env) {
  const startedAt = new Date().toISOString();
  const issues = [];
  let actionableCount = 0;
  let config;
  let prisma;
  let proof = null;
  let status = "passed";

  try {
    config = parseConfig(env);
    prisma = createPrismaClient(config.databaseUrl);
    await prisma.$connect();
    const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION });
    const collected = await collectProof({ config, prisma, stripe });
    proof = collected.proof;
    actionableCount = collected.actionableCount;
    issues.push(...collected.issues);
    if (actionableCount > 0) status = "failed";
  } catch (error) {
    status = "failed";
    actionableCount += 1;
    issues.push(safeError(error));
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({
    actionableCount,
    config,
    issues,
    proof,
    startedAt,
    completedAt,
    status,
  });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Buyer-deletion Stripe replay proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuyerDeletionReplayProof()
    .then((payload) => {
      console.log(`Buyer-deletion Stripe replay proof passed with ${payload.actionableFindingCount} actionable findings`);
      console.log(`Buyer-deletion Stripe replay evidence written to ${process.env.BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
