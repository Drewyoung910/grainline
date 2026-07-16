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

describe("seller route loading boundaries", () => {
  it("keeps nested blog and public shop routes out of broad parent fallbacks", () => {
    assert.equal(exists("src/app/dashboard/blog/loading.tsx"), false);
    assert.equal(exists("src/app/seller/[id]/loading.tsx"), false);

    assert.match(source("src/app/dashboard/blog/page.tsx"), /<Suspense fallback=\{<BlogManagerSkeleton \/>\}>/);
    assert.match(source("src/app/seller/[id]/page.tsx"), /<Suspense fallback=\{<SellerProfileSkeleton \/>\}>/);
  });

  it("uses route-specific leaf skeletons for seller creation and settings pages", () => {
    const loaders = [
      ["src/app/dashboard/listings/new/loading.tsx", "CreateListingSkeleton"],
      ["src/app/dashboard/profile/loading.tsx", "ShopProfileSkeleton"],
      ["src/app/dashboard/seller/loading.tsx", "SellerSettingsSkeleton"],
      ["src/app/seller/[id]/shop/loading.tsx", "SellerShopSkeleton"],
      ["src/app/map/loading.tsx", "MakerMapSkeleton"],
    ];

    for (const [path, skeleton] of loaders) {
      assert.equal(exists(path), true, `${path} should exist`);
      assert.match(source(path), new RegExp(`return <${skeleton} \\/>`));
    }

    assert.match(
      source("src/app/dashboard/blog/new/loading.tsx"),
      /return <BlogEditorSkeleton variant="new" \/>/,
    );
    assert.match(
      source("src/app/dashboard/blog/[id]/edit/loading.tsx"),
      /return <BlogEditorSkeleton variant="edit" \/>/,
    );
  });

  it("keeps the My Orders fallback local so order details are not masked", () => {
    assert.equal(exists("src/app/dashboard/orders/loading.tsx"), false);
    assert.match(source("src/app/dashboard/orders/page.tsx"), /<Suspense fallback=\{<BuyerOrdersSkeleton \/>\}>/);
  });

  it("defines each reported page as a distinct route-shaped skeleton", () => {
    const skeletons = source("src/components/SellerRouteSkeletons.tsx");
    for (const name of [
      "BlogManagerSkeleton",
      "BlogEditorSkeleton",
      "CreateListingSkeleton",
      "ShopProfileSkeleton",
      "SellerSettingsSkeleton",
      "BuyerOrdersSkeleton",
      "MakerMapSkeleton",
      "SellerShopSkeleton",
      "SellerProfileSkeleton",
    ]) {
      assert.match(skeletons, new RegExp(`export function ${name}\\(`));
    }
  });

  it("matches the distinct new-post, edit-post, and bare shop-card shells", () => {
    const skeletons = source("src/components/SellerRouteSkeletons.tsx");
    const editorStart = skeletons.indexOf("export function BlogEditorSkeleton");
    const listingStart = skeletons.indexOf("export function CreateListingSkeleton");
    const editor = skeletons.slice(editorStart, listingStart);
    assert.match(editor, /if \(variant === "edit"\)/);
    assert.match(editor, /className="mx-auto max-w-3xl p-8"/);
    assert.match(editor, /<section className="card-section p-6">/);

    const shopStart = skeletons.indexOf("export function SellerShopSkeleton");
    const profileStart = skeletons.indexOf("export function SellerProfileSkeleton");
    const shop = skeletons.slice(shopStart, profileStart);
    assert.match(shop, /aspect-\[4\/5\] w-full rounded-2xl/);
    assert.match(shop, /flex items-center gap-3 pt-2\.5/);
    assert.doesNotMatch(shop, /card-listing/);
  });
});
