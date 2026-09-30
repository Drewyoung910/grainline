import * as Sentry from "@sentry/nextjs";
import { stripe as defaultStripe } from "@/lib/stripe";
import {
  claimOrderDisputeRecoveryBatch,
  finalizeOrderDisputeRecovery,
} from "@/lib/orderDisputeRecoveryAuthority";
import {
  disputeRecoveryErrorSummary,
  settleOrderDisputeRecovery,
  type OrderDisputeRecoveryStripeClient,
} from "@/lib/orderDisputeRecoveryProvider";

const WORKER_WINDOW_MS = 45_000;
const MINIMUM_PROVIDER_BUDGET_MS = 20_000;

export async function processOrderDisputeRecoveryBatch(opts: {
  take?: number;
  stripeClient?: OrderDisputeRecoveryStripeClient;
  now?: () => number;
} = {}) {
  const take = opts.take ?? 10;
  if (!Number.isSafeInteger(take) || take < 1 || take > 50) {
    throw new TypeError("Order dispute recovery batch limit is invalid");
  }
  const stripeClient = opts.stripeClient ?? defaultStripe;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("Order dispute recovery worker clock is invalid");
  }
  const deadline = startedAt + WORKER_WINDOW_MS;
  const result = {
    ok: true,
    scanned: 0,
    finalized: 0,
    failed: 0,
    manualReview: 0,
    skipped: 0,
  };

  // Claim immediately before each provider operation. A reversal can need
  // three bounded Stripe calls, so preserve enough time for provider work and
  // the local generation-fenced acknowledgement.
  while (result.scanned < take && now() + MINIMUM_PROVIDER_BUDGET_MS <= deadline) {
    const [claim] = await claimOrderDisputeRecoveryBatch(1);
    if (!claim) break;
    result.scanned += 1;

    const { finalized, providerFailed, providerError } =
      await settleOrderDisputeRecovery(
        claim,
        stripeClient,
        finalizeOrderDisputeRecovery,
      );
    if (!providerFailed) {
      if (finalized.outcome === "finalized") result.finalized += 1;
      else result.skipped += 1;
      continue;
    }

    if (finalized.outcome === "recorded_failure") {
      result.failed += 1;
      if (finalized.status === "MANUAL_REVIEW") result.manualReview += 1;
    } else {
      result.skipped += 1;
    }
    Sentry.captureMessage("Stripe dispute seller-funds recovery failed", {
      level: "warning",
      tags: { source: "order_dispute_recovery_retry" },
      extra: {
        recoveryId: claim.recoveryId,
        orderId: claim.orderId,
        disputeId: claim.disputeId,
        action: claim.action,
        attemptCount: claim.attemptCount,
        error: disputeRecoveryErrorSummary(providerError),
      },
    });
  }
  return result;
}
