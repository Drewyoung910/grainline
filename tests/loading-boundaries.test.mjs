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

  it("keeps account child fallbacks specific to their final routes", () => {
    const loaders = [
      ["src/app/account/following/loading.tsx", "Loading followed makers"],
      ["src/app/account/settings/loading.tsx", "Loading account settings"],
      ["src/app/account/blocked/loading.tsx", "Loading blocked users"],
      ["src/app/account/orders/loading.tsx", "Loading orders"],
      ["src/app/account/saved/loading.tsx", "Loading saved items"],
      ["src/app/account/reviews/loading.tsx", "Loading reviews"],
    ];

    for (const [path, label] of loaders) {
      assert.equal(exists(path), true, `${path} should provide its own loading boundary`);
      assert.ok(source(path).includes(`aria-label="${label}"`), `${path} should match its final route`);
    }

    const saved = source("src/app/account/saved/loading.tsx");
    assert.match(saved, /aspect-\[4\/5\]/);
    assert.doesNotMatch(saved, /card-section overflow-hidden/);

    const settings = source("src/app/account/settings/loading.tsx");
    assert.match(
      settings,
      /PreferenceCard rows=\{3\}[\s\S]*PreferenceCard rows=\{9\}[\s\S]*PreferenceCard rows=\{6\}[\s\S]*PreferenceCard rows=\{2\}/,
      "account settings should mirror all four notification cards and their row counts",
    );
  });

  it("retains specific blog-detail and guild verification fallbacks", () => {
    assert.equal(exists("src/app/blog/[slug]/loading.tsx"), true);
    assert.match(source("src/app/dashboard/verification/loading.tsx"), /VerificationSkeleton/);
  });
});
