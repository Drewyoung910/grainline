import { prisma } from "@/lib/db";
import { logSecurityEvent } from "@/lib/security";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import { logSystemActionOrThrow } from "@/lib/systemAudit";

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
  const seller = await prisma.sellerProfile.findFirst({
    where: { stripeAccountId: accountId },
    select: {
      id: true,
      chargesEnabled: true,
      stripeAccountId: true,
      user: { select: { id: true, banned: true, deletedAt: true } },
    },
  });

  if (!seller) return { matched: false as const };

  const localAccountActive = !seller.user.banned && !seller.user.deletedAt;
  const effectiveChargesEnabled = chargesEnabled && localAccountActive;
  const result = {
    matched: true as const,
    sellerId: seller.id,
    previousChargesEnabled: seller.chargesEnabled,
    chargesEnabled: effectiveChargesEnabled,
    changed: seller.chargesEnabled !== effectiveChargesEnabled,
    localAccountActive,
  };
  if (!result.changed) return result;

  const auditActorType =
    actorType ?? (route.startsWith("/api/cron/") ? "cron" : route.startsWith("/api/stripe/webhook") ? "webhook" : "system");
  await prisma.$transaction(async (tx) => {
    await tx.sellerProfile.update({
      where: { id: seller.id },
      data: { chargesEnabled: effectiveChargesEnabled },
    });
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
    logSecurityEvent("ownership_violation", {
      userId: seller.user.id,
      route,
      reason: !localAccountActive && chargesEnabled
        ? `Ignored Stripe charges_enabled=true for inactive local account: ${accountId}`
        : `Seller Stripe account disabled by Stripe: ${accountId}`,
    });
    await expireOpenCheckoutSessionsForSeller({
      sellerId: seller.id,
      stripeAccountId: seller.stripeAccountId,
      source: route === "/api/stripe/webhook/v2" ? "stripe_v2_charges_disabled" : "stripe_charges_disabled",
    });
  }

  return result;
}
