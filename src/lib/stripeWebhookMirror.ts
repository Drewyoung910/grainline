import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { renderShopPausedEmail, sendRenderedEmail } from "@/lib/email";
import { userEmailDeliveryRecipient } from "@/lib/userEmailDeliveryAccess";
import { logSecurityEvent } from "@/lib/security";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import {
  sellerStripeMirrorState,
  updateSellerStripeChargesEnabled,
} from "@/lib/sellerStripePrivateAccess";

type StripeAccountMirrorActorType = "cron" | "webhook" | "system";

export async function mirrorStripeChargesEnabled({
  accountId,
  chargesEnabled,
  route = "/api/stripe/webhook",
  actorType,
  actorId,
}: {
  accountId: string;
  chargesEnabled: boolean;
  route?: string;
  actorType?: StripeAccountMirrorActorType;
  actorId?: string | null;
}) {
  const seller = await sellerStripeMirrorState(accountId);

  if (!seller) return { matched: false as const };

  const localAccountActive = seller.ownerAccountActive === true;
  const effectiveChargesEnabled = chargesEnabled && localAccountActive;
  const result = {
    matched: true as const,
    sellerId: seller.id,
    previousChargesEnabled: seller.chargesEnabled,
    chargesEnabled: effectiveChargesEnabled,
    changed: seller.chargesEnabled !== effectiveChargesEnabled,
    localAccountActive,
  };
  if (!localAccountActive && chargesEnabled) {
    logSecurityEvent("ownership_violation", {
      userId: seller.userId,
      route,
      reason: `Ignored Stripe charges_enabled=true for inactive local account: ${accountId}`,
    });
  }
  if (!result.changed) return result;

  const auditActorType =
    actorType ?? (route.startsWith("/api/cron/") ? "cron" : route.startsWith("/api/stripe/webhook") ? "webhook" : "system");
  await prisma.$transaction(async (tx) => {
    await updateSellerStripeChargesEnabled(
      tx,
      seller.id,
      accountId,
      effectiveChargesEnabled,
    );
    await logSystemActionOrThrow({
      client: tx,
      actorType: auditActorType,
      actorId: actorId ?? null,
      action: "STRIPE_ACCOUNT_CHARGES_UPDATED",
      targetType: "SELLER_PROFILE",
      targetId: seller.id,
      metadata: {
        route,
        stripeAccountId: accountId,
        stripeChargesEnabled: chargesEnabled,
        previousChargesEnabled: seller.chargesEnabled,
        chargesEnabled: effectiveChargesEnabled,
        localAccountActive,
      },
    });
  });
  revalidatePublicSellerVisibilityCaches();

  if (!effectiveChargesEnabled) {
    if (!chargesEnabled || localAccountActive) {
      logSecurityEvent("ownership_violation", {
        userId: seller.userId,
        route,
        reason: `Seller Stripe account disabled by Stripe: ${accountId}`,
      });
    }
    await expireOpenCheckoutSessionsForSeller({
      sellerId: seller.id,
      stripeAccountId: seller.stripeAccountId,
      source: route === "/api/stripe/webhook/v2" ? "stripe_v2_charges_disabled" : "stripe_charges_disabled",
    });
    // Their shop just disappeared. A banned account is told through the ban instead.
    if (localAccountActive) {
      try {
        const recipient = await userEmailDeliveryRecipient(prisma, { userId: seller.userId });
        if (recipient) {
          await sendRenderedEmail(renderShopPausedEmail({ to: recipient.email, name: recipient.name }));
        }
      } catch (error) {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "stripe_charges_disabled_email" },
          extra: { sellerId: seller.id },
        });
      }
    }
  }

  return result;
}
