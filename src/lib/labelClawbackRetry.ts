import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { stripe as defaultStripe } from "@/lib/stripe";
import {
  appendLabelClawbackReviewNote,
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
  labelClawbackNextAttemptAt,
  labelClawbackReviewNote,
  labelClawbackStatusAfterFailure,
  type LabelClawbackFailureReason,
} from "@/lib/labelClawbackState";

type StripeTransferReversalClient = {
  transfers: {
    createReversal: (
      transferId: string,
      params: { amount: number; metadata: Record<string, string> },
      options: { idempotencyKey: string },
    ) => Promise<{ id?: string | null }>;
  };
};

const LABEL_CLAWBACK_RETRY_STALE_MS = 30 * 60 * 1000;

export async function markLabelClawbackForReview(opts: {
  orderId: string;
  existingReviewNote?: string | null;
  amountCents: number;
  currency?: string | null;
  reason: LabelClawbackFailureReason;
  shippoTransactionId?: string | null;
  stripeTransferId?: string | null;
  errorMessage?: string | null;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const failedAttempts = opts.reason === "stripe_reversal_failed" ? 1 : 0;
  const note = appendLabelClawbackReviewNote(
    opts.existingReviewNote,
    labelClawbackReviewNote(opts),
  );

  return prisma.order.update({
    where: { id: opts.orderId },
    data: {
      reviewNeeded: true,
      reviewNote: note,
      labelClawbackStatus: opts.reason === "missing_transfer"
        ? "MANUAL_REVIEW"
        : labelClawbackStatusAfterFailure(failedAttempts),
      labelClawbackRetryCount: failedAttempts,
      labelClawbackLastAttemptAt: opts.reason === "stripe_reversal_failed" ? now : null,
      labelClawbackNextAttemptAt: opts.reason === "stripe_reversal_failed"
        ? labelClawbackNextAttemptAt(failedAttempts, now)
        : null,
      labelClawbackResolvedAt: null,
      labelClawbackReversalId: null,
    },
  });
}

export async function recordSuccessfulLabelClawback(opts: {
  orderId: string;
  reversalId?: string | null;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  return prisma.order.update({
    where: { id: opts.orderId },
    data: {
      labelClawbackStatus: "REVERSED",
      labelClawbackReversalId: opts.reversalId ?? null,
      labelClawbackLastAttemptAt: now,
      labelClawbackResolvedAt: now,
      labelClawbackNextAttemptAt: null,
    },
  });
}

export async function processLabelClawbackRetryBatch(opts: {
  take?: number;
  now?: Date;
  stripeClient?: StripeTransferReversalClient;
} = {}) {
  const now = opts.now ?? new Date();
  const take = Math.max(1, Math.min(opts.take ?? 10, 50));
  const stripeClient = opts.stripeClient ?? defaultStripe;
  const staleRetryCutoff = new Date(now.getTime() - LABEL_CLAWBACK_RETRY_STALE_MS);

  const orders = await prisma.order.findMany({
    where: {
      labelStatus: "PURCHASED",
      labelCostCents: { gt: 0 },
      stripeTransferId: { not: null },
      OR: [
        { labelClawbackStatus: "RETRY_PENDING", labelClawbackNextAttemptAt: { lte: now } },
        { labelClawbackStatus: "RETRYING", labelClawbackLastAttemptAt: { lte: staleRetryCutoff } },
      ],
    },
    orderBy: [
      { labelClawbackNextAttemptAt: "asc" },
      { labelPurchasedAt: "asc" },
      { createdAt: "asc" },
    ],
    take,
    select: {
      id: true,
      reviewNote: true,
      shippoTransactionId: true,
      shippoRateObjectId: true,
      stripeTransferId: true,
      labelCostCents: true,
      labelClawbackStatus: true,
      labelClawbackRetryCount: true,
      currency: true,
    },
  });

  const result = {
    ok: true,
    scanned: orders.length,
    attempted: 0,
    reversed: 0,
    failed: 0,
    manualReview: 0,
    skipped: 0,
  };

  for (const order of orders) {
    const attemptCount = order.labelClawbackStatus === "RETRYING"
      ? Math.max(1, order.labelClawbackRetryCount)
      : order.labelClawbackRetryCount + 1;
    const claim = await prisma.order.updateMany({
      where: {
        id: order.id,
        labelStatus: "PURCHASED",
        labelCostCents: { gt: 0 },
        stripeTransferId: { not: null },
        OR: [
          { labelClawbackStatus: "RETRY_PENDING", labelClawbackNextAttemptAt: { lte: now } },
          { labelClawbackStatus: "RETRYING", labelClawbackLastAttemptAt: { lte: staleRetryCutoff } },
        ],
      },
      data: {
        labelClawbackStatus: "RETRYING",
        labelClawbackRetryCount: attemptCount,
        labelClawbackLastAttemptAt: now,
      },
    });
    if (claim.count !== 1 || !order.stripeTransferId || !order.labelCostCents) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    try {
      const reversal = await stripeClient.transfers.createReversal(order.stripeTransferId, {
        amount: order.labelCostCents,
        metadata: { orderId: order.id, reason: "label_cost_deduction_retry" },
      }, {
        idempotencyKey: labelClawbackIdempotencyKey({
          orderId: order.id,
          shippoTransactionId: order.shippoTransactionId,
          shippoRateObjectId: order.shippoRateObjectId,
          amountCents: order.labelCostCents,
        }),
      });

      await recordSuccessfulLabelClawback({
        orderId: order.id,
        reversalId: reversal.id ?? null,
        now: new Date(),
      });
      result.reversed += 1;
    } catch (error) {
      const status = labelClawbackStatusAfterFailure(attemptCount);
      const nextAttemptAt = labelClawbackNextAttemptAt(attemptCount, now);
      const errorMessage = labelClawbackErrorMessage(error);
      const reviewNote = appendLabelClawbackReviewNote(
        order.reviewNote,
        labelClawbackReviewNote({
          amountCents: order.labelCostCents,
          currency: order.currency,
          reason: "stripe_reversal_failed",
          shippoTransactionId: order.shippoTransactionId,
          stripeTransferId: order.stripeTransferId,
          errorMessage,
        }),
      );

      await prisma.order.update({
        where: { id: order.id },
        data: {
          reviewNeeded: true,
          reviewNote,
          labelClawbackStatus: status,
          labelClawbackNextAttemptAt: nextAttemptAt,
          labelClawbackLastAttemptAt: now,
        },
      });
      result.failed += 1;
      if (status === "MANUAL_REVIEW") result.manualReview += 1;
      Sentry.captureException(error, {
        tags: { source: "label_cost_clawback_retry", status },
        extra: { orderId: order.id, stripeTransferId: order.stripeTransferId, labelCostCents: order.labelCostCents, attemptCount },
      });
    }
  }

  return result;
}
