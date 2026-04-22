import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { stripe } from "@/lib/stripe";
import OnboardingWizard from "./OnboardingWizard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Your Shop",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const { seller } = await ensureSeller();

  const sp = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
    select: {
      onboardingStep: true,
      onboardingComplete: true,
      displayName: true,
      bio: true,
      tagline: true,
      avatarImageUrl: true,
      yearsInBusiness: true,
      city: true,
      state: true,
      returnPolicy: true,
      shippingPolicy: true,
      acceptsCustomOrders: true,
      stripeAccountId: true,
      _count: { select: { listings: true } },
    },
  });

  if (!sp || sp.onboardingComplete) {
    redirect("/dashboard");
  }

  // Check actual Stripe account status (charges_enabled), not just whether an account ID exists
  let chargesEnabled = false;
  let hasStripeAccount = !!sp.stripeAccountId;
  if (sp.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(sp.stripeAccountId);
      chargesEnabled = account.charges_enabled ?? false;
      // Persist charges_enabled status to DB
      await prisma.sellerProfile.update({
        where: { id: seller.id },
        data: { chargesEnabled },
      });
    } catch {
      // Stripe account may be invalid; treat as not connected
      hasStripeAccount = false;
    }
  }

  return (
    <OnboardingWizard
      initialStep={sp.onboardingStep}
      displayName={sp.displayName}
      bio={sp.bio}
      tagline={sp.tagline}
      avatarImageUrl={sp.avatarImageUrl}
      yearsInBusiness={sp.yearsInBusiness}
      city={sp.city}
      state={sp.state}
      returnPolicy={sp.returnPolicy}
      shippingPolicy={sp.shippingPolicy}
      acceptsCustomOrders={sp.acceptsCustomOrders}
      hasStripeAccount={hasStripeAccount}
      chargesEnabled={chargesEnabled}
      listingCount={sp._count.listings}
    />
  );
}
