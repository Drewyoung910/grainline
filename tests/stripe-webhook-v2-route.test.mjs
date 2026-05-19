import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Stripe Connect v2 thin webhook route guardrails", () => {
  it("keeps v2 thin events on a separate route and signing secret", () => {
    const route = source("src/app/api/stripe/webhook/v2/route.ts");
    const legacyRoute = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /process\.env\.STRIPE_V2_WEBHOOK_SECRET/);
    assert.match(route, /return NextResponse\.json\(\{ error: "Webhook temporarily unavailable" \}, \{ status: 500 \}\)/);
    assert.match(route, /return NextResponse\.json\(\{ error: "Missing Stripe signature" \}, \{ status: 400 \}\)/);
    assert.match(route, /return NextResponse\.json\(\{ error: "Invalid signature" \}, \{ status: 400 \}\)/);
    assert.match(route, /readBoundedText\(req, STRIPE_V2_WEBHOOK_BODY_MAX_BYTES\)/);
    assert.match(route, /stripe\.parseEventNotification\(body, signature, secret\)/);
    assert.doesNotMatch(route, /STRIPE_WEBHOOK_SECRET/);

    assert.match(legacyRoute, /process\.env\.STRIPE_WEBHOOK_SECRET/);
    assert.match(legacyRoute, /readBoundedText\(req, STRIPE_WEBHOOK_BODY_MAX_BYTES\)/);
    assert.match(legacyRoute, /stripe\.webhooks\.constructEvent\(body, signature, secret\)/);
    assert.doesNotMatch(legacyRoute, /parseEventNotification/);
    assert.doesNotMatch(legacyRoute, /STRIPE_V2_WEBHOOK_SECRET/);
  });

  it("mirrors v2 account capability state through the shared helper with idempotency", () => {
    const route = source("src/app/api/stripe/webhook/v2/route.ts");
    const mirror = source("src/lib/stripeWebhookMirror.ts");

    assert.match(route, /beginStripeWebhookEvent\(stripeEventId, stripeEventType\)/);
    assert.match(route, /markStripeWebhookEventProcessed\(stripeEventId\)/);
    assert.match(route, /markStripeWebhookEventFailed\(stripeEventId, handlerErr\)/);
    assert.match(route, /isStripeConnectV2AccountEvent\(stripeEventType\)/);
    assert.match(route, /stripeConnectV2AccountIdFromNotification\(notification\)/);
    assert.match(route, /stripe\.accounts\.retrieve\(accountId\)/);
    assert.match(route, /mirrorStripeChargesEnabled\(\{\s*accountId,\s*chargesEnabled: Boolean\(account\.charges_enabled\),\s*route: "\/api\/stripe\/webhook\/v2",\s*\}\)/s);

    assert.match(mirror, /export async function mirrorStripeChargesEnabled/);
    assert.match(mirror, /where: \{ stripeAccountId: accountId \}/);
    assert.match(mirror, /user: \{ select: \{ id: true, banned: true, deletedAt: true \} \}/);
    assert.match(mirror, /const localAccountActive = !seller\.user\.banned && !seller\.user\.deletedAt/);
    assert.match(mirror, /const effectiveChargesEnabled = chargesEnabled && localAccountActive/);
    assert.match(mirror, /seller\.chargesEnabled === effectiveChargesEnabled/);
    assert.match(mirror, /data: \{ chargesEnabled: effectiveChargesEnabled \}/);
    assert.match(mirror, /logSecurityEvent\("ownership_violation"/);
    assert.match(mirror, /expireOpenCheckoutSessionsForSeller/);
    assert.match(mirror, /source: route === "\/api\/stripe\/webhook\/v2" \? "stripe_v2_charges_disabled" : "stripe_charges_disabled"/);
  });

  it("documents and exposes the new webhook destination without weakening public middleware", () => {
    const middleware = source("src/middleware.ts");
    const env = source(".env.example");
    const claude = source("CLAUDE.md");
    const audit = source("audit_open_findings.md");

    assert.match(middleware, /"\/api\/stripe\/webhook\/v2"/);
    assert.match(middleware, /pathname === "\/api\/stripe\/webhook\/v2"/);
    assert.match(env, /STRIPE_V2_WEBHOOK_SECRET=whsec_xxx/);
    assert.match(claude, /Stripe Connect v2 thin events are delivered to `\/api\/stripe\/webhook\/v2` with `STRIPE_V2_WEBHOOK_SECRET`/);
    assert.match(claude, /Snapshot events continue at `\/api\/stripe\/webhook` with `STRIPE_WEBHOOK_SECRET`/);
    assert.match(claude, /Do not consolidate these destinations/);
    assert.match(audit, /Stripe Connect v2 webhook split pass/);
    assert.match(audit, /STRIPE_V2_WEBHOOK_SECRET/);
  });
});
