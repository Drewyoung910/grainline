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
});
