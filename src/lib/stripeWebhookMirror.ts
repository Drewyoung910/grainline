import { prisma } from "@/lib/db";
import { logSecurityEvent } from "@/lib/security";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";

export async function mirrorStripeChargesEnabled({
  accountId,
  chargesEnabled,
  route = "/api/stripe/webhook",
}: {
  accountId: string;
  chargesEnabled: boolean;
  route?: string;
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

  if (!seller) return;

  const localAccountActive = !seller.user.banned && !seller.user.deletedAt;
  const effectiveChargesEnabled = chargesEnabled && localAccountActive;
  if (seller.chargesEnabled === effectiveChargesEnabled) return;

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: { chargesEnabled: effectiveChargesEnabled },
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
}
