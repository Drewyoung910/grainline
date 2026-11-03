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

  it("keeps a 44px favorite target around a smaller solid white circle", () => {
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
  });

  it("provides a leaf review loader that mirrors review cards", () => {
    const path = "src/app/account/reviews/loading.tsx";
    assert.equal(existsSync(new URL(path, root)), true);
    const loader = source(path);
    assert.match(loader, /aria-label="Loading reviews"/);
    assert.match(loader, /card-section flex gap-4 p-4/);
    assert.match(loader, /h-16 w-16 shrink-0 rounded-lg/);
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
