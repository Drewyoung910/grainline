import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
}

function renderPanel(props) {
  const path = "src/components/ListingPurchasePanel.tsx";
  const labelled = (label) => function Labelled() {
    return React.createElement("div", null, label);
  };
  const dependencies = {
    react: React,
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "./VariantSelector": { default: () => null },
    "./BuyNowButton": {
      default: function BuyNow({ children, resumeOnly }) {
        return React.createElement("button", { "data-resume-only": String(resumeOnly) }, children);
      },
    },
    "./AddToCartButton": { default: labelled("Add to cart") },
    "./NotifyMeButton": { default: labelled("Notify me") },
    "./RollingAmount": { default: () => "$50.00" },
    "./icons": { Gift: () => null },
    "@/lib/publicPaths": { publicListingPath: () => "/listing/one" },
    "@/lib/internalReturnUrl": { signUpPathForRedirect: () => "/sign-up" },
    "@/lib/money": { DEFAULT_CURRENCY: "usd", formatCurrencyCents: () => "$50.00" },
    "@/lib/listingVariantSelection": require("../src/lib/listingVariantSelection.ts"),
  };
  const exports = {};
  vm.runInNewContext(compile(readFileSync(path, "utf8")), {
    exports, React, URL, Set,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  }, { filename: path });
  return renderToStaticMarkup(React.createElement(exports.default, {
    basePriceCents: 5000, variantGroups: [], listingId: "one", listingTitle: "Bench", sellerId: "seller",
    sellerName: "Maker", userId: "buyer", sellerAcceptingNewOrders: true, isOwnListing: false,
    isNotified: false, listingType: "IN_STOCK", stockQuantity: 0, processingLabel: null,
    offersGiftWrapping: false, giftWrappingPriceCents: null, ratingDisplay: null, ratingCount: 0,
    isOutOfStock: true, canSubscribeForStockNotification: true,
    ...props,
  }));
}

test("a buyer holding the last unit is offered their checkout, not Out of Stock", () => {
  const html = renderPanel({ canBuy: true, checkoutHeld: true });
  assert.match(html, /Finish your checkout/);
  assert.match(html, /Held for you in your checkout/);
  assert.doesNotMatch(html, /Out of Stock/);
  assert.doesNotMatch(html, /Notify me/);
  assert.doesNotMatch(html, /Add to cart/);
  // If the hold has ended by the click, the dialog refreshes instead of starting
  // a checkout with no options chosen.
  assert.match(html, /data-resume-only="true"/);
});

test("everyone else still sees Out of Stock and Notify me", () => {
  const html = renderPanel({ canBuy: false, checkoutHeld: false });
  assert.match(html, /Out of Stock/);
  assert.match(html, /Notify me/);
  assert.doesNotMatch(html, /Finish your checkout/);
});

function pageStatement(prefix) {
  const path = "src/app/listing/[id]/page.tsx";
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  const visit = (node) => {
    if (ts.isVariableStatement(node) && node.getText(sf).startsWith(prefix)) found = node.getText(sf);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(found, `${prefix} is absent`);
  return found;
}

async function heldForViewer(lock, overrides = {}) {
  const scope = {
    isActive: true,
    isOutOfStock: true,
    isOwnListing: false,
    meId: "buyer",
    listingId: "one",
    listing: { listingType: "IN_STOCK" },
    singleCheckoutLockKey: (buyer, listing) => `${buyer}:${listing}`,
    getCheckoutLock: async () => {
      if (lock instanceof Error) throw lock;
      return lock;
    },
    ...overrides,
  };
  const names = Object.keys(scope);
  const body = compile(`${pageStatement("const checkoutHeldForViewer")}\nreturn checkoutHeldForViewer;`);
  const AsyncFunction = (async () => {}).constructor;
  return new AsyncFunction(...names, body)(...names.map((name) => scope[name]));
}

test("the page recognises the buyer's own open Buy Now, and only that", async () => {
  assert.equal(await heldForViewer({ state: "ready", sessionId: "cs" }), true);
  assert.equal(await heldForViewer({ state: "preparing" }), false);
  assert.equal(await heldForViewer(null), false);
  assert.equal(await heldForViewer(new Error("redis down")), false);
  assert.equal(await heldForViewer({ state: "ready" }, { meId: null }), false);
  assert.equal(await heldForViewer({ state: "ready" }, { isOwnListing: true }), false);
  assert.equal(await heldForViewer({ state: "ready" }, { isOutOfStock: false }), false);
});
