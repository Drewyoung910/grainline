import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  safeStripeRedirectUrl,
} = await import("../src/lib/stripeRedirect.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Stripe redirect state", () => {
  it("allows only HTTPS Stripe-owned Connect redirect hosts", () => {
    assert.equal(
      safeStripeRedirectUrl("https://connect.stripe.com/setup/s/acct_123"),
      "https://connect.stripe.com/setup/s/acct_123",
    );
    assert.equal(
      safeStripeRedirectUrl("https://dashboard.stripe.com/express/oauth/authorize"),
      "https://dashboard.stripe.com/express/oauth/authorize",
    );

    assert.equal(safeStripeRedirectUrl("http://connect.stripe.com/setup/s/acct_123"), null);
    assert.equal(safeStripeRedirectUrl("https://connect.stripe.com.evil.test/setup"), null);
    assert.equal(safeStripeRedirectUrl("https://evil.test/redirect?next=connect.stripe.com"), null);
    assert.equal(safeStripeRedirectUrl("/api/stripe/connect/create"), null);
    assert.equal(safeStripeRedirectUrl(null), null);
  });

  it("keeps client Stripe navigations behind the redirect allowlist", () => {
    const connectButton = source("src/app/dashboard/seller/StripeConnectButton.tsx");
    const loginButton = source("src/app/dashboard/seller/StripeLoginButton.tsx");
    const onboarding = source("src/app/dashboard/onboarding/OnboardingWizard.tsx");

    assert.match(connectButton, /safeStripeRedirectUrl\(data\.url\)/);
    assert.match(loginButton, /safeStripeRedirectUrl\(data\.url\)/);
    assert.match(onboarding, /safeStripeRedirectUrl\(data\.url\)/);
    assert.match(loginButton, /window\.open\(redirectUrl, "_blank", "noopener,noreferrer"\)/);
    assert.doesNotMatch(connectButton, /window\.location\.href = data\.url/);
    assert.doesNotMatch(onboarding, /window\.location\.href = data\.url/);
    assert.doesNotMatch(loginButton, /window\.open\(data\.url/);
  });
});
