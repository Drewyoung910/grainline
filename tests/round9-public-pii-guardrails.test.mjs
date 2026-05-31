import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Round 9 public PII and notification-link guardrails", () => {
  it("sanitizes stored notification links before rendering the full notifications page", () => {
    const notificationsPage = source("src/app/dashboard/notifications/page.tsx");

    assert.match(notificationsPage, /import \{ safeNotificationPath \}/);
    assert.match(notificationsPage, /const path = safeNotificationPath\(n\.link\)/);
    assert.match(notificationsPage, /href=\{path\}/);
    assert.doesNotMatch(notificationsPage, /href=\{n\.link\}/);
  });

  it("does not derive public or cross-user display names from email local parts", () => {
    const ensureSeller = source("src/lib/ensureSeller.ts");
    const reviews = source("src/components/ReviewsSection.tsx");
    const messagesList = source("src/app/messages/page.tsx");
    const messageThread = source("src/app/messages/[id]/page.tsx");
    const followRoute = source("src/app/api/follow/[sellerId]/route.ts");
    const buyerOrder = source("src/app/dashboard/orders/[id]/page.tsx");

    assert.doesNotMatch(ensureSeller, /email\.split\("@"/);
    assert.match(ensureSeller, /const displayName = sanitizeUserName\(me\.name \?\? ""\) \|\| "Maker"/);
    assert.match(ensureSeller, /displayNameNormalized: normalizeDisplayNameForLookup\(displayName\)/);

    assert.doesNotMatch(reviews, /reviewer:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(reviews, /reviewer\.email|email\?\.split\("@"/);

    assert.doesNotMatch(messagesList, /userA:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(messagesList, /userB:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(messagesList, /other\??\.email/);

    assert.doesNotMatch(messageThread, /userA:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(messageThread, /userB:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(messageThread, /convo\.userA\.email|convo\.userB\.email|other\??\.email|email\?\.split\("@"/);

    assert.doesNotMatch(followRoute, /email\.split\("@"/);

    assert.doesNotMatch(buyerOrder, /author:\s*\{\s*select:\s*\{[^}]*email:\s*true/s);
    assert.doesNotMatch(buyerOrder, /msg\.author\.email/);
  });

  it("keeps drift-prone listing review and receipt helpers centralized", () => {
    const createListing = source("src/app/dashboard/listings/new/page.tsx");
    const checkoutSuccess = source("src/app/checkout/success/page.tsx");
    const followerFanout = source("src/lib/followerListingNotifications.ts");

    assert.match(createListing, /import \{ backfillEmptyAltTexts \}/);
    assert.match(createListing, /backfillEmptyAltTexts\(created\.id, aiResult\.altTexts\)/);
    assert.doesNotMatch(createListing, /prisma\.photo\.findMany\(\{\s*where: \{ listingId: created\.id \}/s);

    assert.match(checkoutSuccess, /orderTotalCents as calculateOrderTotalCents/);
    assert.match(checkoutSuccess, /orderItemsSubtotalCents\(order\)/);
    assert.doesNotMatch(checkoutSuccess, /itemsSubtotalCents \+ shippingAmountCents \+ taxAmountCents \+ giftWrappingPriceCents/);

    assert.match(followerFanout, /formatCurrencyCents\(listing\.priceCents, listing\.currency\)/);
    assert.doesNotMatch(followerFanout, /priceCents \/ 100|toFixed\(2\)/);
  });
});
