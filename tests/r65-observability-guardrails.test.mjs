import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R65 observability guardrails", () => {
  it("captures cart API exceptions to Sentry after console logging", () => {
    const routes = [
      ["src/app/api/cart/route.ts", "cart_route", "/api/cart"],
      ["src/app/api/cart/add/route.ts", "cart_add_route", "/api/cart/add"],
      ["src/app/api/cart/update/route.ts", "cart_update_route", "/api/cart/update"],
    ];

    for (const [routePath, sourceTag, route] of routes) {
      const text = source(routePath);
      assert.match(text, /import \* as Sentry from "@sentry\/nextjs"/);
      assert.match(text, new RegExp(`Sentry\\.captureException\\(err, \\{ tags: \\{ source: "${sourceTag}", route: "${route}" \\} \\}\\)`));
    }
  });

  it("logs token rejection signals without storing raw tokens", () => {
    const checkout = source("src/app/api/cart/checkout/single/route.ts");
    assert.match(checkout, /logSecurityEvent\("token_rejected"/);
    assert.match(checkout, /reason: "invalid shipping rate token"/);
    assert.match(checkout, /rateVerification\.status === 400/);
    assert.match(checkout, /tokenLength: body\.selectedRate\.token\.length/);
    assert.doesNotMatch(checkout, /token: body\.selectedRate\.token/);

    const unsubscribe = source("src/app/api/email/unsubscribe/route.ts");
    const unsubscribeLogStart = unsubscribe.indexOf("logSecurityEvent(\"token_rejected\"");
    const unsubscribeLog = unsubscribe.slice(
      unsubscribeLogStart,
      unsubscribe.indexOf("if (mode === \"html\")", unsubscribeLogStart),
    );
    assert.match(unsubscribe, /reason: "invalid unsubscribe token"/);
    assert.match(unsubscribeLog, /tokenLength: token\?\.length \?\? 0/);
    assert.doesNotMatch(unsubscribeLog, /\btoken:\s*token\b/);
  });

  it("routes account-state and admin PIN failures through security events", () => {
    const security = source("src/lib/security.ts");
    assert.match(security, /"account_state_violation"/);
    assert.match(security, /"auth_challenge_failed"/);

    const reviews = source("src/app/api/reviews/route.ts");
    assert.match(reviews, /logSecurityEvent\("account_state_violation"/);
    assert.match(reviews, /review target seller banned/);

    const adminPin = source("src/app/api/admin/verify-pin/route.ts");
    assert.match(adminPin, /logSecurityEvent\("auth_challenge_failed"/);
    assert.match(adminPin, /reason: "invalid admin pin"/);
  });

  it("keeps Stripe signature failures to one captured exception plus failure-spike accounting", () => {
    const text = source("src/app/api/stripe/webhook/route.ts");
    const signatureCatch = text.slice(
      text.indexOf("Stripe webhook signature verification failed:"),
      text.indexOf("return NextResponse.json({ error: \"Invalid signature\" }"),
    );

    assert.match(signatureCatch, /Sentry\.captureException\(err, \{ tags: \{ source: "stripe_webhook_signature" \} \}\)/);
    assert.match(signatureCatch, /recordWebhookFailureSpike\(\{ webhook: "stripe", kind: "signature", status: 400 \}\)/);
    assert.doesNotMatch(signatureCatch, /Sentry\.captureMessage\("Stripe webhook signature verification failed"/);
  });
});
