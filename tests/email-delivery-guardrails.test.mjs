import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function functionBody(text, name) {
  const start = text.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = text.indexOf("\nexport ", start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

describe("email delivery guardrails", () => {
  it("sets Reply-To and fails closed before live sends without one-click unsubscribe", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /const EMAIL_REPLY_TO = normalizeEmailAddress\(process\.env\.EMAIL_REPLY_TO \|\| SUPPORT_EMAIL\)/);
    assert.match(email, /replyTo: EMAIL_REPLY_TO/);
    assert.match(email, /reason: "missing_one_click_unsubscribe"/);
    assert.match(email, /if \(!unsubscribeUrl\) \{[\s\S]*?if \(opts\.throwOnFailure\) throw err;[\s\S]*?return;[\s\S]*?\}/);
    assert.match(email, /"List-Unsubscribe": `<\$\{unsubscribeUrl\}>`/);
    assert.match(email, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
  });

  it("treats skipped delivery as failure for throwOnFailure callers", () => {
    const email = source("src/lib/email.ts");
    const sendStart = email.indexOf("async function send(");
    const sendBody = email.slice(sendStart, email.indexOf("export async function sendRenderedEmail", sendStart));

    assert.match(email, /function emailDeliverySkippedError\(reason: string\)/);
    assert.match(sendBody, /if \(opts\.throwOnFailure\) throw emailDeliverySkippedError\("invalid recipient"\)/);
    assert.match(sendBody, /if \(opts\.throwOnFailure\) throw emailDeliverySkippedError\("email provider not configured"\)/);
    assert.match(sendBody, /isEmailDeliverySuppressed\(recipient\)[\s\S]*?throw emailDeliverySkippedError\("recipient suppressed"\)/);
    assert.match(sendBody, /account\?\.banned \|\| account\?\.deletedAt[\s\S]*?emailDeliverySkippedError\(account\.banned \? "recipient banned" : "recipient deleted"\)/);
    assert.match(source("src/lib/emailOutbox.ts"), /sendRenderedEmail\(\s*\{ to: job\.recipientEmail, subject: job\.subject, html: job\.html \},\s*\{ throwOnFailure: true \}/);
    assert.match(source("src/app/api/support/route.ts"), /sendRenderedEmail\(\{[\s\S]*?\}, \{ throwOnFailure: true \}\)/);
    assert.match(source("src/app/api/legal/data-request/route.ts"), /sendRenderedEmail\(\{[\s\S]*?\}, \{ throwOnFailure: true \}\)/);
  });

  it("only injects unsubscribe URLs into the footer href placeholder", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /const UNSUBSCRIBE_HREF_PLACEHOLDER = "https:\/\/grainline\.invalid\/unsubscribe-placeholder-/);
    assert.match(email, /function injectUnsubscribeHref/);
    assert.match(email, /`href="\$\{UNSUBSCRIBE_HREF_PLACEHOLDER\}"`/);
    assert.doesNotMatch(email, /__GRAINLINE_UNSUBSCRIBE_URL__/);
  });

  it("keeps privacy-sensitive user-authored previews out of notification emails", () => {
    const email = source("src/lib/email.ts");
    for (const name of [
      "sendCaseOpened",
      "sendCaseMessage",
      "sendCustomOrderRequest",
      "sendNewMessageEmail",
      "sendNewReviewEmail",
    ]) {
      const body = functionBody(email, name);
      assert.doesNotMatch(body, /<blockquote/);
      assert.doesNotMatch(body, /truncateTextWithEllipsis/);
    }
    assert.match(functionBody(email, "sendCaseOpened"), /order <strong>#\$\{esc\(shortId\(orderId\)\)\}<\/strong>/);
    assert.match(functionBody(email, "sendNewMessageEmail"), /Open the conversation to read and reply/);
    assert.match(functionBody(email, "sendNewReviewEmail"), /Open Grainline to read the full review/);
  });

  it("adds marketing context, support contact, current year, and bounded subjects", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /You're receiving this because you follow \$\{esc\(makerName\)\} on Grainline/);
    assert.match(email, /function sellerBroadcastEmailSubject\(makerName: string\)/);
    assert.match(email, /You're receiving this because you follow \$\{esc\(makerName\)\} on Grainline and opted into maker broadcast emails/);
    assert.match(email, /subject: sellerBroadcastEmailSubject\(makerName\)/);
    assert.match(email, /mailto:\$\{SUPPORT_EMAIL\}/);
    assert.match(email, /const year = new Date\(\)\.getFullYear\(\)/);
    assert.match(email, /truncateSubjectText\(listingTitle, 50\).* is back in stock!/);
    assert.match(email, /Your Guild Master status is at risk - Grainline/);
    assert.match(email, /Guild Master badge update - Grainline/);
    assert.match(email, /Guild Member badge update - Grainline/);
    assert.doesNotMatch(email, /status is at risk — Grainline/);
  });

  it("keeps order receipts easier to reconcile without noisy zero rows", () => {
    const email = source("src/lib/email.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const checkoutSeller = source("src/app/api/cart/checkout-seller/route.ts");

    assert.match(email, /orderSubjectSuffix\(order\.id\)/);
    assert.match(email, /each maker is handled as a separate order/);
    assert.match(email, /multiSellerCheckout\?: boolean/);
    assert.match(email, /opts\.multiSellerCheckout \? `<p[\s\S]*?each maker is handled as a separate order/);
    assert.match(email, /order\.shippingAmountCents > 0/);
    assert.match(email, /order\.taxAmountCents > 0/);
    assert.match(email, /order\.giftWrapping \|\| giftWrappingPriceCents > 0/);
    assert.match(email, /: "Included"/);
    assert.match(checkoutSeller, /cartSellerCount = new Set\(cart\.items\.map/);
    assert.match(checkoutSeller, /multiSellerCheckout: cartSellerCount > 1 \? "true" : "false"/);
    assert.match(webhook, /giftWrapping: order\.giftWrapping/);
    assert.match(webhook, /initialMultiSellerCheckout =[\s\S]*?initialSessionMeta\.multiSellerCheckout === "true" \|\| initialCartSellerCount > 1/);
    assert.match(webhook, /multiSellerCheckout = sessionMeta\.multiSellerCheckout === "true" \|\| cartSellerCount > 1/);
    assert.match(webhook, /renderOrderConfirmedBuyerEmail\(\{[\s\S]*?multiSellerCheckout: opts\.multiSellerCheckout === true/);
  });

  it("validates tracking carriers before building email deep links", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /function normalizeTrackingCarrier/);
    assert.match(email, /normalized === "UPS"/);
    assert.match(email, /normalizedCarrier === "USPS"/);
    assert.doesNotMatch(functionBody(email, "sendOrderShipped"), /\.includes\("ups"\)/);
    assert.match(email, /encodeURIComponent\(`tracking \$\{trackingNumber\}`\)/);
  });
});
