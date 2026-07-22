import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("middleware account-state cache", () => {
  it("loads ban/delete/terms state through the cache with a DB fallback", () => {
    const middleware = source("src/middleware.ts");
    const cache = source("src/lib/accountStateCache.ts");

    assert.match(middleware, /getCachedAccountStateForMiddleware/);
    assert.match(middleware, /prisma\.user\.findUnique\(\{/);
    assert.match(middleware, /shouldRequireTermsAcceptance\(account\)/);
    assert.match(cache, /ACCOUNT_STATE_CACHE_TTL_SECONDS = 60/);
    assert.match(cache, /await loadAccount\(\)/);
    assert.match(cache, /source: "account_state_cache_read"/);
    assert.match(cache, /source: "account_state_cache_write"/);
  });

  it("distinguishes Redis misses from cached missing users", () => {
    const cache = source("src/lib/accountStateCache.ts");

    assert.match(cache, /\| \{ exists: false \}/);
    assert.match(cache, /if \(value === null\) return undefined/);
    assert.match(cache, /if \(record\.exists === false\) return null/);
    assert.match(cache, /if \(record\.exists !== true\) return undefined/);
  });

  it("isolates Preview account state from production Redis keys", () => {
    const cache = source("src/lib/accountStateCache.ts");

    assert.match(cache, /env\.VERCEL_ENV === "production"/);
    assert.match(cache, /env\.VERCEL_ENV === "preview"/);
    assert.match(cache, /VERCEL_GIT_COMMIT_REF \|\| env\.VERCEL_URL/);
    assert.match(cache, /createHash\("sha256"\)/);
    assert.match(cache, /account-state:\$\{accountStateCacheNamespace\(\)\}:clerk:/);
    assert.doesNotMatch(cache, /return `account-state:clerk:\$\{clerkId\}`/);
  });

  it("invalidates on account-state writes that affect middleware decisions", () => {
    assert.match(
      source("src/app/api/account/accept-terms/route.ts"),
      /invalidateAccountStateCache\(userId, "accept_terms_account_state_cache_invalidate"\)/,
    );
    assert.match(
      source("src/app/api/clerk/webhook/route.ts"),
      /invalidateAccountStateCache\(id, "clerk_webhook_terms_account_state_cache_invalidate"\)/,
    );
    assert.match(
      source("src/lib/ban.ts"),
      /invalidateAccountStateCache\(clerkSync\.clerkId, 'ban_user_account_state_cache_invalidate'\)/,
    );
    assert.match(
      source("src/lib/ban.ts"),
      /invalidateAccountStateCache\(clerkSync\.clerkId, 'unban_user_account_state_cache_invalidate'\)/,
    );
    assert.match(
      source("src/lib/audit.ts"),
      /invalidateAccountStateCache\(clerkUnbanTarget\.clerkId, 'admin_undo_ban_account_state_cache_invalidate'\)/,
    );
    assert.match(
      source("src/lib/accountDeletion.ts"),
      /invalidateAccountStateCache\(account\.clerkId, "account_delete_account_state_cache_invalidate"\)/,
    );
  });
});
