import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller operational route hardening", () => {
  it("keeps vacation mode confirmation cancellable from the toggle and buttons", () => {
    const form = source("src/app/dashboard/seller/VacationModeForm.tsx");

    assert.match(form, /setPendingEnable\(false\);\s*setShowWarning\(false\);/s);
    assert.match(form, /function cancelEnable\(\)[\s\S]*?setEnabled\(false\);/);
    assert.match(form, /if \(showWarning\) \{\s*cancelEnable\(\);\s*return;\s*\}/);
    assert.match(form, /checked=\{enabled \|\| pendingEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{confirmEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{cancelEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{handleSave\}/);
  });

  it("accepts date-input return dates without weakening vacation route validation", () => {
    const route = source("src/app/api/seller/vacation/route.ts");

    assert.match(route, /vacationReturnDate: z\.string\(\)\.max\(40\)\.optional\(\)\.nullable\(\)/);
    assert.doesNotMatch(route, /\.datetime\(\)/);
    assert.match(route, /function parseVacationReturnDate/);
    assert.match(route, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
    assert.match(route, /T12:00:00\.000Z/);
    assert.match(route, /return NextResponse\.json\(\{ error: "Invalid return date" \}, \{ status: 400 \}\)/);
    assert.match(route, /source: "seller_vacation_update"/);
    assert.match(route, /expireOpenCheckoutSessionsForSeller/);
    assert.match(route, /source: "seller_vacation"/);
  });

  it("captures seller broadcast notification side-effect failures without message payloads", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");

    assert.match(route, /source: "seller_broadcast_notification"/);
    assert.match(route, /source: "seller_broadcast_after"/);
    assert.match(route, /broadcastId: broadcast\.id/);
    assert.match(route, /sellerProfileId: seller\.id/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*message/s);
  });

  it("keeps seller broadcast history pagination bounded", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");

    assert.match(route, /parseBoundedPositiveIntParam\(url\.searchParams\.get\("page"\), 1, 1000\)/);
    assert.match(route, /where: \{ sellerProfileId: seller\.id \}/);
  });

  it("keeps seller broadcast writes gated to orderable sellers and first-party media", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");

    assert.match(route, /!seller\.chargesEnabled \|\| seller\.vacationMode/);
    assert.match(route, /isFirstPartyMediaUrl\(u\)/);
    assert.match(route, /isFirstPartyMediaUrlForUser\(imageUrl, userId/);
    assert.match(route, /safeRateLimit\(broadcastRatelimit, seller\.id\)/);
    assert.match(route, /dedupScope: broadcast\.id/);
  });

  it("keeps seller analytics scoped to the current seller profile", () => {
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(analytics, /ensureUserByClerkId\(userId\)/);
    assert.match(analytics, /where: \{ userId: me\.id \}/);
    assert.match(analytics, /const sellerId = sellerProfile\.id/);
    assert.match(analytics, /accountAccessErrorResponse\(err\)/);

    assert.match(recentSales, /ensureUserByClerkId\(userId\)/);
    assert.match(recentSales, /where: \{ userId: me\.id \}/);
    assert.match(recentSales, /some: \{ listing: \{ sellerId: sellerProfile\.id \} \}/);
    assert.match(recentSales, /every: \{ listing: \{ sellerId: sellerProfile\.id \} \}/);
    assert.match(recentSales, /accountAccessErrorResponse\(err\)/);
  });

  it("keeps listing stock updates owner-scoped in the final mutation", () => {
    const route = source("src/app/api/listings/[id]/stock/route.ts");

    assert.match(route, /where: \{ id, seller: \{ userId: me\.id \} \}/);
    assert.match(route, /AND "sellerId" = \$\{listing\.seller\.id\}/);
    assert.match(route, /source: "stock_back_in_stock_fanout"/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("keeps seller listing status follow-up mutations owner-scoped", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const createListing = source("src/app/dashboard/listings/new/page.tsx");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");
    const editListing = source("src/app/dashboard/listings/[id]/edit/page.tsx");

    assert.match(shopActions, /WHERE id = \$\{listingId\}\s+AND "sellerId" = \$\{listing\.sellerId\}/);
    assert.match(createListing, /WHERE id = \$\{created\.id\}\s+AND "sellerId" = \$\{seller\.id\}/);
    assert.match(customListing, /WHERE id = \$\{created\.id\}\s+AND "sellerId" = \$\{seller\.id\}/);
    assert.match(editListing, /where: \{ id: listingId, sellerId: listing\.sellerId, status: ListingStatus\.ACTIVE, updatedAt: updatedListing\.updatedAt \}/);
  });
});
