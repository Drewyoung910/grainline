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

  it("keeps a 44px favorite target around a centered solid white circle", () => {
    const favorite = source("src/components/FavoriteButton.tsx");
    assert.match(favorite, /h-11 w-11/);
    // Solid white circle so the heart reads on any photo (Drew, 2026-10-30).
    assert.match(favorite, /absolute h-9 w-9 rounded-full bg-white\/95/);
    assert.doesNotMatch(favorite, /bg-black\/10|rgba\(0,0,0,0\.25\)/);
    // Pending saves ignore clicks without the disabled attribute, which
    // restyled the button mid-tap.
    assert.match(favorite, /if \(isPending\) return;/);
    assert.doesNotMatch(favorite, /disabled=\{isPending\}/);
    assert.match(favorite, /saved \? "fill-red-500 stroke-red-500" : "fill-transparent stroke-neutral-900"/);
    assert.match(favorite, /toast\(next \? "Saved to favorites\." : "Removed from favorites\.", "success"\)/);
    assert.doesNotMatch(favorite, /-translate-y-px/);
    assert.match(favorite, /0_0_0_1px_rgba\(44,31,26,0\.14\)/);
  });

  it("confirms saved blog changes with the same durable toast system", () => {
    const savedPost = source("src/components/SaveBlogButton.tsx");
    assert.match(savedPost, /toast\(data\.saved \? "Post saved\." : "Removed from saved posts\.", "success"\)/);
    assert.match(savedPost, /0_0_0_1px_rgba\(44,31,26,0\.14\)/);
    assert.match(savedPost, /const next = !saved;[\s\S]*setSaved\(next\)/);
    assert.match(savedPost, /aria-pressed=\{saved\}/);
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
