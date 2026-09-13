import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeRecentlyViewedIds,
  recentlyViewedAuthTransition,
  recentlyViewedCookieAttributes,
} = await import("../src/lib/recentlyViewed.ts");

const recentlyViewedComponent = readFileSync("src/components/RecentlyViewed.tsx", "utf8");
const recentlyViewedRoute = readFileSync("src/app/api/listings/recently-viewed/route.ts", "utf8");

describe("recently viewed cookie helpers", () => {
  it("keeps only unique non-empty string listing ids", () => {
    const ids = normalizeRecentlyViewedIds(["a", { id: "b" }, "b", "", 5, "a", "c"]);
    assert.deepEqual(ids, ["a", "b", "c"]);
  });

  it("caps the cookie payload to ten listing ids", () => {
    const ids = normalizeRecentlyViewedIds(Array.from({ length: 12 }, (_, index) => `listing-${index}`));
    assert.equal(ids.length, 10);
    assert.equal(ids.at(-1), "listing-9");
  });

  it("clears recently viewed state on sign-out or user switch", () => {
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: null }),
      { shouldClear: true, nextUserId: null },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: "user_b" }),
      { shouldClear: true, nextUserId: "user_b" },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: "user_a", currentUserId: "user_a" }),
      { shouldClear: false, nextUserId: "user_a" },
    );
    assert.deepEqual(
      recentlyViewedAuthTransition({ previousUserId: null, currentUserId: "user_a" }),
      { shouldClear: false, nextUserId: "user_a" },
    );
  });

  it("marks recently viewed cookies Secure on HTTPS while preserving local HTTP development", () => {
    assert.equal(recentlyViewedCookieAttributes("https:"), "path=/; SameSite=Lax; Secure");
    assert.equal(recentlyViewedCookieAttributes("http:"), "path=/; SameSite=Lax");
  });

  it("persists server-filtered recently viewed IDs after loading listings", () => {
    assert.match(
      recentlyViewedComponent,
      /import \{ getRecentlyViewed, setRecentlyViewed \} from "@\/lib\/recentlyViewed"/,
    );
    assert.match(recentlyViewedComponent, /setRecentlyViewed\(Array\.isArray\(data\.ids\) \? data\.ids/);
  });

  it("returns and renders saved state for recently viewed favorite buttons", () => {
    assert.match(recentlyViewedRoute, /prisma\.favorite\.findMany/);
    assert.match(recentlyViewedRoute, /saved: savedListingIds\.has\(r\.id\)/);
    assert.match(recentlyViewedComponent, /<FavoriteButton listingId=\{l\.id\} initialSaved=\{l\.saved\} \/>/);
  });
});
