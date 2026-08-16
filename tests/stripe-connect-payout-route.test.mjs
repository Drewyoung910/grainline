import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Stripe classic Connect payout webhook authority", () => {
  const route = source("src/app/api/stripe/webhook/connect/route.ts");
  const platformRoute = source("src/app/api/stripe/webhook/route.ts");
  const payoutHandler = source("src/lib/stripePayoutWebhook.ts");

  it("keeps all three webhook signing protocols isolated", () => {
    assert.match(route, /process\.env\.STRIPE_CONNECT_WEBHOOK_SECRET/);
    assert.match(route, /stripe\.webhooks\.constructEvent\(body, signature, secret\)/);
    assert.doesNotMatch(route, /STRIPE_V2_WEBHOOK_SECRET/);
    assert.doesNotMatch(route, /process\.env\.STRIPE_WEBHOOK_SECRET/);
    assert.doesNotMatch(route, /parseEventNotification/);

    assert.match(platformRoute, /process\.env\.STRIPE_WEBHOOK_SECRET/);
    assert.doesNotMatch(platformRoute, /STRIPE_CONNECT_WEBHOOK_SECRET/);
    assert.doesNotMatch(platformRoute, /STRIPE_V2_WEBHOOK_SECRET/);
  });

  it("bounds and verifies the raw payload before accepting any event", () => {
    assert.match(route, /readBoundedText\(req, STRIPE_CONNECT_WEBHOOK_BODY_MAX_BYTES\)/);
    assert.match(route, /isRequestBodyTooLargeError/);
    assert.match(route, /Payload too large/);
    assert.doesNotMatch(route, /await req\.text\(\)/);
    assert.ok(
      route.indexOf("readBoundedText(req, STRIPE_CONNECT_WEBHOOK_BODY_MAX_BYTES)") <
        route.indexOf("stripe.webhooks.constructEvent(body, signature, secret)"),
    );
    assert.match(route, /Missing Stripe signature/);
    assert.match(route, /Invalid signature/);
    assert.match(route, /sanitizeEmailOutboxError\(error\)/);
  });

  it("acknowledges unexpected signed events before durable lease acquisition", () => {
    const ignored = route.indexOf('if (event.type !== "payout.failed")');
    const lease = route.indexOf("beginStripeWebhookEvent(");
    assert.ok(ignored >= 0 && lease > ignored);
    assert.match(
      route.slice(ignored, lease),
      /return NextResponse\.json\(\{ received: true, ignored: true \}\)/,
    );
  });

  it("fails stale events and uses generation-bound begin, complete, and fail operations", () => {
    assert.match(route, /isStaleStripeEvent\(eventCreatedSeconds\)/);
    assert.match(
      route,
      /beginStripeWebhookEvent\(\s*event\.id,\s*event\.type,\s*sourceObjectId,\s*\)/,
    );
    assert.match(route, /reservation\.action === "processed"/);
    assert.match(route, /reservation\.action === "in_progress"/);
    assert.match(route, /const claimGeneration = reservation\.claimGeneration/);
    assert.match(route, /"Retry-After": String\(STRIPE_CONNECT_WEBHOOK_RETRY_AFTER_SECONDS\)/);
    assert.match(route, /markStripeWebhookEventProcessed\(event\.id, claimGeneration\)/);
    assert.match(route, /markStripeWebhookEventFailed\(event\.id, claimGeneration, error\)/);
    assert.match(route, /webhook: "stripe_connect"/);
  });

  it("shares one source-validating and payout-idempotent mutation handler", () => {
    assert.match(route, /await processStripePayoutFailedEvent\(event, claimGeneration\)/);
    assert.match(platformRoute, /await processStripePayoutFailedEvent\(event, claimGeneration\)/);
    assert.equal(
      (platformRoute.match(/processStripePayoutFailedEvent\(event, claimGeneration\)/g) ?? []).length,
      1,
    );

    assert.match(payoutHandler, /if \(event\.type !== "payout.failed"\)/);
    assert.match(payoutHandler, /typeof event\.account === "string"/);
    assert.match(payoutHandler, /missing its connected account id/);
    assert.match(payoutHandler, /typeof payout\.id !== "string"/);
    assert.match(payoutHandler, /missing its payout id/);
    assert.match(payoutHandler, /applySellerPayoutFailure\(\{/);
    assert.match(payoutHandler, /claimGeneration,/);
    assert.match(payoutHandler, /eventCreatedSeconds: BigInt\(event\.created\)/);
    assert.doesNotMatch(payoutHandler, /prisma\.sellerPayoutEvent/);
    assert.match(payoutHandler, /result\.action === "ignored_unknown_account"/);
    assert.match(payoutHandler, /result\.action === "stale_ignored"/);
    assert.match(payoutHandler, /sourceType: NOTIFICATION_SOURCE_TYPES\.STRIPE_PAYOUT_FAILURE/);
    assert.match(payoutHandler, /sourceId: result\.payoutEventId/);
  });

  it("registers the provider-authenticated route across every middleware bypass boundary", () => {
    const middleware = source("src/middleware.ts");
    assert.ok((middleware.match(/"\/api\/stripe\/webhook\/connect"/g) ?? []).length >= 3);
    assert.match(middleware, /pathname === "\/api\/stripe\/webhook\/connect"/);
    assert.match(source(".env.example"), /STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx/);
  });
});
