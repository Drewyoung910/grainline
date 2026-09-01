import * as Sentry from "@sentry/nextjs";
import { stripe as defaultStripe } from "@/lib/stripe";
import {
  claimLabelClawbackBatch,
  finalizeLabelClawback,
} from "@/lib/orderLabelAuthority";
import {
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
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

/**
 * Claims retry work through the fixed SKIP LOCKED operation and finalizes only
 * the exact returned generation. Runtime code never scans or mutates Order
 * rows directly, which keeps this worker valid after Order RLS activation.
 */
export async function processLabelClawbackRetryBatch(opts: {
  take?: number;
  stripeClient?: StripeTransferReversalClient;
} = {}) {
  const take = Math.max(1, Math.min(opts.take ?? 10, 50));
  const stripeClient = opts.stripeClient ?? defaultStripe;
  const claims = await claimLabelClawbackBatch(take);
  const result = {
    ok: true,
    scanned: claims.length,
    attempted: 0,
    reversed: 0,
    failed: 0,
    manualReview: 0,
    skipped: 0,
  };

  for (const claim of claims) {
    result.attempted += 1;
    try {
      const reversal = await stripeClient.transfers.createReversal(
        claim.stripeTransferId,
        {
          amount: claim.amountCents,
          metadata: { orderId: claim.orderId, reason: "label_cost_deduction_retry" },
        },
        {
          idempotencyKey: labelClawbackIdempotencyKey({
            orderId: claim.orderId,
            shippoTransactionId: claim.transactionId,
            shippoRateObjectId: claim.rateObjectId,
            amountCents: claim.amountCents,
          }),
        },
      );
      const finalized = await finalizeLabelClawback({
        orderId: claim.orderId,
        claimId: claim.claimId,
        claimGeneration: claim.claimGeneration,
        clawbackGeneration: claim.clawbackGeneration,
        outcome: "SUCCESS",
        reversalId: reversal.id ?? null,
      });
      if (finalized.outcome === "finalized") result.reversed += 1;
      else result.skipped += 1;
    } catch (error) {
      const finalized = await finalizeLabelClawback({
        orderId: claim.orderId,
        claimId: claim.claimId,
        claimGeneration: claim.claimGeneration,
        clawbackGeneration: claim.clawbackGeneration,
        outcome: "FAILED",
        errorSummary: labelClawbackErrorMessage(error),
      });
      if (finalized.outcome === "recorded_failure") {
        result.failed += 1;
        if (finalized.clawbackStatus === "MANUAL_REVIEW") result.manualReview += 1;
      } else {
        result.skipped += 1;
      }
      Sentry.captureException(error, {
        tags: { source: "label_cost_clawback_retry" },
        extra: {
          orderId: claim.orderId,
          claimId: claim.claimId,
          attemptCount: claim.attemptCount,
        },
      });
    }
  }
  return result;
}
