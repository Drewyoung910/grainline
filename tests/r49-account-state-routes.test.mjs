import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R49 account-state route guardrails", () => {
  it("uses account-state helpers before returning signed-in user-specific GET data", () => {
    const routePaths = [
      "src/app/api/messages/unread-count/route.ts",
      "src/app/api/follow/[sellerId]/route.ts",
      "src/app/api/search/suggestions/route.ts",
      "src/app/api/account/feed/route.ts",
      "src/app/api/listings/recently-viewed/route.ts",
    ];

    for (const routePath of routePaths) {
      const text = source(routePath);
      assert.match(text, /ensureUserByClerkId/);
      assert.match(text, /accountAccessErrorResponse/);
      assert.equal(
        text.includes("prisma.user.findUnique({ where: { clerkId: userId }"),
        false,
        `${routePath} should not bypass banned/deleted account checks with direct Clerk lookup`,
      );
    }
  });

  it("keeps review seller side effects behind a fresh seller-account check", () => {
    const text = source("src/app/api/reviews/route.ts");
    assert.match(text, /user: \{ select: \{ banned: true, deletedAt: true \} \}/);
    assert.match(text, /if \(listing\?\.seller\.userId && !listing\.seller\.user\.banned && !listing\.seller\.user\.deletedAt\)/);
  });

  it("logs block follow-cleanup failures through the shared server logger", () => {
    const text = source("src/app/api/users/[id]/block/route.ts");
    assert.match(text, /logServerError\(error, \{/);
    assert.match(text, /source: "block_follow_cleanup"/);
    assert.doesNotMatch(text, /console\.error\("Failed to remove follow rows after block:/);
    assert.equal(text.includes("catch { /* non-fatal */ }"), false);
  });

  it("keeps authenticated user-state reads rate-limited before fan-out database reads", () => {
    const shippingRoute = source("src/app/api/account/shipping-address/route.ts");
    assert.match(shippingRoute, /safeRateLimit\(shippingAddressRatelimit, userId\)/);
    assert.ok(
      shippingRoute.indexOf("safeRateLimit(shippingAddressRatelimit, userId)") <
        shippingRoute.indexOf("prisma.user.findUnique"),
      "shipping-address GET should rate-limit before reading the saved address",
    );

    const savedSearchRoute = source("src/app/api/search/saved/route.ts");
    const savedSearchGet = savedSearchRoute.slice(
      savedSearchRoute.indexOf("export async function GET"),
      savedSearchRoute.indexOf("export async function DELETE"),
    );
    assert.match(savedSearchRoute, /safeRateLimit\(savedSearchRatelimit, userId\)/);
    assert.ok(
      savedSearchGet.indexOf("safeRateLimit(savedSearchRatelimit, userId)") <
        savedSearchGet.indexOf("listOwnerSavedSearches(me.id)"),
      "saved-search GET should rate-limit before listing current-user saved searches",
    );

    const feedRoute = source("src/app/api/account/feed/route.ts");
    assert.match(feedRoute, /safeRateLimit\(accountFeedRatelimit, me\.id\)/);
    assert.doesNotMatch(feedRoute, /safeRateLimitOpen\(accountFeedRatelimit/);
    assert.ok(
      feedRoute.indexOf("safeRateLimit(accountFeedRatelimit, me.id)") <
        feedRoute.indexOf("prisma.follow.findMany"),
      "account-feed GET should fail closed before fan-out feed queries",
    );

    const recentlyViewedRoute = source("src/app/api/listings/recently-viewed/route.ts");
    assert.match(recentlyViewedRoute, /safeRateLimit\(searchRatelimit, `recently-viewed:\$\{getIP\(req\)\}`\)/);
    assert.doesNotMatch(recentlyViewedRoute, /safeRateLimitOpen\(searchRatelimit/);
    assert.ok(
      recentlyViewedRoute.indexOf("safeRateLimit(searchRatelimit") <
        recentlyViewedRoute.indexOf("prisma.listing.findMany"),
      "recently-viewed GET should fail closed before public listing reads",
    );
  });

  it("keeps account feed page size bounded even when limit is malformed", () => {
    const feedRoute = source("src/app/api/account/feed/route.ts");

    assert.match(feedRoute, /parseBoundedPositiveIntParam\(url\.searchParams\.get\("limit"\), 20, 50\)/);
    assert.doesNotMatch(feedRoute, /Math\.min\(parseInt\(url\.searchParams\.get\("limit"/);
  });

  it("canonicalizes saved-search tag order before duplicate lookup and create", () => {
    const savedSearchRoute = source("src/app/api/search/saved/route.ts");
    const savedSearchOwnerAccess = source("src/lib/savedSearchOwnerAccess.ts");

    assert.match(savedSearchRoute, /function normalizeSavedSearchTags/);
    assert.match(savedSearchRoute, /normalizeTags\(tags \?\? \[\], 20\)\.sort\(\(a, b\) => a\.localeCompare\(b\)\)/);
    assert.match(savedSearchRoute, /const normalizedTags = normalizeSavedSearchTags\(tags\)/);
    assert.match(savedSearchRoute, /tags: normalizedTags/);
    assert.match(savedSearchOwnerAccess, /tags: \{ equals: criteria\.tags \}/);
    assert.match(savedSearchOwnerAccess, /tags: criteria\.tags/);
  });

  it("minimizes saved-search coordinates before GET transport", () => {
    const savedSearchRoute = source("src/app/api/search/saved/route.ts");
    const getStart = savedSearchRoute.indexOf("export async function GET");
    const deleteStart = savedSearchRoute.indexOf("export async function DELETE", getStart);
    const getRoute = savedSearchRoute.slice(getStart, deleteStart);

    assert.match(savedSearchRoute, /function savedSearchCoordinateForTransport\(value: number \| null\)/);
    assert.match(savedSearchRoute, /Number\(value\.toFixed\(2\)\)/);
    assert.match(savedSearchRoute, /Number\(lat\.toFixed\(5\)\)/);
    assert.match(savedSearchRoute, /Number\(lng\.toFixed\(5\)\)/);
    assert.match(getRoute, /searches\.map\(\(search\) => \(\{/);
    assert.match(getRoute, /lat: savedSearchCoordinateForTransport\(search\.lat\)/);
    assert.match(getRoute, /lng: savedSearchCoordinateForTransport\(search\.lng\)/);
    assert.ok(
      getRoute.indexOf("listOwnerSavedSearches(me.id)") < getRoute.indexOf("searches.map"),
      "saved-search GET should minimize coordinates after loading the current user's rows",
    );
  });

  it("keeps saved-search dedupe, 25 cap, and create in one serializable transaction", () => {
    const savedSearchRoute = source("src/app/api/search/saved/route.ts");
    const savedSearchOwnerAccess = source("src/lib/savedSearchOwnerAccess.ts");

    assert.match(savedSearchRoute, /withSerializableRetry/);
    assert.match(savedSearchRoute, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(savedSearchRoute, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
    assert.ok(
      savedSearchRoute.indexOf("findDuplicateOwnerSavedSearch(me.id, criteria, tx)") <
        savedSearchRoute.indexOf("countOwnerSavedSearches(me.id, tx)") &&
        savedSearchRoute.indexOf("countOwnerSavedSearches(me.id, tx)") <
        savedSearchRoute.indexOf("createOwnerSavedSearch(me.id, criteria, tx)"),
      "saved-search POST should dedupe, count, and create inside the serializable transaction",
    );
    assert.match(savedSearchOwnerAccess, /export type SavedSearchOwnerAccessClient = Pick<Prisma\.TransactionClient, "savedSearch">/);
    assert.match(savedSearchOwnerAccess, /db\.savedSearch\.findFirst/);
    assert.match(savedSearchOwnerAccess, /db\.savedSearch\.count/);
    assert.match(savedSearchOwnerAccess, /db\.savedSearch\.create/);
  });

  it("prevents blocked users from creating favorite notifications", () => {
    const text = source("src/app/api/favorites/route.ts");

    assert.match(text, /prisma\.block\.findFirst/);
    assert.match(text, /\{ blockerId: me\.id, blockedId: listing\.seller\.userId \}/);
    assert.match(text, /\{ blockerId: listing\.seller\.userId, blockedId: me\.id \}/);
    assert.ok(
      text.indexOf("prisma.block.findFirst") < text.indexOf("prisma.favorite.upsert"),
      "favorite POST should check block state before writing the favorite",
    );
    assert.ok(
      text.indexOf("prisma.block.findFirst") < text.indexOf("await createNotification"),
      "favorite POST should check block state before notifying the seller",
    );
  });
});
