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
    assert.match(route, /reservation === "processed"/);
    assert.match(route, /reservation === "in_progress"/);
    assert.match(route, /status: 503/);
    assert.match(route, /"Retry-After": String\(STRIPE_V2_WEBHOOK_RETRY_AFTER_SECONDS\)/);
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

  it("keeps legacy snapshot webhooks retryable while an event is in progress", () => {
    const legacyRoute = source("src/app/api/stripe/webhook/route.ts");
    const events = source("src/lib/stripeWebhookEvents.ts");

    assert.match(events, /export type StripeWebhookEventReservation = "process" \| "processed" \| "in_progress"/);
    assert.match(events, /if \(existing\?\.processedAt\) return "processed"/);
    assert.match(events, /return claimed\.count > 0 \? "process" : "in_progress"/);
    assert.match(legacyRoute, /reservation === "processed"/);
    assert.match(legacyRoute, /reservation === "in_progress"/);
    assert.match(legacyRoute, /status: 503/);
    assert.match(legacyRoute, /"Retry-After": String\(STRIPE_WEBHOOK_RETRY_AFTER_SECONDS\)/);
  });

  it("marks known duplicate checkout sessions processed before returning webhook success", () => {
    const legacyRoute = source("src/app/api/stripe/webhook/route.ts");
    const duplicateStart = legacyRoute.indexOf("const duplicateSession =");
    const duplicateBranch = legacyRoute.slice(
      duplicateStart,
      legacyRoute.indexOf('console.error("Stripe webhook handler error:', duplicateStart),
    );

    assert.ok(duplicateStart >= 0, "legacy webhook route must keep an explicit duplicate-session branch");
    assert.match(duplicateBranch, /code === "P2002"/);
    assert.match(duplicateBranch, /p2002Target\.includes\("stripeSessionId"\)/);
    assert.match(duplicateBranch, /markStripeWebhookEventProcessed\(event\.id\)/);
    assert.match(duplicateBranch, /return NextResponse\.json\(\{ ok: true \}\)/);
    assert.ok(
      duplicateBranch.indexOf("markStripeWebhookEventProcessed(event.id)") <
        duplicateBranch.indexOf("return NextResponse.json({ ok: true })"),
      "duplicate-session webhook success should not leave a failed/unprocessed reservation row",
    );
  });

  it("documents and exposes the new webhook destination without weakening public middleware", () => {
    const middleware = source("src/middleware.ts");
    const env = source(".env.example");
    const claude = source("CLAUDE.md");
    const securityAuditLog = source("docs/security-audit-log.md");

    assert.match(middleware, /"\/api\/stripe\/webhook\/v2"/);
    assert.match(middleware, /pathname === "\/api\/stripe\/webhook\/v2"/);
    assert.match(env, /STRIPE_V2_WEBHOOK_SECRET=whsec_xxx/);
    assert.match(claude, /Stripe Connect v2 thin events are delivered to `\/api\/stripe\/webhook\/v2` with `STRIPE_V2_WEBHOOK_SECRET`/);
    assert.match(claude, /Snapshot events continue at `\/api\/stripe\/webhook` with `STRIPE_WEBHOOK_SECRET`/);
    assert.match(claude, /Do not consolidate these destinations/);
    assert.match(securityAuditLog, /Accounts v2 thin events remain isolated on `\/api\/stripe\/webhook\/v2` with `STRIPE_V2_WEBHOOK_SECRET`/);
  });

  it("keeps launch and recovery docs on exact Stripe webhook subscriptions", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");

    assert.match(launch, /https:\/\/thegrainline\.com\/api\/stripe\/webhook/);
    assert.match(runbook, /\/api\/stripe\/webhook/);

    for (const doc of [launch, runbook]) {
      assert.match(doc, /checkout\.session\.completed/);
      assert.match(doc, /checkout\.session\.async_payment_succeeded/);
      assert.match(doc, /checkout\.session\.expired/);
      assert.match(doc, /checkout\.session\.async_payment_failed/);
      assert.match(doc, /account\.updated/);
      assert.match(doc, /account\.application\.deauthorized/);
      assert.match(doc, /charge\.refunded/);
      assert.match(doc, /charge\.dispute\.created/);
      assert.match(doc, /charge\.dispute\.updated/);
      assert.match(doc, /charge\.dispute\.closed/);
      assert.match(doc, /charge\.dispute\.funds_withdrawn/);
      assert.match(doc, /charge\.dispute\.funds_reinstated/);
      assert.match(doc, /payout\.failed/);
      assert.match(doc, /payment_intent\.\*/);
      assert.match(doc, /\/api\/stripe\/webhook\/v2/);
      assert.match(doc, /STRIPE_V2_WEBHOOK_SECRET/);
      assert.match(doc, /v2\.core\.account/);
    }

    assert.doesNotMatch(launch, /with at least `checkout\.session\.completed`/);
    assert.match(launch, /screenshots of the exact event subscriptions/);
    assert.match(runbook, /subscribed only to the handled snapshot events/);
  });
});
