import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { createNotificationOrThrow } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { applySellerPayoutFailure } from "@/lib/sellerPayoutEventAuthority";
import { payoutFailureState } from "@/lib/stripeWebhookState";

/**
 * Applies one authenticated payout.failed event to Grainline's durable payout
 * projection. Signature verification and StripeWebhookEvent lease ownership
 * stay with the caller so the classic platform and Connect endpoints cannot
 * accidentally accept one another's signing secrets.
 */
export async function processStripePayoutFailedEvent(
  event: Stripe.Event,
  claimGeneration: bigint,
) {
  if (event.type !== "payout.failed") {
    throw new Error("Stripe payout handler received an unexpected event type.");
  }

  const accountId = typeof event.account === "string" ? event.account : null;
  if (!accountId) {
    throw new Error("Stripe payout.failed event is missing its connected account id.");
  }

  const payout = event.data.object as Stripe.Payout;
  if (!payout || typeof payout.id !== "string" || payout.id.length === 0) {
    throw new Error("Stripe payout.failed event is missing its payout id.");
  }
  if (!Number.isSafeInteger(event.created) || event.created < 1) {
    throw new Error("Stripe payout.failed event has an invalid creation time.");
  }

  const payoutFailure = payoutFailureState(payout, event.id);
  const result = await applySellerPayoutFailure({
    eventId: event.id,
    claimGeneration,
    eventCreatedSeconds: BigInt(event.created),
    connectedAccountId: accountId,
    payoutId: payoutFailure.event.stripePayoutId,
    amountCents: payoutFailure.event.amountCents,
    currency: payoutFailure.event.currency,
    failureCode: payoutFailure.event.failureCode,
    failureMessage: payoutFailure.event.failureMessage,
  });

  if (result.action === "ignored_unknown_account") {
    Sentry.captureMessage("Stripe payout event ignored for an unknown connected account", {
      level: "warning",
      tags: { source: "stripe_payout_unknown_connected_account" },
    });
    return result;
  }
  if (result.action === "stale_ignored") return result;
  if (!result.sellerUserId || !result.payoutEventId) {
    throw new Error("Seller payout authority returned an incomplete notification source.");
  }

  await createNotificationOrThrow({
    userId: result.sellerUserId,
    ...payoutFailure.notification,
    sourceType: NOTIFICATION_SOURCE_TYPES.STRIPE_PAYOUT_FAILURE,
    sourceId: result.payoutEventId,
  });
  return result;
}
