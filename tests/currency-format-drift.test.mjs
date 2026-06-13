import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("currency formatting drift guardrails", () => {
  it("uses shared currency formatting for refund and guild money copy", () => {
    const sellerRefund = source("src/app/api/orders/[id]/refund/route.ts");
    const caseResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    const guildMetrics = source("src/app/api/cron/guild-metrics/route.ts");
    const followerFanout = source("src/lib/followerListingNotifications.ts");
    const threadMessages = source("src/components/ThreadMessages.tsx");

    assert.match(sellerRefund, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(sellerRefund, /const refundAmountDisplay = formatCurrencyCents\(\s*refundAmountCents,\s*order\.currency,\s*\)/s);
    assert.doesNotMatch(sellerRefund, /refundAmountCents \/ 100|refund of \$\$\{/);

    assert.match(caseResolve, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(caseResolve, /formatCurrencyCents\(persistedRefundAmountCents, caseRecord\.order\.currency\)/);
    assert.doesNotMatch(caseResolve, /persistedRefundAmountCents \/ 100|\(\$\$\{/);

    assert.match(guildMetrics, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(guildMetrics, /formatCurrencyCents\(metrics\.totalSalesCents\)/);
    assert.match(guildMetrics, /formatCurrencyCents\(GUILD_MASTER_REQUIREMENTS\.totalSalesCents\)/);
    assert.doesNotMatch(guildMetrics, /totalSalesCents \/ 100/);

    assert.match(followerFanout, /formatCurrencyCents\(listing\.priceCents, listing\.currency\)/);
    assert.doesNotMatch(followerFanout, /priceCents \/ 100|toFixed\(2\)/);

    assert.match(threadMessages, /import \{ DEFAULT_CURRENCY, formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(threadMessages, /formatCurrencyCents\(link\.priceCents, link\.currency \?\? DEFAULT_CURRENCY\)/);
    assert.doesNotMatch(threadMessages, /link\.priceCents \/ 100|toFixed\(2\)/);
  });

  it("uses shared currency formatting on cart, listing, and public listing surfaces", () => {
    const files = [
      "src/app/cart/page.tsx",
      "src/components/ListingPurchasePanel.tsx",
      "src/components/VariantSelector.tsx",
      "src/components/GiftNoteSection.tsx",
      "src/components/BuyNowCheckoutModal.tsx",
      "src/app/browse/page.tsx",
      "src/app/page.tsx",
      "src/app/blog/[slug]/page.tsx",
      "src/app/account/following/page.tsx",
      "src/app/checkout/success/page.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/components/SellerRefundPanel.tsx",
      "src/components/LabelSection.tsx",
      "src/app/admin/orders/page.tsx",
    ];

    for (const path of files) {
      const text = source(path);
      assert.match(text, /formatCurrencyCents/, path);
      assert.doesNotMatch(text, /\/ 100\)\.(toFixed\(2\)|toLocaleString\("en-US", \{ style: "currency")/, path);
      assert.doesNotMatch(text, /priceCents \/ 100|subtotalCents \/ 100|grandTotal \/ 100/, path);
    }

    assert.match(source("src/components/ListingPurchasePanel.tsx"), /<VariantSelector[\s\S]*?currency=\{displayCurrency\}/);
    assert.match(source("src/components/BuyNowCheckoutModal.tsx"), /<GiftNoteSection[\s\S]*?currency=\{displayCurrency\}/);
    assert.match(source("src/app/cart/page.tsx"), /<GiftNoteSection[\s\S]*?currency=\{g\.currency\}/);
  });

  it("keeps label clawback reconciliation notes on shared currency formatting", () => {
    const state = source("src/lib/labelClawbackState.ts");
    const retry = source("src/lib/labelClawbackRetry.ts");
    const route = source("src/app/api/orders/[id]/label/route.ts");

    assert.match(state, /import \{ DEFAULT_CURRENCY, formatCurrencyCents \} from "\.\/money\.ts"/);
    assert.match(state, /formatCurrencyCents\(cents, currency\)/);
    assert.doesNotMatch(state, /cents \/ 100|toFixed\(2\)/);
    assert.match(retry, /currency: order\.currency/);
    assert.match(route, /currency: order\.currency/);
  });
});
