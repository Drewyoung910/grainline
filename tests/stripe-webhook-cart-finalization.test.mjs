import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const webhookSource = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const authoritySource = readFileSync(
  "docs/rls-drafts/order-paid-checkout-authority.sql",
  "utf8",
);

describe("Stripe cart checkout webhook finalization", () => {
  it("creates OrderItems from complete Stripe paid lines plus retained checkout source", () => {
    assert.match(webhookSource, /async function listAllCheckoutSessionLineItems\(sessionId: string\)/);
    assert.match(
      webhookSource,
      /stripe\.checkout\.sessions\.listLineItems\(sessionId, \{[\s\S]*limit: 100,[\s\S]*expand: \["data\.price\.product"\]/,
    );
    assert.match(
      webhookSource,
      /const checkoutLineItems: CheckoutLineItem\[\] = await listAllCheckoutSessionLineItems\(sessionId\);/,
    );
    assert.match(webhookSource, /const paidItems = checkoutLineItems\.flatMap/);
    assert.match(webhookSource, /createOrderFromPaidCheckout\(\{[\s\S]*paidItems,/);
    assert.match(authoritySource, /source_items := source_snapshot->'items'/);
    assert.match(authoritySource, /paid->>'sourceKey' = source_item_key/);
    assert.doesNotMatch(webhookSource, /(?:prisma|tx)\.orderItem\.create/);
    assert.doesNotMatch(webhookSource, /for \(const it of cart\.items\)/);
  });

  it("removes only retained Stripe-paid cart rows after atomic order creation", () => {
    assert.match(
      authoritySource,
      /IF source_mode = 'cart' THEN[\s\S]*DELETE FROM public\."CartItem" AS cart_item/,
    );
    assert.match(
      authoritySource,
      /cart_item\.id IN \([\s\S]*retained\.item->>'cartItemId'/,
    );
    assert.doesNotMatch(webhookSource, /(?:prisma|tx)\.cartItem\.deleteMany/);
  });

  it("stores source-derived prices only after exact Stripe-paid price agreement", () => {
    assert.match(webhookSource, /unitAmountCents: unitAmountCents as number/);
    assert.match(
      authoritySource,
      /\(provider_item->>'unitAmountCents'\)::integer IS DISTINCT FROM source_unit_price_cents/,
    );
    assert.match(authoritySource, /'priceCents', source_unit_price_cents/);
    assert.match(authoritySource, /source_unit_price_cents, source_listing_snapshot/);
  });

  it("revalidates buyer, seller and listing eligibility under database locks", () => {
    assert.match(authoritySource, /FROM public\."User" AS actor[\s\S]*FOR UPDATE/);
    assert.match(authoritySource, /seller\."vacationMode"/);
    assert.match(authoritySource, /seller\."acceptingNewOrders"/);
    assert.match(
      authoritySource,
      /listing\.status::text AS status, listing\."isPrivate",[\s\S]*listing\."reservedForUserId"/,
    );
    assert.match(
      authoritySource,
      /source_current_listing\."reservedForUserId" IS DISTINCT FROM[\s\S]*source_buyer_id/,
    );
  });

  it("minimizes PII when a paid checkout's buyer is no longer valid", () => {
    for (const field of [
      "buyerEmail",
      "buyerName",
      "shipToLine1",
      "shipToLine2",
      "shipToCity",
      "shipToState",
      "shipToPostalCode",
      "shipToCountry",
      "quotedToName",
      "quotedToPhone",
      "quotedToCity",
      "quotedToState",
      "quotedToPostalCode",
      "quotedToCountry",
      "shippoShipmentId",
      "shippoRateObjectId",
      "giftNote",
    ]) {
      assert.match(
        authoritySource,
        new RegExp(`CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'${field}' ELSE NULL END`),
        `buyer-invalid checkout must null ${field}`,
      );
    }
    assert.match(
      authoritySource,
      /CASE WHEN source_buyer_invalid_reason IS NULL THEN NULL ELSE source_now END/,
    );
  });

  it("stores invalid paid checkouts as review orders and triggers bounded refund handling", () => {
    assert.match(
      authoritySource,
      /CASE WHEN source_buyer_invalid_reason IS NULL THEN source_buyer_id ELSE NULL END/,
    );
    assert.match(authoritySource, /source_review_needed := source_invalid_reason <> ''/);
    assert.match(
      authoritySource,
      /source_invalid_reason \|\| ' Order was held for staff review\.'/,
    );
    assert.match(authoritySource, /'invalidReason', NULLIF\(source_invalid_reason, ''\)/);
    assert.match(
      webhookSource,
      /if \(createdOrder\.invalidReason\) \{[\s\S]*await refundBlockedCheckout\(\{/,
    );
  });
});
