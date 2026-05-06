import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("verified audit follow-up guardrails", () => {
  it("validates new message recipients and listing context before creating a conversation", () => {
    const text = source("src/app/messages/new/page.tsx");
    assert.match(text, /canStartConversationWith/);
    assert.match(text, /canAttachConversationContextListing/);
    assert.match(text, /prisma\.block\.findFirst/);
    assert.equal(text.includes("contextListingId: listing"), false);
  });

  it("keeps commission close and interest creation behind atomic open-state predicates", () => {
    const patchRoute = source("src/app/api/commission/[id]/route.ts");
    const interestRoute = source("src/app/api/commission/[id]/interest/route.ts");
    assert.match(patchRoute, /commissionRequest\.updateMany/);
    assert.match(patchRoute, /openCommissionMutationWhere\(id, new Date\(\), \{ buyerId: me\.id \}\)/);
    assert.match(interestRoute, /commissionRequest\.updateMany/);
    assert.match(interestRoute, /COMMISSION_CLOSED_DURING_INTEREST/);
  });

  it("keeps order total displays and emails on the gift-wrap-aware helper", () => {
    const paths = [
      "src/app/account/page.tsx",
      "src/app/account/orders/page.tsx",
      "src/app/dashboard/orders/page.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/admin/orders/[id]/page.tsx",
      "src/app/dashboard/analytics/page.tsx",
      "src/lib/email.ts",
    ];

    for (const path of paths) {
      assert.match(source(path), /orderTotalCents/, `${path} should use orderTotalCents()`);
    }
    assert.match(source("src/app/api/seller/analytics/recent-sales/route.ts"), /giftWrappingPriceCents: true/);
    assert.match(source("src/app/api/stripe/webhook/route.ts"), /giftWrappingPriceCents: order\.giftWrappingPriceCents/);
  });

  it("allows post-delivery case creation without offering not-received reasons", () => {
    const page = source("src/app/dashboard/orders/[id]/page.tsx");
    const form = source("src/components/OpenCaseForm.tsx");
    assert.match(page, /isTerminal \|\| \(order\.estimatedDeliveryDate/);
    assert.match(page, /allowNotReceived=\{!isTerminal\}/);
    assert.match(form, /allowNotReceived \|\| value !== "NOT_RECEIVED"/);
    assert.match(form, /useState\(allowNotReceived \? "NOT_RECEIVED" : "DAMAGED"\)/);
  });

  it("documents the current Stripe API version pin", () => {
    assert.match(source("src/lib/stripe.ts"), /apiVersion: "2025-10-29\.clover"/);
    assert.match(source("CLAUDE.md"), /pins `"2025-10-29\.clover"` explicitly/);
  });

  it("marks label-cost clawback failures for durable admin reconciliation", () => {
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    assert.match(labelRoute, /markLabelClawbackForReview/);
    assert.match(labelRoute, /reason: "missing_transfer"/);
    assert.match(labelRoute, /reason: "stripe_reversal_failed"/);
    assert.match(labelRoute, /reviewNeeded: true/);
    assert.match(source("src/lib/labelClawbackState.ts"), /Staff must retry or manually reconcile/);
  });
});
