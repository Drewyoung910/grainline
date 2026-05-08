import { prisma } from "@/lib/db";
import { logSecurityEvent } from "@/lib/security";

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
      user: { select: { id: true } },
    },
  });

  if (!seller || seller.chargesEnabled === chargesEnabled) return;

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: { chargesEnabled },
  });

  if (!chargesEnabled) {
    logSecurityEvent("ownership_violation", {
      userId: seller.user.id,
      route,
      reason: `Seller Stripe account disabled by Stripe: ${accountId}`,
    });
  }
}
