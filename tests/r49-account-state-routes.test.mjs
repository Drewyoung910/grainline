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

  it("logs block follow-cleanup failures instead of swallowing them silently", () => {
    const text = source("src/app/api/users/[id]/block/route.ts");
    assert.match(text, /console\.error\("Failed to remove follow rows after block:", error\)/);
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
    assert.match(savedSearchRoute, /safeRateLimit\(savedSearchRatelimit, userId\)/);
    assert.ok(
      savedSearchRoute.indexOf("safeRateLimit(savedSearchRatelimit, userId)") <
        savedSearchRoute.indexOf("prisma.savedSearch.findMany"),
      "saved-search GET should rate-limit before listing current-user saved searches",
    );
  });

  it("keeps account feed page size bounded even when limit is malformed", () => {
    const feedRoute = source("src/app/api/account/feed/route.ts");

    assert.match(feedRoute, /parseBoundedPositiveIntParam\(url\.searchParams\.get\("limit"\), 20, 50\)/);
    assert.doesNotMatch(feedRoute, /Math\.min\(parseInt\(url\.searchParams\.get\("limit"/);
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
