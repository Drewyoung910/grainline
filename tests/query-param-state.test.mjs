import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

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
    const ownerAccess = readFileSync("src/lib/savedBlogPostOwnerAccess.ts", "utf8");

    assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
    assert.match(source, /const page = parseBoundedPositiveIntParam\(sp\.page, 1, 1000\)/);
    assert.match(source, /const listingPage = Math\.min\(page, Math\.max\(1, totalPages\)\)/);
    assert.match(source, /sellerOwnerSavedListingPage\([\s\S]*\(listingPage - 1\) \* PAGE_SIZE/);
    assert.match(source, /<Pagination page=\{listingPage\} totalPages=\{totalPages\} baseHref=\{tabHref\("listings"\)\} \/>/);
    assert.match(source, /const postPage = Math\.min\(page, Math\.max\(1, totalPages\)\)/);
    assert.match(source, /ownerSavedBlogPostPageRows\(me\.id, \{[\s\S]*skip: \(postPage - 1\) \* PAGE_SIZE/);
    assert.match(ownerAccess, /skip,\s*take,[\s\S]*db\.savedBlogPost\.findMany/);
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
    const notificationOwnerAccess = readFileSync("src/lib/notificationOwnerAccess.ts", "utf8");
    const notificationRecipientSql = readFileSync(
      "docs/rls-drafts/notification-recipient-access.sql",
      "utf8",
    );

    for (const source of [adminOrders, adminCases, adminFlagged, notifications]) {
      assert.match(source, /import \{[^}]*parseBoundedPositiveIntParam[^}]*\} from "@\/lib\/queryParams";/);
      assert.match(source, /parseBoundedPositiveIntParam\(page(?:Param|Str), 1, 1000\)/);
      assert.doesNotMatch(source, /parseInt\(page(?:Param|Str)/);
      assert.doesNotMatch(source, /Number\.parseInt\(page(?:Param|Str)/);
    }

    for (const source of [accountOrders, dashboardSales]) {
      assert.match(source, /parseOrderHistoryCursor/);
      assert.match(source, /buildOrderHistoryCursor/);
      assert.doesNotMatch(source, /prisma\.order|skip:/);
    }

    assert.match(adminOrders, /readStaffOrderPage\([\s\S]*"ALL"[\s\S]*requestedPage/);
    assert.match(adminOrders, /totalCount: total, safePage, orders/);
    assert.doesNotMatch(adminOrders, /prisma\.order|skip:/);

    assert.match(
      adminCases,
      /getStaffCaseQueue\(\{[\s\S]*requestedPage,[\s\S]*pageSize: PAGE_SIZE/,
    );
    assert.match(adminCases, /const safePage = queue\.safePage/);
    assert.doesNotMatch(adminCases, /prisma\.case|skip:/);

    assert.match(adminFlagged, /readStaffOrderPage\([\s\S]*"REVIEW_NEEDED"[\s\S]*requestedPage/);
    assert.match(adminFlagged, /totalCount: total, safePage, orders/);
    assert.doesNotMatch(adminFlagged, /prisma\.order|skip:/);

    assert.match(notifications, /ownerNotificationPageData\(me\.id, \{/);
    assert.match(notifications, /requestedPage,\s*pageSize: PAGE_SIZE/);
    assert.match(notificationOwnerAccess, /public\.grainline_notification_page\(/);
    assert.match(notificationRecipientSql, /LEAST\(\s*bounded_requested_page,/);
    assert.match(notificationRecipientSql, /OFFSET \(\(SELECT bounds\.page FROM bounds\) - 1\) \* bounded_page_size/);
  });

  it("keeps admin queues capped and stably ordered", () => {
    const review = readFileSync("src/app/admin/review/page.tsx", "utf8");
    const verification = readFileSync("src/app/admin/verification/page.tsx", "utf8");
    const sellerGuildStaffPrivateAccess = readFileSync(
      "src/lib/sellerGuildStaffPrivateAccess.ts",
      "utf8",
    );
    const makerVerificationAccess = readFileSync(
      "src/lib/makerVerificationAccess.ts",
      "utf8",
    );
    const makerVerificationPreparation = readFileSync(
      process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH
        ?? "prisma/migrations/20261028040000_prepare_maker_verification_authorities/migration.sql",
      "utf8",
    );
    const blog = readFileSync("src/app/admin/blog/page.tsx", "utf8");
    const reports = readFileSync("src/app/admin/reports/page.tsx", "utf8");

    assert.match(review, /const REVIEW_QUEUE_LIMIT = 100/);
    assert.match(review, /prisma\.listing\.count\(\{ where: \{ status: "PENDING_REVIEW" \} \}\)/);
    assert.match(review, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
    assert.match(review, /take: REVIEW_QUEUE_LIMIT/);

    assert.match(verification, /makerVerificationStaffPendingCount\(staffClient, staff\.id\)/);
    assert.match(verification, /makerVerificationStaffPendingPage\(staffClient, \{[\s\S]*actorId: staff\.id,[\s\S]*take: STAFF_FETCH_SIZE/);
    assert.match(makerVerificationAccess, /grainline_maker_verification_staff_pending_page/);
    assert.match(makerVerificationPreparation, /WHERE verification\.status = 'PENDING'::public\."VerificationStatus"[\s\S]*ORDER BY verification\."appliedAt" ASC, verification\.id ASC[\s\S]*LIMIT p_take/);
    assert.match(verification, /sellerGuildStaffMasterPendingCount\(staffClient, staff\.id\)/);
    assert.match(verification, /sellerGuildStaffMasterPendingPage\(staffClient, \{[\s\S]*take: STAFF_FETCH_SIZE/);
    assert.match(verification, /sellerGuildStaffRosterCount\(staffClient, \{ actorId: staff\.id, cohort: "GUILD_MEMBER" \}\)/);
    assert.match(verification, /sellerGuildStaffRosterPage\(staffClient, \{[\s\S]*cohort: "GUILD_MEMBER"[\s\S]*take: STAFF_FETCH_SIZE/);
    assert.match(verification, /const STAFF_FETCH_SIZE = STAFF_PAGE_SIZE \+ 1/);
    assert.match(sellerGuildStaffPrivateAccess, /grainline_seller_guild_staff_master_pending_page/);
    assert.match(sellerGuildStaffPrivateAccess, /grainline_seller_guild_staff_roster_page/);
    assert.match(makerVerificationPreparation, /ORDER BY verification\."appliedAt" ASC, verification\.id ASC[\s\S]*LIMIT p_take/);
    assert.match(makerVerificationPreparation, /END DESC NULLS LAST,[\s\S]*seller\.id ASC[\s\S]*LIMIT p_take/);

    assert.match(blog, /where: \{ approved: false \}[\s\S]*orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\][\s\S]*take: 30/);
    assert.match(reports, /where: \{ resolved: false \}[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*take: 50/);
  });

  it("keeps private capped account lists stable on equal timestamps", () => {
    const account = readFileSync("src/app/account/page.tsx", "utf8");
    const saved = readFileSync("src/app/account/saved/page.tsx", "utf8");
    const following = readFileSync("src/app/account/following/page.tsx", "utf8");
    const blocked = readFileSync("src/app/account/blocked/page.tsx", "utf8");
    const blockAccess = readFileSync("src/lib/blocks.ts", "utf8");
    const blockEmailAuthority = readFileSync(
      "prisma/migrations/20261007030000_prepare_user_block_email_authorities/migration.sql",
      "utf8",
    );
    const dashboardOrders = readFileSync("src/app/dashboard/orders/page.tsx", "utf8");
    const orderSummaryAuthority = readFileSync(
      "prisma/migrations/20260901080000_prepare_order_participant_summary_authority/migration.sql",
      "utf8",
    );

    assert.match(account, /readBuyerOrderSummaryPage\(\{ actorUserId: me\.id, limit: 5 \}\)/);
    assert.match(account, /sellerOwnerSavedListingPage\(me\.id, 6, 0\)/);
    assert.match(saved, /sellerOwnerSavedListingPage\([\s\S]*\(listingPage - 1\) \* PAGE_SIZE/);
    const savedListingMigration = readFileSync(
      "prisma/migrations/20261020040000_prepare_seller_profile_account_feed_cards/migration.sql",
      "utf8",
    );
    assert.match(savedListingMigration, /ORDER BY favorite\."createdAt" DESC, favorite\."listingId" DESC/);
    const savedBlogPostOwnerAccess = readFileSync("src/lib/savedBlogPostOwnerAccess.ts", "utf8");
    const savedBlogPostMigration = readFileSync(
      "prisma/migrations/20261020235800_prepare_seller_profile_owner_saved_blog_posts/migration.sql",
      "utf8",
    );
    assert.match(saved, /ownerSavedBlogPostPageRows\(me\.id, \{[\s\S]*skip: \(postPage - 1\) \* PAGE_SIZE/);
    assert.match(savedBlogPostOwnerAccess, /grainline_seller_owner_saved_blog_post_page[\s\S]*skip > 23976/);
    assert.match(savedBlogPostMigration, /ORDER BY saved\."createdAt" DESC, saved\.id DESC/);
    assert.match(following, /const PAGE_SIZE = 20/);
    assert.match(following, /sellerOwnerFollowingPage\([\s\S]*\(page - 1\) \* PAGE_SIZE/);
    const followingMigration = readFileSync(
      "prisma/migrations/20261019170000_prepare_seller_profile_follow_authority/migration.sql",
      "utf8",
    );
    assert.match(followingMigration, /ORDER BY relationship\."createdAt" DESC, relationship\.id DESC/);
    assert.match(followingMigration, /ORDER BY listing\."createdAt" DESC, listing\.id DESC/);
    assert.match(blocked, /getBlockedAccountsFor\(me\.id\)/);
    assert.match(blockAccess, /grainline_user_blocked_account_page\(\)/);
    assert.match(blockEmailAuthority, /ORDER BY relationship\."createdAt" DESC, relationship\.id DESC[\s\S]*LIMIT 50/);
    assert.match(dashboardOrders, /readBuyerOrderSummaryPage\(\{ actorUserId: me\.id, limit: LIMIT \}\)/);
    assert.match(orderSummaryAuthority, /ORDER BY source_order\."createdAt" DESC, source_order\.id DESC[\s\S]*LIMIT p_limit/g);
  });

  it("bounds browse location and shipping filters before query construction", () => {
    const browse = readFileSync("src/app/browse/page.tsx", "utf8");
    const filters = readFileSync("src/components/FilterSidebar.tsx", "utf8");
    const map = readFileSync("src/app/map/page.tsx", "utf8");

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
    assert.match(map, /parseBoundedDecimalParam\(latStr, -90, 90\)/);
    assert.match(map, /parseBoundedDecimalParam\(lngStr, -180, 180\)/);
    assert.match(map, /parseBoundedPositiveIntParam\(zoom, 3, 18\)/);
    assert.doesNotMatch(map, /Number\(latStr\)/);
    assert.doesNotMatch(map, /Number\(lngStr\)/);
    assert.doesNotMatch(map, /parseInt\(zoom/);
    assert.match(filters, /name="ships"[\s\S]*max="365"/);
    assert.match(filters, /name="radius"[\s\S]*max="500"/);
  });
});
