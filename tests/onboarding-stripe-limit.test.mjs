import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

async function renderOnboarding({ allowed, localChargesEnabled = false }) {
  let stripeCalls = 0;
  const page = loadWithStubs("src/app/dashboard/onboarding/page.tsx", {
    "next/navigation": { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    "@/lib/ensureSeller": { ensureSeller: async () => ({ seller: { id: "seller-1", userId: "user-1" } }) },
    "@/lib/sellerOwnerPrivateAccess": {
      sellerOwnerOnboardingState: async () => ({
        onboardingComplete: false,
        stripeAccountId: "acct_1",
        chargesEnabled: localChargesEnabled,
        _count: { listings: 0 },
        listings: [],
      }),
    },
    "@/lib/stripe": {
      stripe: { accounts: { retrieve: async () => { stripeCalls += 1; return { charges_enabled: true }; } } },
    },
    "@/lib/stripeWebhookMirror": {
      mirrorStripeChargesEnabled: async ({ chargesEnabled }) => ({ matched: true, chargesEnabled }),
    },
    "@/lib/ratelimit": {
      stripeConnectRatelimit: "stripe-connect",
      safeRateLimit: async () => ({ success: allowed }),
    },
  });
  const element = await page.default({ searchParams: Promise.resolve({}) });
  return { stripeCalls, props: element.props };
}

test("onboarding asks Stripe when within the limit", async () => {
  const { stripeCalls, props } = await renderOnboarding({ allowed: true });
  assert.equal(stripeCalls, 1);
  assert.equal(props.chargesEnabled, true);
});

test("repeated onboarding loads over the limit use the saved status and do not call Stripe", async () => {
  const { stripeCalls, props } = await renderOnboarding({ allowed: false, localChargesEnabled: true });
  assert.equal(stripeCalls, 0);
  assert.equal(props.chargesEnabled, true);
  assert.equal(props.hasStripeAccount, true);
});
