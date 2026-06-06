import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  parseBoundedDecimalParam,
  parseBoundedPositiveIntParam,
  parseTimestampMsParam,
} = await import("../src/lib/queryParams.ts");

describe("query parameter parsing helpers", () => {
  it("parses bounded positive integers without accepting malformed numbers", () => {
    assert.equal(parseBoundedPositiveIntParam("25", 10, 50), 25);
    assert.equal(parseBoundedPositiveIntParam("5000", 10, 50), 50);
    assert.equal(parseBoundedPositiveIntParam("0", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("-1", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("12abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("1.5", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam(null, 10, 50), 10);
  });

  it("accepts only finite valid millisecond timestamps", () => {
    assert.equal(parseTimestampMsParam("0"), 0);
    assert.equal(parseTimestampMsParam("1710000000000"), 1710000000000);
    assert.equal(parseTimestampMsParam(""), null);
    assert.equal(parseTimestampMsParam("-1"), null);
    assert.equal(parseTimestampMsParam("abc"), null);
    assert.equal(parseTimestampMsParam("Infinity"), null);
    assert.equal(parseTimestampMsParam("1e309"), null);
    assert.equal(parseTimestampMsParam("999999999999999999999"), null);
  });

  it("parses bounded decimals without accepting malformed or out-of-range values", () => {
    assert.equal(parseBoundedDecimalParam(" 29.7604 ", -90, 90), 29.7604);
    assert.equal(parseBoundedDecimalParam("-95.3698", -180, 180), -95.3698);
    assert.equal(parseBoundedDecimalParam(".5", 0, 1), 0.5);
    assert.equal(parseBoundedDecimalParam("1e2", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("Infinity", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("1e309", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("12abc", 0, 500), null);
    assert.equal(parseBoundedDecimalParam("91", -90, 90), null);
    assert.equal(parseBoundedDecimalParam("-181", -180, 180), null);
    assert.equal(parseBoundedDecimalParam("501", 1, 500), null);
  });

  it("keeps public browse and seller pagination bounded before Prisma skip", () => {
    for (const routePath of [
      "src/app/browse/page.tsx",
      "src/app/seller/[id]/shop/page.tsx",
      "src/app/seller/[id]/customer-photos/page.tsx",
    ]) {
      const source = readFileSync(routePath, "utf8");

      assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
      assert.match(source, /parseBoundedPositiveIntParam\(sp\.page, 1, 500\)/);
      assert.doesNotMatch(source, /Math\.max\(1,\s*Number\(sp\.page/);
      assert.doesNotMatch(source, /Number\(sp\.page/);
      assert.doesNotMatch(source, /Number\.parseInt\(sp\.page/);
    }
  });

  it("keeps private saved-page pagination finite and clamped before Prisma skip", () => {
    const source = readFileSync("src/app/account/saved/page.tsx", "utf8");

    assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
    assert.match(source, /const page = parseBoundedPositiveIntParam\(sp\.page, 1, 1000\)/);
    assert.match(source, /const listingPage = Math\.min\(page, Math\.max\(1, totalPages\)\)/);
    assert.match(source, /skip: \(listingPage - 1\) \* PAGE_SIZE/);
    assert.match(source, /<Pagination page=\{listingPage\} totalPages=\{totalPages\} baseHref=\{tabHref\("listings"\)\} \/>/);
    assert.match(source, /const postPage = Math\.min\(page, Math\.max\(1, totalPages\)\)/);
    assert.match(source, /skip: \(postPage - 1\) \* PAGE_SIZE/);
    assert.match(source, /<Pagination page=\{postPage\} totalPages=\{totalPages\} baseHref=\{tabHref\("posts"\)\} \/>/);
    assert.doesNotMatch(source, /Math\.max\(1,\s*parseInt\(sp\.page/);
    assert.doesNotMatch(source, /Number\(sp\.page/);
    assert.doesNotMatch(source, /Number\.parseInt\(sp\.page/);
  });

  it("keeps private order and notification pages clamped before Prisma skip", () => {
    const accountOrders = readFileSync("src/app/account/orders/page.tsx", "utf8");
    const dashboardSales = readFileSync("src/app/dashboard/sales/page.tsx", "utf8");
    const adminOrders = readFileSync("src/app/admin/orders/page.tsx", "utf8");
    const adminCases = readFileSync("src/app/admin/cases/page.tsx", "utf8");
    const adminFlagged = readFileSync("src/app/admin/flagged/page.tsx", "utf8");
    const notifications = readFileSync("src/app/dashboard/notifications/page.tsx", "utf8");

    for (const source of [accountOrders, dashboardSales, adminOrders, adminCases, adminFlagged, notifications]) {
      assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
      assert.match(source, /parseBoundedPositiveIntParam\(page(?:Param|Str), 1, 1000\)/);
      assert.doesNotMatch(source, /parseInt\(page(?:Param|Str)/);
      assert.doesNotMatch(source, /Number\.parseInt\(page(?:Param|Str)/);
    }

    assert.match(accountOrders, /const totalOrders = await prisma\.order\.count\(\{ where: \{ buyerId: me\.id \} \}\)/);
    assert.match(accountOrders, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.match(accountOrders, /skip: \(page - 1\) \* PAGE_SIZE/);

    assert.match(dashboardSales, /const total = await prisma\.order\.count\(\{ where \}\)/);
    assert.match(dashboardSales, /const safePage = Math\.min\(requestedPage, totalPages\)/);
    assert.match(dashboardSales, /skip: \(safePage - 1\) \* PAGE_SIZE/);

    assert.match(adminOrders, /const total = await prisma\.order\.count\(\)/);
    assert.match(adminOrders, /const safePage = Math\.min\(requestedPage, totalPages\)/);
    assert.match(adminOrders, /skip: \(safePage - 1\) \* PAGE_SIZE/);

    assert.match(adminCases, /const total = await prisma\.case\.count\(\{ where \}\)/);
    assert.match(adminCases, /const safePage = Math\.min\(requestedPage, totalPages\)/);
    assert.match(adminCases, /orderBy: \[\s*\{ resolvedAt: \{ sort: "asc", nulls: "first" \} \},\s*\{ createdAt: "desc" \},\s*\{ id: "desc" \},\s*\]/);
    assert.match(adminCases, /skip: \(safePage - 1\) \* PAGE_SIZE/);

    assert.match(adminFlagged, /const total = await prisma\.order\.count\(\{ where \}\)/);
    assert.match(adminFlagged, /const safePage = Math\.min\(requestedPage, totalPages\)/);
    assert.match(adminFlagged, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(adminFlagged, /skip: \(safePage - 1\) \* PAGE_SIZE/);

    assert.match(notifications, /const \[total, unreadCount\] = await Promise\.all\(/);
    assert.match(notifications, /const page = Math\.min\(requestedPage, totalPages\)/);
    assert.match(notifications, /skip: \(page - 1\) \* PAGE_SIZE/);
  });

  it("keeps private capped account lists stable on equal timestamps", () => {
    const account = readFileSync("src/app/account/page.tsx", "utf8");
    const saved = readFileSync("src/app/account/saved/page.tsx", "utf8");
    const following = readFileSync("src/app/account/following/page.tsx", "utf8");
    const blocked = readFileSync("src/app/account/blocked/page.tsx", "utf8");
    const dashboardOrders = readFileSync("src/app/dashboard/orders/page.tsx", "utf8");

    assert.match(account, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 5/);
    assert.match(account, /orderBy: \[\{ createdAt: "desc" \}, \{ listingId: "desc" \}\][\s\S]*take: 6/);
    assert.match(saved, /orderBy: \[\{ createdAt: "desc" \}, \{ listingId: "desc" \}\][\s\S]*skip: \(listingPage - 1\) \* PAGE_SIZE/);
    assert.match(saved, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*skip: \(postPage - 1\) \* PAGE_SIZE/);
    assert.match(following, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 50/);
    assert.match(following, /listings: \{[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 1/);
    assert.match(blocked, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 50/);
    assert.match(dashboardOrders, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: LIMIT/);
  });

  it("bounds browse location and shipping filters before query construction", () => {
    const browse = readFileSync("src/app/browse/page.tsx", "utf8");
    const filters = readFileSync("src/components/FilterSidebar.tsx", "utf8");

    assert.match(browse, /const MAX_SHIPS_WITHIN_DAYS = 365/);
    assert.match(browse, /const MAX_BROWSE_RADIUS_MILES = 500/);
    assert.match(browse, /parseBoundedPositiveIntParam\(sp\.ships, 0, MAX_SHIPS_WITHIN_DAYS\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.lat, -90, 90\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.lng, -180, 180\)/);
    assert.match(browse, /parseBoundedDecimalParam\(sp\.radius, 1, MAX_BROWSE_RADIUS_MILES\)/);
    assert.match(browse, /const ratingFilter = parseBoundedDecimalParam\(sp\.rating, 1, 5\)/);
    assert.doesNotMatch(browse, /Number\(sp\.lat/);
    assert.doesNotMatch(browse, /Number\(sp\.lng/);
    assert.doesNotMatch(browse, /Number\(sp\.radius/);
    assert.doesNotMatch(browse, /Number\(sp\.rating/);
    assert.match(filters, /name="ships"[\s\S]*max="365"/);
    assert.match(filters, /name="radius"[\s\S]*max="500"/);
  });
});
