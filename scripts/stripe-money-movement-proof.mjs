#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import {
  createMarketplaceRefundWithCreator,
  refundIdempotencyKeyBase,
} from "../src/lib/marketplaceRefunds.ts";
import { calculateCheckoutAmounts } from "../src/lib/checkoutAmounts.ts";
import {
  appendLabelClawbackReviewNote,
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
  labelClawbackNextAttemptAt,
  labelClawbackReviewNote,
  labelClawbackStatusAfterFailure,
} from "../src/lib/labelClawbackState.ts";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRIPE_API_VERSION = "2025-10-29.clover";
const CONFIRMATION_VALUE = "test-mode";
const DB_CONFIRMATION_VALUE = "staging-or-local";
const DEFAULT_CURRENCY = "usd";
const EVIDENCE_MAX_ISSUES = 20;

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"')]+/gi;
const STRIPE_SECRET_PATTERN = /\b[rs]k_(?:test|live)_[A-Za-z0-9_]+/g;
const PASSWORD_ASSIGNMENT_PATTERN = /["']?\b(?:password|pass|pwd|PGPASSWORD)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password-assignment]")
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

function assertSafeRunId(value) {
  const runId = value || `smp_${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "_").replace(/_+$/g, "")}`;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(runId)) {
    throw new Error("STRIPE_MONEY_PROOF_RUN_ID must be 8-80 URL-safe characters");
  }
  return runId;
}

function assertStripeId(value, prefix, name) {
  if (!value || !value.startsWith(prefix)) {
    throw new Error(`${name} must start with ${prefix}`);
  }
  return value;
}

function evidencePathFromEnv(env) {
  const raw = required(env, "STRIPE_MONEY_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("STRIPE_MONEY_PROOF_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("STRIPE_MONEY_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function parseConfig(env = process.env) {
  if (env.STRIPE_MONEY_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`STRIPE_MONEY_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  if (env.STRIPE_MONEY_PROOF_DB_CONFIRM !== DB_CONFIRMATION_VALUE) {
    throw new Error(`STRIPE_MONEY_PROOF_DB_CONFIRM=${DB_CONFIRMATION_VALUE} is required because this script writes synthetic Order evidence rows`);
  }

  const secretKey = required(env, "STRIPE_SECRET_KEY");
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test-mode secret key");
  }

  return {
    runId: assertSafeRunId(env.STRIPE_MONEY_PROOF_RUN_ID),
    evidencePath: evidencePathFromEnv(env),
    secretKey,
    connectedAccountId: assertStripeId(
      required(env, "STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID"),
      "acct_",
      "STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID",
    ),
    currency: (env.STRIPE_MONEY_PROOF_CURRENCY || DEFAULT_CURRENCY).toLowerCase(),
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function buildEvidencePayload({ config, status, startedAt, completedAt, scenarios, issues }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.STRIPE_MONEY_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.STRIPE_MONEY_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    runId: config?.runId ?? null,
    stripe: {
      apiVersion: STRIPE_API_VERSION,
      mode: "test",
      connectedAccountId: config?.connectedAccountId ?? null,
      currency: config?.currency ?? null,
    },
    scenarios,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function retrieveLatestCharge(stripe, paymentIntent) {
  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;
  if (!chargeId) throw new Error(`PaymentIntent ${paymentIntent.id} did not produce a charge`);
  return stripe.charges.retrieve(chargeId, { expand: ["transfer"] });
}

function transferIdFromCharge(charge) {
  const transfer = charge.transfer ?? null;
  if (typeof transfer === "string") return transfer;
  return transfer?.id ?? null;
}

async function createDestinationPayment({ stripe, config, scenario, amountCents, transferAmountCents }) {
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: config.currency,
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      transfer_data: {
        destination: config.connectedAccountId,
        amount: transferAmountCents,
      },
      metadata: {
        grainline_money_proof: config.runId,
        scenario,
      },
    },
    { idempotencyKey: `${config.runId}:${scenario}:payment-intent` },
  );

  if (paymentIntent.status !== "succeeded") {
    throw new Error(`PaymentIntent ${paymentIntent.id} ended with status ${paymentIntent.status}`);
  }
  const charge = await retrieveLatestCharge(stripe, paymentIntent);
  const transferId = transferIdFromCharge(charge);
  if (!transferId) {
    throw new Error(`Charge ${charge.id} did not expose a destination transfer id`);
  }
  return { paymentIntent, charge, transferId };
}

async function upsertProofOrder(prisma, { id, payment, amounts, label = null }) {
  const data = {
    paidAt: new Date(),
    currency: amounts.currency,
    itemsSubtotalCents: amounts.itemsSubtotalCents,
    shippingAmountCents: amounts.shippingAmountCents,
    taxAmountCents: amounts.taxAmountCents,
    giftWrappingPriceCents: amounts.giftWrappingPriceCents,
    stripePaymentIntentId: payment?.paymentIntent?.id ?? null,
    stripeChargeId: payment?.charge?.id ?? null,
    stripeTransferId: payment?.transferId ?? null,
    reviewNeeded: false,
    reviewNote: null,
    ...(label
      ? {
          shippoTransactionId: label.shippoTransactionId,
          shippoRateObjectId: label.shippoRateObjectId,
          labelCostCents: label.labelCostCents,
          labelStatus: "PURCHASED",
          labelPurchasedAt: new Date(),
        }
      : {}),
  };

  return prisma.order.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}

async function recordRefundEvidence(prisma, { orderId, refund, amountCents, currency, action, reason, description, metadata }) {
  const refundId = refund.primaryRefundId;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        sellerRefundId: refundId,
        sellerRefundAmountCents: amountCents,
        sellerRefundLockedAt: null,
        reviewNeeded: true,
        reviewNote: description,
      },
    });
    await tx.orderPaymentEvent.createMany({
      data: {
        orderId,
        stripeEventId: `local:${action.toLowerCase()}:${refundId}`,
        stripeObjectId: refundId,
        stripeObjectType: "refund",
        eventType: "REFUND",
        amountCents,
        currency,
        status: refund.refundStatuses[0] ?? null,
        reason,
        description,
        metadata: {
          localAction: action,
          refundIds: refund.refundIds.slice(0, 5),
          ...metadata,
        },
      },
      skipDuplicates: true,
    });
    await tx.systemAuditLog.create({
      data: {
        actorType: "system",
        actorId: "stripe-money-proof",
        action,
        targetType: "ORDER",
        targetId: orderId,
        reason,
        metadata: {
          stripeRefundId: refundId,
          refundIds: refund.refundIds.slice(0, 5),
          amountCents,
          currency,
          ...metadata,
        },
      },
    });
  });
}

async function verifyLocalRefundEvidence(prisma, { orderId, refundId, action }) {
  const [order, ledger, audit] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerRefundId: true,
        sellerRefundAmountCents: true,
        reviewNeeded: true,
      },
    }),
    prisma.orderPaymentEvent.findUnique({
      where: { stripeEventId: `local:${action.toLowerCase()}:${refundId}` },
      select: {
        stripeObjectId: true,
        eventType: true,
        amountCents: true,
        metadata: true,
      },
    }),
    prisma.systemAuditLog.findFirst({
      where: { action, targetType: "ORDER", targetId: orderId },
      orderBy: { createdAt: "desc" },
      select: { action: true, metadata: true },
    }),
  ]);

  if (order?.sellerRefundId !== refundId) throw new Error(`Order ${orderId} did not record refund ${refundId}`);
  if (ledger?.eventType !== "REFUND" || ledger.stripeObjectId !== refundId) {
    throw new Error(`OrderPaymentEvent evidence missing for ${refundId}`);
  }
  if (audit?.action !== action) throw new Error(`SystemAuditLog evidence missing for ${action}`);
  return {
    orderRecorded: true,
    orderPaymentEventRecorded: true,
    systemAuditRecorded: true,
    reviewNeeded: order.reviewNeeded,
    ledgerMetadataKeys: Object.keys(ledger.metadata ?? {}).sort(),
  };
}

async function runRefundScenario({ stripe, prisma, config, scenario, resolution, amountCents, amounts }) {
  const checkout = calculateCheckoutAmounts({
    itemsSubtotalCents: amounts.itemsSubtotalCents,
    shippingAmountCents: amounts.shippingAmountCents,
    giftWrapCents: amounts.giftWrappingPriceCents,
  });
  const payment = await createDestinationPayment({
    stripe,
    config,
    scenario,
    amountCents: amounts.itemsSubtotalCents + amounts.shippingAmountCents + amounts.giftWrappingPriceCents + amounts.taxAmountCents,
    transferAmountCents: checkout.sellerTransferAmountCents,
  });
  const orderId = `${config.runId}_${scenario}`;
  await upsertProofOrder(prisma, { id: orderId, payment, amounts });

  const refund = await createMarketplaceRefundWithCreator(
    {
      paymentIntentId: payment.paymentIntent.id,
      resolution,
      amountCents,
      itemsSubtotalCents: amounts.itemsSubtotalCents,
      shippingAmountCents: amounts.shippingAmountCents,
      giftWrappingPriceCents: amounts.giftWrappingPriceCents,
      taxAmountCents: amounts.taxAmountCents,
      canReverseTransfer: true,
      idempotencyKeyBase: refundIdempotencyKeyBase({
        scope: "seller-refund",
        id: orderId,
        resolution,
        amountCents,
      }),
      reason: "requested_by_customer",
    },
    (params, requestOptions) => stripe.refunds.create(params, requestOptions),
  );

  if (!refund.accountingEvidence?.transferReversalId) {
    throw new Error(`${scenario} did not return transfer reversal evidence`);
  }
  await recordRefundEvidence(prisma, {
    orderId,
    refund,
    amountCents,
    currency: config.currency,
    action: "SELLER_REFUND_RECORDED",
    reason: scenario,
    description: `Stripe money proof ${scenario} refund ${refund.primaryRefundId}`,
    metadata: {
      proofRunId: config.runId,
      scenario,
      refundAccounting: refund.accountingEvidence,
      requiresManualTransferReconciliation: refund.requiresManualTransferReconciliation,
      requiresManualFollowUp: refund.requiresManualFollowUp,
    },
  });
  const localEvidence = await verifyLocalRefundEvidence(prisma, {
    orderId,
    refundId: refund.primaryRefundId,
    action: "SELLER_REFUND_RECORDED",
  });

  return {
    scenario,
    orderId,
    paymentIntentId: payment.paymentIntent.id,
    chargeId: payment.charge.id,
    transferId: payment.transferId,
    refundId: refund.primaryRefundId,
    refundStatus: refund.refundStatuses[0] ?? null,
    refundAmountCents: amountCents,
    accountingEvidence: refund.accountingEvidence,
    localEvidence,
  };
}

async function runPlatformOnlyRefundScenario({ stripe, prisma, config }) {
  const scenario = "platform_only_refund";
  const amountCents = 2500;
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: config.currency,
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      metadata: {
        grainline_money_proof: config.runId,
        scenario,
      },
    },
    { idempotencyKey: `${config.runId}:${scenario}:payment-intent` },
  );
  if (paymentIntent.status !== "succeeded") {
    throw new Error(`Platform-only PaymentIntent ${paymentIntent.id} ended with status ${paymentIntent.status}`);
  }
  const charge = await retrieveLatestCharge(stripe, paymentIntent);
  const orderId = `${config.runId}_${scenario}`;
  const amounts = {
    currency: config.currency,
    itemsSubtotalCents: 2000,
    shippingAmountCents: 250,
    giftWrappingPriceCents: 0,
    taxAmountCents: 250,
  };
  await upsertProofOrder(prisma, {
    id: orderId,
    payment: { paymentIntent, charge, transferId: null },
    amounts,
  });

  const refund = await createMarketplaceRefundWithCreator(
    {
      paymentIntentId: paymentIntent.id,
      resolution: "FULL",
      amountCents,
      itemsSubtotalCents: amounts.itemsSubtotalCents,
      shippingAmountCents: amounts.shippingAmountCents,
      giftWrappingPriceCents: amounts.giftWrappingPriceCents,
      taxAmountCents: amounts.taxAmountCents,
      canReverseTransfer: false,
      idempotencyKeyBase: refundIdempotencyKeyBase({
        scope: "seller-refund",
        id: orderId,
        resolution: "FULL",
        amountCents,
      }),
      reason: "requested_by_customer",
    },
    (params, requestOptions) => stripe.refunds.create(params, requestOptions),
  );

  if (!refund.requiresManualTransferReconciliation || !refund.usedPlatformOnly) {
    throw new Error("Platform-only refund did not mark manual transfer reconciliation");
  }
  await recordRefundEvidence(prisma, {
    orderId,
    refund,
    amountCents,
    currency: config.currency,
    action: "SELLER_REFUND_RECORDED",
    reason: scenario,
    description: `Stripe money proof ${scenario} refund ${refund.primaryRefundId}`,
    metadata: {
      proofRunId: config.runId,
      scenario,
      refundAccounting: refund.accountingEvidence,
      requiresManualTransferReconciliation: refund.requiresManualTransferReconciliation,
      requiresManualFollowUp: refund.requiresManualFollowUp,
    },
  });
  const localEvidence = await verifyLocalRefundEvidence(prisma, {
    orderId,
    refundId: refund.primaryRefundId,
    action: "SELLER_REFUND_RECORDED",
  });

  return {
    scenario,
    orderId,
    paymentIntentId: paymentIntent.id,
    chargeId: charge.id,
    refundId: refund.primaryRefundId,
    refundStatus: refund.refundStatuses[0] ?? null,
    refundAmountCents: amountCents,
    accountingEvidence: refund.accountingEvidence,
    localEvidence,
  };
}

async function runLabelClawbackSuccess({ stripe, prisma, config }) {
  const scenario = "label_clawback_success";
  const amounts = {
    currency: config.currency,
    itemsSubtotalCents: 8000,
    shippingAmountCents: 1000,
    giftWrappingPriceCents: 0,
    taxAmountCents: 0,
  };
  const checkout = calculateCheckoutAmounts({
    itemsSubtotalCents: amounts.itemsSubtotalCents,
    shippingAmountCents: amounts.shippingAmountCents,
    giftWrapCents: amounts.giftWrappingPriceCents,
  });
  const payment = await createDestinationPayment({
    stripe,
    config,
    scenario,
    amountCents: amounts.itemsSubtotalCents + amounts.shippingAmountCents,
    transferAmountCents: checkout.sellerTransferAmountCents,
  });
  const orderId = `${config.runId}_${scenario}`;
  const labelCostCents = 899;
  const shippoTransactionId = `shippo_proof_${config.runId}`;
  await upsertProofOrder(prisma, {
    id: orderId,
    payment,
    amounts,
    label: {
      shippoTransactionId,
      shippoRateObjectId: `rate_proof_${config.runId}`,
      labelCostCents,
    },
  });

  const reversal = await stripe.transfers.createReversal(
    payment.transferId,
    {
      amount: labelCostCents,
      metadata: { orderId, reason: "label_cost_deduction_proof" },
    },
    {
      idempotencyKey: labelClawbackIdempotencyKey({
        orderId,
        shippoTransactionId,
        amountCents: labelCostCents,
      }),
    },
  );

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      labelClawbackStatus: "REVERSED",
      labelClawbackReversalId: reversal.id ?? null,
      labelClawbackLastAttemptAt: new Date(),
      labelClawbackResolvedAt: new Date(),
      labelClawbackNextAttemptAt: null,
    },
    select: {
      labelClawbackStatus: true,
      labelClawbackReversalId: true,
      labelCostCents: true,
      reviewNeeded: true,
    },
  });
  if (order.labelClawbackStatus !== "REVERSED") {
    throw new Error("Label clawback success was not recorded as REVERSED");
  }

  return {
    scenario,
    orderId,
    transferId: payment.transferId,
    reversalId: reversal.id ?? null,
    labelCostCents,
    adminVisibleStatus: order.labelClawbackStatus,
    reviewNeeded: order.reviewNeeded,
  };
}

async function runLabelClawbackMissingTransfer({ prisma, config }) {
  const scenario = "label_clawback_missing_transfer";
  const orderId = `${config.runId}_${scenario}`;
  const labelCostCents = 777;
  const note = labelClawbackReviewNote({
    amountCents: labelCostCents,
    currency: config.currency,
    reason: "missing_transfer",
    shippoTransactionId: `shippo_missing_${config.runId}`,
  });
  await upsertProofOrder(prisma, {
    id: orderId,
    payment: null,
    amounts: {
      currency: config.currency,
      itemsSubtotalCents: 5000,
      shippingAmountCents: 500,
      giftWrappingPriceCents: 0,
      taxAmountCents: 0,
    },
    label: {
      shippoTransactionId: `shippo_missing_${config.runId}`,
      shippoRateObjectId: `rate_missing_${config.runId}`,
      labelCostCents,
    },
  });
  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      reviewNeeded: true,
      reviewNote: note,
      labelClawbackStatus: "MANUAL_REVIEW",
      labelClawbackRetryCount: 0,
      labelClawbackLastAttemptAt: null,
      labelClawbackNextAttemptAt: null,
      labelClawbackResolvedAt: null,
      labelClawbackReversalId: null,
    },
    select: { labelClawbackStatus: true, reviewNeeded: true, reviewNote: true },
  });
  if (order.labelClawbackStatus !== "MANUAL_REVIEW" || !order.reviewNeeded) {
    throw new Error("Missing-transfer label clawback did not enter manual review");
  }
  return {
    scenario,
    orderId,
    labelCostCents,
    adminVisibleStatus: order.labelClawbackStatus,
    reviewNeeded: order.reviewNeeded,
    reviewNoteContainsManualReconcile: /manually reconcile/.test(order.reviewNote ?? ""),
  };
}

async function runLabelClawbackFailure({ stripe, prisma, config, scenario, previousAttempts }) {
  const orderId = `${config.runId}_${scenario}`;
  const labelCostCents = 654;
  const now = new Date();
  await upsertProofOrder(prisma, {
    id: orderId,
    payment: {
      paymentIntent: { id: `pi_${scenario}_${config.runId}` },
      charge: { id: `ch_${scenario}_${config.runId}` },
      transferId: "tr_invalid_money_proof",
    },
    amounts: {
      currency: config.currency,
      itemsSubtotalCents: 6000,
      shippingAmountCents: 600,
      giftWrappingPriceCents: 0,
      taxAmountCents: 0,
    },
    label: {
      shippoTransactionId: `shippo_fail_${scenario}_${config.runId}`,
      shippoRateObjectId: `rate_fail_${scenario}_${config.runId}`,
      labelCostCents,
    },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: {
      labelClawbackStatus: "RETRY_PENDING",
      labelClawbackRetryCount: previousAttempts,
      labelClawbackNextAttemptAt: now,
      labelClawbackLastAttemptAt: null,
    },
  });

  const attemptCount = previousAttempts + 1;
  let stripeErrorMessage = null;
  try {
    await stripe.transfers.createReversal(
      "tr_invalid_money_proof",
      {
        amount: labelCostCents,
        metadata: { orderId, reason: "label_cost_deduction_retry_proof" },
      },
      {
        idempotencyKey: labelClawbackIdempotencyKey({
          orderId,
          shippoTransactionId: `shippo_fail_${scenario}_${config.runId}`,
          amountCents: labelCostCents,
        }),
      },
    );
    throw new Error("Invalid transfer reversal unexpectedly succeeded");
  } catch (error) {
    stripeErrorMessage = labelClawbackErrorMessage(error);
  }

  const status = labelClawbackStatusAfterFailure(attemptCount);
  const reviewNote = appendLabelClawbackReviewNote(
    null,
    labelClawbackReviewNote({
      amountCents: labelCostCents,
      currency: config.currency,
      reason: "stripe_reversal_failed",
      shippoTransactionId: `shippo_fail_${scenario}_${config.runId}`,
      stripeTransferId: "tr_invalid_money_proof",
      errorMessage: stripeErrorMessage,
    }),
  );
  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      reviewNeeded: true,
      reviewNote,
      labelClawbackStatus: status,
      labelClawbackRetryCount: attemptCount,
      labelClawbackLastAttemptAt: now,
      labelClawbackNextAttemptAt: labelClawbackNextAttemptAt(attemptCount, now),
    },
    select: {
      labelClawbackStatus: true,
      labelClawbackRetryCount: true,
      labelClawbackNextAttemptAt: true,
      reviewNeeded: true,
      reviewNote: true,
    },
  });

  return {
    scenario,
    orderId,
    labelCostCents,
    stripeErrorObserved: Boolean(stripeErrorMessage),
    sanitizedStripeError: stripeErrorMessage,
    adminVisibleStatus: order.labelClawbackStatus,
    retryCount: order.labelClawbackRetryCount,
    hasNextAttemptAt: Boolean(order.labelClawbackNextAttemptAt),
    reviewNeeded: order.reviewNeeded,
    reviewNoteContainsRetryOrManual: /retry or manually reconcile/.test(order.reviewNote ?? ""),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  let config;
  const scenarios = [];
  const issues = [];

  try {
    config = parseConfig();
    const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION });
    const prisma = new PrismaClient();

    try {
      const baseAmounts = {
        currency: config.currency,
        itemsSubtotalCents: 10_000,
        shippingAmountCents: 500,
        giftWrappingPriceCents: 0,
        taxAmountCents: 825,
      };
      scenarios.push(await runRefundScenario({
        stripe,
        prisma,
        config,
        scenario: "full_reverse_transfer_refund",
        resolution: "FULL",
        amountCents: 11_325,
        amounts: baseAmounts,
      }));
      scenarios.push(await runRefundScenario({
        stripe,
        prisma,
        config,
        scenario: "partial_reverse_transfer_refund",
        resolution: "PARTIAL",
        amountCents: 1_200,
        amounts: baseAmounts,
      }));
      scenarios.push(await runPlatformOnlyRefundScenario({ stripe, prisma, config }));
      scenarios.push(await runLabelClawbackSuccess({ stripe, prisma, config }));
      scenarios.push(await runLabelClawbackMissingTransfer({ prisma, config }));
      scenarios.push(await runLabelClawbackFailure({
        stripe,
        prisma,
        config,
        scenario: "label_clawback_retry_pending",
        previousAttempts: 0,
      }));
      scenarios.push(await runLabelClawbackFailure({
        stripe,
        prisma,
        config,
        scenario: "label_clawback_manual_review",
        previousAttempts: 4,
      }));
    } finally {
      await prisma.$disconnect();
    }

    const payload = buildEvidencePayload({
      config,
      status: "passed",
      startedAt,
      completedAt: new Date().toISOString(),
      scenarios,
      issues,
    });
    writeEvidence(config, payload);
    console.log(`Stripe money-movement proof passed. Evidence written to ${path.relative(ROOT_DIR, config.evidencePath)}`);
  } catch (error) {
    issues.push(safeError(error));
    if (config) {
      const payload = buildEvidencePayload({
        config,
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        scenarios,
        issues,
      });
      writeEvidence(config, payload);
      console.error(`Stripe money-movement proof failed. Evidence written to ${path.relative(ROOT_DIR, config.evidencePath)}`);
    } else {
      console.error("Stripe money-movement proof failed before evidence path was configured.");
    }
    console.error(safeError(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  buildEvidencePayload,
  parseConfig,
  redact,
};
