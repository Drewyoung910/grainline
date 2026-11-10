import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

describe("header, favorite, cart, and review regressions", () => {
  it("does not expose the private messages control while signed out", () => {
    const header = source("src/components/Header.tsx");
    assert.match(header, /<Show when="signed-in">\s*<MessageIconLink \/>\s*<\/Show>/);
    assert.doesNotMatch(header, /sign-in\?redirect_url=\/messages/);
  });

  it("keeps a 44px favorite target around a centered frosted circle", () => {
    const favorite = source("src/components/FavoriteButton.tsx");
    assert.match(favorite, /h-11 w-11/);
    assert.match(favorite, /absolute h-8 w-8 rounded-full bg-neutral-950\/55/);
    assert.match(favorite, /backdrop-blur-md/);
    assert.match(favorite, /group-hover\/fav:scale-\[1\.07\]/);
    // Pending saves ignore clicks without the disabled attribute, which
    // restyled the button mid-tap.
    assert.match(favorite, /if \(isPending\) return;/);
    assert.doesNotMatch(favorite, /disabled=\{isPending\}/);
    assert.match(favorite, /saved \? "fill-red-500 stroke-red-500" : "fill-transparent stroke-white"/);
    assert.match(favorite, /toast\(next \? "Saved to favorites\." : "Removed from favorites\.", "success"\)/);
    assert.doesNotMatch(favorite, /-translate-y-px/);
    assert.match(favorite, /0_0_0_1px_rgba\(255,255,255,0\.28\)/);
  });

  it("confirms saved blog changes with the same durable toast system", () => {
    const savedPost = source("src/components/SaveBlogButton.tsx");
    assert.match(savedPost, /toast\(data\.saved \? "Post saved\." : "Removed from saved posts\.", "success"\)/);
    assert.match(savedPost, /absolute h-8 w-8 rounded-full bg-neutral-950\/55/);
    assert.match(savedPost, /stroke="#FFFFFF"/);
  });

  it("provides a leaf review loader that mirrors review cards", () => {
    const path = "src/app/account/reviews/loading.tsx";
    assert.equal(existsSync(new URL(path, root)), true);
    const loader = source(path);
    assert.match(loader, /aria-label="Loading reviews"/);
    assert.match(loader, /card-section flex gap-4 p-4/);
    assert.match(loader, /h-16 w-16 shrink-0 rounded-lg/);
  });

  it("gives the listing review region one stable anchor", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const reviews = source("src/components/ReviewsSection.tsx");
    assert.doesNotMatch(listing, /<section id="reviews">/);
    assert.match(reviews, /<section id="reviews"/);
  });

  it("makes the cart fallback match its progress, items, gift, total, and action layout", () => {
    const cart = source("src/app/cart/page.tsx");
    assert.match(cart, /aria-label="Loading cart"/);
    assert.match(cart, /h-9 w-\[18rem\].*rounded-full/);
    assert.match(cart, /border-b border-neutral-200\/70 pb-3/);
    assert.match(cart, /h-16 w-16 shrink-0 animate-pulse/);
    assert.match(cart, /space-y-2 border-t border-neutral-100 px-4 py-3/);
    assert.match(cart, /h-11 w-full animate-pulse rounded-md/);
  });
});
