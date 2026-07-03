import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { isDeletedAccountEmail, sellerFacingOrderBuyerLabel, sellerFacingUserLabel } = await import("../src/lib/sellerFacingUser.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller-facing user labels", () => {
  it("hides internal deleted-account email placeholders", () => {
    assert.equal(isDeletedAccountEmail("deleted+user_123@deleted.thegrainline.local"), true);
    assert.equal(isDeletedAccountEmail("buyer@example.com"), false);
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "deleted+user_123@deleted.thegrainline.local" }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: "Buyer Name", email: "deleted+user_123@deleted.thegrainline.local" }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "buyer@example.com", deletedAt: new Date() }, "Deleted user"),
      "Deleted user",
    );
    assert.equal(
      sellerFacingUserLabel({ name: null, email: "buyer@example.com", deletedAt: null }, "Deleted user"),
      "buyer@example.com",
    );
  });

  it("uses the helper on seller-facing buyer labels", () => {
    const sales = source("src/app/dashboard/sales/page.tsx");
    const saleDetail = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");
    const recentSalesRoute = source("src/app/api/seller/analytics/recent-sales/route.ts");
    const analyticsPage = source("src/app/dashboard/analytics/page.tsx");

    for (const text of [customListing]) {
      assert.match(text, /import \{ sellerFacingUserLabel \} from "@\/lib\/sellerFacingUser"/);
      assert.match(text, /deletedAt: true/);
      assert.doesNotMatch(text, /\?\.name \?\? [^.]+\.buyer\?\.email/);
      assert.doesNotMatch(text, /buyer\?\.name \|\| buyer\?\.email/);
    }

    assert.match(sales, /import \{ sellerFacingOrderBuyerLabel \} from "@\/lib\/sellerFacingUser"/);
    assert.match(sales, /sellerFacingOrderBuyerLabel\(o, "Deleted user"\)/);
    assert.doesNotMatch(sales, /buyer: \{ select: \{[^}]*email: true/s);
    assert.doesNotMatch(sales, /buyer: \{ select: \{[^}]*name: true/s);

    assert.match(saleDetail, /import \{ sellerFacingOrderBuyerLabel \} from "@\/lib\/sellerFacingUser"/);
    assert.match(saleDetail, /sellerFacingOrderBuyerLabel\(order, "Deleted user"\)/);
    assert.doesNotMatch(saleDetail, /buyer: \{ select: \{[^}]*email: true/s);
    assert.doesNotMatch(saleDetail, /buyer: \{ select: \{[^}]*name: true/s);

    assert.match(customListing, /sellerFacingUserLabel\(buyer, "the buyer"\)/);

    assert.match(recentSalesRoute, /import \{ sellerFacingOrderBuyerLabel \} from "@\/lib\/sellerFacingUser"/);
    assert.match(recentSalesRoute, /buyerName: true/);
    assert.match(recentSalesRoute, /buyerEmail: true/);
    assert.match(recentSalesRoute, /buyerDataPurgedAt: true/);
    assert.match(recentSalesRoute, /buyer: \{ select: \{ deletedAt: true \} \}/);
    assert.match(recentSalesRoute, /buyerLabel: sellerFacingOrderBuyerLabel/);
    assert.doesNotMatch(recentSalesRoute, /buyer: \{ select: \{[^}]*name: true/s);
    assert.doesNotMatch(recentSalesRoute, /buyer: \{ select: \{[^}]*email: true/s);
    assert.match(analyticsPage, /buyerLabel: string/);
    assert.match(analyticsPage, /order\.buyerLabel\.split\(" "\)\[0\] \|\| "Buyer"/);
    assert.doesNotMatch(analyticsPage, /order\.buyer\?\.name/);
  });

  it("keeps admin order views from bypassing purged order buyer identity", () => {
    const adminOrders = source("src/app/admin/orders/page.tsx");
    const adminOrderDetail = source("src/app/admin/orders/[id]/page.tsx");

    for (const text of [adminOrders, adminOrderDetail]) {
      assert.match(text, /order\.buyerDataPurgedAt[\s\S]*?\? "Buyer data purged"/);
      assert.match(text, /order\.buyerEmail \?\? order\.buyer\?\.email/);
    }

    assert.match(adminOrders, /order\.buyerName \?\? order\.buyerEmail \?\? order\.buyer\?\.name/);
    assert.match(adminOrderDetail, /order\.buyerName \?\? order\.buyer\?\.name/);
    assert.match(adminOrders, /const buyerEmail = order\.buyerDataPurgedAt[\s\S]*?\? null/);
    assert.match(adminOrders, /buyerEmail && buyerEmail !== buyer/);
    assert.match(adminOrderDetail, /<Field label="Stripe email" value=\{order\.buyerDataPurgedAt \? null : order\.buyerEmail\} \/>/);
    assert.doesNotMatch(adminOrderDetail, /<Field label="Name" value=\{order\.buyer\?\.name/);
    assert.doesNotMatch(adminOrderDetail, /<Field label="Email" value=\{order\.buyer\?\.email/);
  });

  it("uses retained order snapshots and hides purged buyer identity", () => {
    assert.equal(
      sellerFacingOrderBuyerLabel({
        buyerName: "Buyer Name",
        buyerEmail: "buyer@example.com",
        buyerDataPurgedAt: null,
        buyer: { deletedAt: null },
      }, "Deleted user"),
      "Buyer Name",
    );
    assert.equal(
      sellerFacingOrderBuyerLabel({
        buyerName: null,
        buyerEmail: "buyer@example.com",
        buyerDataPurgedAt: null,
        buyer: { deletedAt: null },
      }, "Deleted user"),
      "buyer@example.com",
    );
    assert.equal(
      sellerFacingOrderBuyerLabel({
        buyerName: "Buyer Name",
        buyerEmail: "buyer@example.com",
        buyerDataPurgedAt: new Date(),
        buyer: { deletedAt: null },
      }, "Deleted user"),
      "Deleted user",
    );
  });
});
