import * as Sentry from "@sentry/nextjs";
import { stripe as defaultStripe } from "@/lib/stripe";
import {
  claimLabelClawbackBatch,
  finalizeLabelClawback,
} from "@/lib/orderLabelAuthority";
import { settleLabelClawback, type LabelClawbackStripeClient } from "@/lib/labelClawbackProvider";

/**
 * Claims retry work through the fixed SKIP LOCKED operation and finalizes only
 * the exact returned generation. Runtime code never scans or mutates Order
 * rows directly, which keeps this worker valid after Order RLS activation.
 */
export async function processLabelClawbackRetryBatch(opts: {
  take?: number;
  stripeClient?: LabelClawbackStripeClient;
  now?: () => number;
} = {}) {
  const take = Math.max(1, Math.min(opts.take ?? 10, 50));
  if (!Number.isSafeInteger(take)) throw new TypeError("Label clawback batch limit is invalid");
  const stripeClient = opts.stripeClient ?? defaultStripe;
  const now = opts.now ?? Date.now;
  const deadline = now() + 45_000;
  const result = {
    ok: true,
    scanned: 0,
    attempted: 0,
    reversed: 0,
    failed: 0,
    manualReview: 0,
    skipped: 0,
  };

  // Claim near execution. Do not strand ten rows behind one slow provider call.
  // Reserve 10s for a bounded POST and local acknowledgement.
  while (result.scanned < take && now() + 10_000 <= deadline) {
    const [claim] = await claimLabelClawbackBatch(1);
    if (!claim) break;
    result.scanned += 1;
    result.attempted += 1;
    const { finalized, providerFailed, providerError } = await settleLabelClawback(
      claim, stripeClient, finalizeLabelClawback, { now, deadline },
    );
    if (!providerFailed) {
      if (finalized.outcome === "finalized") result.reversed += 1;
      else result.skipped += 1;
    } else {
      if (finalized.outcome === "recorded_failure") {
        result.failed += 1;
        if (finalized.clawbackStatus === "MANUAL_REVIEW") result.manualReview += 1;
      } else {
        result.skipped += 1;
      }
      Sentry.captureException(providerError, {
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
