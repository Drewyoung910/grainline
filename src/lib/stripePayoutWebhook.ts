import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { payoutFailureState } from "@/lib/stripeWebhookState";

/**
 * Applies one authenticated payout.failed event to Grainline's durable payout
 * projection. Signature verification and StripeWebhookEvent lease ownership
 * stay with the caller so the classic platform and Connect endpoints cannot
 * accidentally accept one another's signing secrets.
 */
export async function processStripePayoutFailedEvent(event: Stripe.Event) {
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

  const seller = await prisma.sellerProfile.findFirst({
    where: { stripeAccountId: accountId },
    select: { id: true, userId: true },
  });
  if (!seller) return;

  const payoutFailure = payoutFailureState(payout, event.id);
  const { stripePayoutId, ...payoutEventData } = payoutFailure.event;
  const payoutEvent = await prisma.sellerPayoutEvent.upsert({
    where: { stripePayoutId },
    create: {
      sellerProfileId: seller.id,
      stripePayoutId,
      ...payoutEventData,
    },
    update: payoutEventData,
  });
  await createNotification({
    userId: seller.userId,
    ...payoutFailure.notification,
    sourceType: NOTIFICATION_SOURCE_TYPES.STRIPE_PAYOUT_FAILURE,
    sourceId: payoutEvent.id,
  });
}
