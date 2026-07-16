import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function exists(path) {
  return existsSync(new URL(path, root));
}

describe("route loading boundaries", () => {
  it("keeps broad parent loading boundaries out of nested route trees", () => {
    for (const path of [
      "src/app/account/loading.tsx",
      "src/app/dashboard/loading.tsx",
      "src/app/commission/loading.tsx",
      "src/app/blog/loading.tsx",
    ]) {
      assert.equal(exists(path), false, `${path} must not mask a child route loader`);
    }
  });

  it("keeps root-page fallbacks local to their own pages", () => {
    const pages = [
      ["src/app/account/page.tsx", "AccountOverviewSkeleton"],
      ["src/app/dashboard/page.tsx", "WorkshopSkeleton"],
      ["src/app/commission/page.tsx", "CommissionRoomSkeleton"],
      ["src/app/blog/page.tsx", "BlogIndexSkeleton"],
    ];

    for (const [path, skeleton] of pages) {
      const page = source(path);
      assert.match(page, /<Suspense fallback=\{/);
      assert.ok(page.includes(`<${skeleton} />`), `${path} should use ${skeleton}`);
    }
  });

  it("uses one shared feed skeleton before and after the route shell resolves", () => {
    assert.match(source("src/app/account/feed/loading.tsx"), /return <FeedSkeleton \/>/);
    assert.match(source("src/app/account/feed/FeedClient.tsx"), /if \(initialLoading\) \{\s*return <FeedSkeleton \/>/);
  });

  it("retains specific blog-detail and guild verification fallbacks", () => {
    assert.equal(exists("src/app/blog/[slug]/loading.tsx"), true);
    assert.match(source("src/app/dashboard/verification/loading.tsx"), /VerificationSkeleton/);
  });
});
