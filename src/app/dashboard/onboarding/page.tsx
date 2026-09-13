import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { stripe } from "@/lib/stripe";
import OnboardingWizard from "./OnboardingWizard";
import { mirrorStripeChargesEnabled } from "@/lib/stripeWebhookMirror";
import { logServerError } from "@/lib/serverErrorLogger";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Your Shop",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe_return?: string | string[] }>;
}) {
  const { seller } = await ensureSeller();
  const params = await searchParams;

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
      chargesEnabled: true,
      _count: { select: { listings: true } },
      listings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, title: true, status: true },
      },
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
      const mirrorResult = await mirrorStripeChargesEnabled({
        accountId: sp.stripeAccountId,
        chargesEnabled: account.charges_enabled ?? false,
        route: "/dashboard/onboarding",
      });
      chargesEnabled = mirrorResult.matched
        ? mirrorResult.chargesEnabled
        : (account.charges_enabled ?? false);
    } catch (error) {
      logServerError(error, {
        source: "onboarding_stripe_connect_status_refresh",
        extra: { sellerId: seller.id, hasStripeAccountId: true },
      });
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
      stripeReturn={params.stripe_return != null}
      listingCount={sp._count.listings}
      latestListing={sp.listings[0] ?? null}
    />
  );
}
