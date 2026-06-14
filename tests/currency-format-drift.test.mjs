import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const { formatCommissionBudgetRange } = await import("../src/lib/commissionBudget.ts");

describe("currency formatting drift guardrails", () => {
  it("formats commission budget ranges through shared currency helpers", () => {
    assert.equal(formatCommissionBudgetRange(1000, 2500), "$10.00\u2013$25.00");
    assert.equal(formatCommissionBudgetRange(1000, null), "From $10.00");
    assert.equal(formatCommissionBudgetRange(null, 2500), "Up to $25.00");
    assert.equal(formatCommissionBudgetRange(null, null), null);
  });

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
      "src/app/account/page.tsx",
      "src/app/account/orders/page.tsx",
      "src/app/account/feed/FeedClient.tsx",
      "src/app/checkout/success/page.tsx",
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/analytics/page.tsx",
      "src/app/dashboard/inventory/InventoryRow.tsx",
      "src/app/dashboard/orders/page.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/app/dashboard/verification/page.tsx",
      "src/app/admin/flagged/page.tsx",
      "src/components/SellerRefundPanel.tsx",
      "src/components/LabelSection.tsx",
      "src/components/OrderTimeline.tsx",
      "src/components/RecentlyViewed.tsx",
      "src/app/messages/[id]/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/admin/orders/[id]/page.tsx",
      "src/app/admin/cases/[id]/page.tsx",
      "src/app/admin/review/page.tsx",
      "src/app/admin/verification/page.tsx",
      "src/app/api/verification/apply/route.ts",
      "src/app/api/seller/analytics/route.ts",
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
    assert.match(source("src/components/OrderTimeline.tsx"), /formatCurrencyCents\(cents, currency\)/);
    assert.match(source("src/app/dashboard/orders/[id]/page.tsx"), /<OrderTimeline[\s\S]*?currency=\{currency\}/);
    assert.match(source("src/app/dashboard/sales/[orderId]/page.tsx"), /<OrderTimeline[\s\S]*?currency=\{currency\}/);
    assert.match(source("src/app/commission/page.tsx"), /formatCommissionBudgetRange\(r\.budgetMinCents, r\.budgetMaxCents\)/);
    assert.match(source("src/app/commission/[param]/page.tsx"), /formatCommissionBudgetRange\(request\.budgetMinCents, request\.budgetMaxCents\)/);
    assert.match(source("src/app/account/commissions/page.tsx"), /formatCommissionBudgetRange\(r\.budgetMinCents, r\.budgetMaxCents\)/);
    assert.match(source("src/components/ThreadMessages.tsx"), /formatCommissionBudgetRange\(card\.budgetMinCents, card\.budgetMaxCents\)/);
  });

  it("uses minor-unit formatting for structured data prices", () => {
    const metroBrowse = source("src/app/browse/[metroSlug]/page.tsx");
    const metroCategory = source("src/app/browse/[metroSlug]/[category]/page.tsx");
    const commissionDetail = source("src/app/commission/[param]/page.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");

    for (const text of [metroBrowse, metroCategory]) {
      assert.match(text, /import \{ formatCurrencyMinorUnitAmount \} from "@\/lib\/money"/);
      assert.match(text, /formatCurrencyMinorUnitAmount\(l\.priceCents, l\.currency\)/);
      assert.doesNotMatch(text, /l\.priceCents \/ 100/);
    }

    assert.match(commissionDetail, /import \{ formatCurrencyMinorUnitAmount \} from "@\/lib\/money"/);
    assert.match(commissionDetail, /formatCurrencyMinorUnitAmount\(request\.budgetMinCents\)/);
    assert.match(commissionDetail, /formatCurrencyMinorUnitAmount\(request\.budgetMaxCents\)/);
    assert.doesNotMatch(commissionDetail, /budget(Min|Max)Cents \/ 100/);

    assert.match(dashboard, /formatCurrencyMinorUnitAmount\(s\.minPrice\)/);
    assert.match(dashboard, /formatCurrencyMinorUnitAmount\(s\.maxPrice\)/);
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
