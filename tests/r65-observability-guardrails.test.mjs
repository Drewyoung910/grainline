import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R65 observability guardrails", () => {
  it("captures cart API exceptions through sanitized server logging", () => {
    for (const [routePath, sourceTag, route] of [
      ["src/app/api/cart/route.ts", "cart_route", "/api/cart"],
      ["src/app/api/cart/add/route.ts", "cart_add_route", "/api/cart/add"],
      ["src/app/api/cart/update/route.ts", "cart_update_route", "/api/cart/update"],
      ["src/app/api/cart/checkout/single/route.ts", "checkout_single_route", "/api/cart/checkout/single"],
      ["src/app/api/cart/checkout-seller/route.ts", "checkout_seller_route", "/api/cart/checkout-seller"],
    ]) {
      const text = source(routePath);
      assert.match(text, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
      assert.match(text, new RegExp(`logServerError\\(err, \\{[\\s\\S]*source: "${sourceTag}",[\\s\\S]*route: "${route}"`));
      assert.doesNotMatch(text, /console\.error\([^,\n]+,\s*err\)/);
    }
  });

  it("logs token rejection signals without storing raw tokens", () => {
    const checkout = source("src/app/api/cart/checkout/single/route.ts");
    assert.match(checkout, /logSecurityEvent\("token_rejected"/);
    assert.match(checkout, /reason: "invalid shipping rate token"/);
    assert.match(checkout, /rateVerification\.status === HTTP_STATUS\.BAD_REQUEST/);
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
    assert.match(adminPin, /ipHash/);
    assert.doesNotMatch(adminPin, /logSecurityEvent\("auth_challenge_failed",\s*\{[^}]*\bip,/s);
  });

  it("keeps Stripe signature failures to one captured exception plus failure-spike accounting", () => {
    const text = source("src/app/api/stripe/webhook/route.ts");
    const signatureCatch = text.slice(
      text.indexOf("Stripe webhook signature verification failed:"),
      text.indexOf("return NextResponse.json({ error: \"Invalid signature\" }"),
    );

    assert.match(signatureCatch, /Sentry\.captureException\(err, \{ tags: \{ source: "stripe_webhook_signature" \} \}\)/);
    assert.match(signatureCatch, /recordWebhookFailureSpike\(\{ webhook: "stripe", kind: "signature", status: HTTP_STATUS\.BAD_REQUEST \}\)/);
    assert.match(signatureCatch, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(signatureCatch, /Sentry\.captureMessage\("Stripe webhook signature verification failed"/);
    assert.doesNotMatch(signatureCatch, /\(err as \{ message\?: string \}\)\?\.message/);
  });

  it("feeds Resend webhook edge and handler failures into failure-spike accounting", () => {
    const text = source("src/app/api/resend/webhook/route.ts");

    assert.match(text, /import \{ recordWebhookFailureSpike \} from "@\/lib\/webhookFailureSpike"/);
    assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);

    const configBlock = text.slice(text.indexOf("if (!config.ok)"), text.indexOf("const id = request.headers.get"));
    assert.match(configBlock, /recordWebhookFailureSpike\(\{ webhook: "resend", kind: "config", status: HTTP_STATUS\.SERVICE_UNAVAILABLE \}\)/);

    const missingSignatureBlock = text.slice(
      text.indexOf("if (!id || !timestamp || !signature)"),
      text.indexOf("let event: WebhookEventPayload"),
    );
    assert.match(missingSignatureBlock, /Sentry\.captureMessage\("Resend webhook signature headers missing"/);
    assert.match(
      missingSignatureBlock,
      /recordWebhookFailureSpike\(\{ webhook: "resend", kind: "signature", status: HTTP_STATUS\.BAD_REQUEST \}\)/,
    );

    const payloadBlock = text.slice(
      text.indexOf("Resend webhook payload is too large"),
      text.indexOf("return NextResponse.json({ ok: false, error: \"Payload too large\" }"),
    );
    assert.match(payloadBlock, /status: HTTP_STATUS\.PAYLOAD_TOO_LARGE/);

    const verifyCatch = text.slice(
      text.indexOf("Sentry.captureException(err, { tags: { source: \"resend_webhook_verify\" } })"),
      text.indexOf("return NextResponse.json({ ok: false, error: \"Invalid webhook signature\" }"),
    );
    assert.match(verifyCatch, /recordWebhookFailureSpike\(\{ webhook: "resend", kind: "signature", status: HTTP_STATUS\.BAD_REQUEST \}\)/);

    const processCatch = text.slice(
      text.indexOf("Sentry.captureException(err, { tags: { source: \"resend_webhook_process\""),
      text.indexOf("return NextResponse.json({ ok: false, error: \"Webhook processing failed\" }"),
    );
    assert.match(processCatch, /webhook: "resend"/);
    assert.match(processCatch, /kind: "handler"/);
    assert.match(processCatch, /status: HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(processCatch, /extra: \{ svixId: id, type: event\.type \}/);
    assert.doesNotMatch(processCatch, /\bpayload\b|\bemail\b|\brecipientHashes\b/);
  });

  it("feeds Clerk webhook edge and handler failures into failure-spike accounting", () => {
    const text = source("src/app/api/clerk/webhook/route.ts");

    assert.match(text, /import \{ recordWebhookFailureSpike \} from "@\/lib\/webhookFailureSpike"/);
    assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);
    assert.match(text, /import \{ sanitizeEmailOutboxError \} from "@\/lib\/emailOutboxSanitize"/);
    assert.match(text, /lastError: truncateText\(sanitizeEmailOutboxError\(err\), 2000\)/);
    assert.doesNotMatch(text, /lastError: truncateText\(errorMessage\(err\), 2000\)/);

    const configBlock = text.slice(text.indexOf("if (!webhookSecret)"), text.indexOf("const headerPayload = await headers"));
    assert.match(configBlock, /Sentry\.captureMessage\("Clerk webhook secret is not configured"/);
    assert.match(configBlock, /recordWebhookFailureSpike\(\{ webhook: "clerk", kind: "config", status: HTTP_STATUS\.INTERNAL_SERVER_ERROR \}\)/);

    const missingSignatureBlock = text.slice(
      text.indexOf("if (!svixId || !svixTimestamp || !svixSignature)"),
      text.indexOf("let body = \"\""),
    );
    assert.match(missingSignatureBlock, /Sentry\.captureMessage\("Clerk webhook signature headers missing"/);
    assert.match(missingSignatureBlock, /hasSvixId: Boolean\(svixId\)/);
    assert.match(missingSignatureBlock, /hasSvixTimestamp: Boolean\(svixTimestamp\)/);
    assert.match(missingSignatureBlock, /hasSvixSignature: Boolean\(svixSignature\)/);
    assert.match(
      missingSignatureBlock,
      /recordWebhookFailureSpike\(\{ webhook: "clerk", kind: "signature", status: HTTP_STATUS\.BAD_REQUEST \}\)/,
    );

    const payloadBlock = text.slice(
      text.indexOf("Clerk webhook payload is too large"),
      text.indexOf("return NextResponse.json({ error: \"Payload too large\" }"),
    );
    assert.match(payloadBlock, /status: HTTP_STATUS\.PAYLOAD_TOO_LARGE/);

    const verifyCatch = text.slice(
      text.indexOf("Sentry.captureException(err, {"),
      text.indexOf("return NextResponse.json({ error: \"Invalid signature\" }"),
    );
    assert.match(verifyCatch, /source: "clerk_webhook_verify"/);
    assert.match(verifyCatch, /recordWebhookFailureSpike\(\{ webhook: "clerk", kind: "signature", status: HTTP_STATUS\.BAD_REQUEST \}\)/);

    const finalCatchStart = text.indexOf("await markClerkWebhookFailed(svixId, error)");
    const processCatch = text.slice(
      finalCatchStart,
      text.indexOf("throw error;", finalCatchStart),
    );
    assert.match(processCatch, /source: "clerk_webhook"/);
    assert.match(processCatch, /webhook: "clerk"/);
    assert.match(processCatch, /kind: "handler"/);
    assert.match(processCatch, /status: HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(processCatch, /extra: \{ svixId, eventType: event\.type \}/);
    assert.doesNotMatch(processCatch, /\bbody\b|\bemail_addresses\b|\bprimary_email_address_id\b/);
  });

  it("records retryable webhook reservation failures with bounded telemetry", () => {
    for (const [path, sourceTag, webhook, extraPattern] of [
      [
        "src/app/api/stripe/webhook/route.ts",
        "stripe_webhook_reservation",
        "stripe",
        /extra: \{ stripeEventId: event\.id, stripeEventType: event\.type \}/,
      ],
      [
        "src/app/api/stripe/webhook/v2/route.ts",
        "stripe_v2_webhook_reservation",
        "stripe_v2",
        /extra: \{ stripeEventId, stripeEventType \}/,
      ],
      [
        "src/app/api/resend/webhook/route.ts",
        "resend_webhook_reservation",
        "resend",
        /extra: \{ svixId: id, type: event\.type \}/,
      ],
      [
        "src/app/api/clerk/webhook/route.ts",
        "clerk_webhook_reservation",
        "clerk",
        /extra: \{ svixId, eventType: event\.type \}/,
      ],
    ]) {
      const text = source(path);
      const sourceIndex = text.indexOf(sourceTag);
      const blockStart = text.lastIndexOf("Sentry.captureException", sourceIndex);
      const reservationBlock = text.slice(
        blockStart,
        text.indexOf("Webhook temporarily unavailable", sourceIndex),
      );

      assert.match(reservationBlock, new RegExp(`source: "${sourceTag}"`));
      assert.match(reservationBlock, new RegExp(`webhook: "${webhook}"`));
      assert.match(reservationBlock, /kind: "reservation"/);
      assert.match(reservationBlock, /status: HTTP_STATUS\.SERVICE_UNAVAILABLE/);
      assert.match(reservationBlock, extraPattern);
      assert.doesNotMatch(reservationBlock, /\bbody\b|\bpayload\b|\bemail\b|\bmetadata\b/);
    }
  });
});
