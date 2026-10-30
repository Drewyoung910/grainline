import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Guards for the #1263, #1250 and #1296 UI nits: the notification bell's
// unread label, duplicated account/following/settings copy, feed shop-update
// wrapping, the single "Listing type" label, and admin nav current-page state.

function source(path) {
  return readFileSync(path, "utf8");
}

// Transpiles one TS/TSX module to CommonJS and evaluates it with mapped
// imports, so client components render without Next.js or a bundler.
function loadModule(path, modules = {}) {
  const output = ts.transpileModule(source(path), {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  const requireMapped = (name) => {
    if (name === "react") return React;
    if (!(name in modules)) throw new Error(`unmapped import ${name} in ${path}`);
    return modules[name];
  };
  // Classic JSX needs React in scope for files that never import it.
  const params = /from "react"/.test(source(path)) ? [] : ["React"];
  new Function(...params, "require", "module", "exports", output)(
    ...(params.length > 0 ? [React] : []),
    requireMapped,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const Link = ({ href, className, children, ...rest }) =>
  React.createElement("a", { href, className, "aria-current": rest["aria-current"] }, children);
const icons = new Proxy({}, {
  get: (_target, key) => (key === "__esModule" ? undefined : () => null),
});

let currentPath = "/";
const navigation = { usePathname: () => currentPath };

function adminModules() {
  return {
    "next/link": { __esModule: true, default: Link },
    "next/navigation": navigation,
    "@/components/icons": icons,
    "@/lib/adminNavState": loadModule("src/lib/adminNavState.ts"),
  };
}

function currentLinks(markup) {
  return [...markup.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((match) => match[1]);
}

describe("admin navigation current-page state (#1296)", () => {
  const counts = {
    openCaseCount: 0,
    reviewNeededOrderCount: 0,
    pendingVerificationCount: 0,
    pendingCommentCount: 0,
    pendingReviewCount: 0,
    openSupportRequestCount: 0,
  };

  it("marks only the exact section current in the mobile tab strip", () => {
    const AdminMobileNav = loadModule("src/components/AdminMobileNav.tsx", adminModules()).default;
    const cases = [
      ["/admin/reviews", ["/admin/reviews"]],
      ["/admin/review", ["/admin/review"]],
      ["/admin/review/listing_1", ["/admin/review"]],
      ["/admin/orders/order_1", ["/admin/orders"]],
      ["/admin/reviewsx", []],
    ];
    for (const [path, expected] of cases) {
      currentPath = path;
      const markup = renderToStaticMarkup(React.createElement(AdminMobileNav, counts));
      assert.deepEqual(currentLinks(markup), expected, path);
    }
  });

  it("highlights the desktop sidebar's current section with the same rule", () => {
    const AdminSidebarLink = loadModule("src/components/AdminSidebarLink.tsx", adminModules()).default;
    const render = (path, href) => {
      currentPath = path;
      return renderToStaticMarkup(
        React.createElement(AdminSidebarLink, { href, className: "flex text-sm" }, "Section"),
      );
    };
    assert.match(render("/admin/reviews", "/admin/reviews"), /aria-current="page"/);
    assert.match(render("/admin/reviews", "/admin/reviews"), /bg-\[#2C1F1A\] text-white/);
    assert.doesNotMatch(render("/admin/reviews", "/admin/review"), /aria-current/);
    assert.match(render("/admin/reviews", "/admin/review"), /text-neutral-700 hover:bg-neutral-100/);

    // Every desktop sidebar entry goes through the client link; counts stay
    // computed in the server layout.
    const layout = source("src/app/admin/layout.tsx");
    assert.doesNotMatch(layout, /<Link\b/);
    const sidebarHrefs = [...layout.matchAll(/<AdminSidebarLink\s+href="([^"]+)"/g)].map((m) => m[1]);
    const mobileHrefs = [...source("src/components/AdminMobileNav.tsx").matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...sidebarHrefs].sort(), [...mobileHrefs].sort());
    assert.match(layout, /reviewNeededOrderCount > 99 \? "99\+" : reviewNeededOrderCount/);
  });
});

describe("listing type card labels (#1250)", () => {
  it("renders one Listing type label with Category visible and labelled", () => {
    const fieldModules = {
      "@/lib/categories": loadModule("src/lib/categories.ts"),
      "@/lib/stockMutationState": loadModule("src/lib/stockMutationState.ts"),
      "@/lib/listingFulfillmentDays": loadModule("src/lib/listingFulfillmentDays.ts"),
    };
    const ListingTypeFields = loadModule("src/components/ListingTypeFields.tsx", fieldModules);
    const Section = loadModule("src/components/ListingTypeVariantSection.tsx", {
      "@/components/ListingTypeFields": ListingTypeFields,
      "@/components/VariantEditor": { __esModule: true, default: () => null },
    }).default;
    const markup = renderToStaticMarkup(React.createElement(Section));

    assert.equal(markup.match(/>Listing type</g)?.length ?? 0, 1);
    const categoryLabel = markup.match(/<label for="([^"]+)"[^>]*>Category<\/label>/);
    assert.ok(categoryLabel, "Category label is rendered and associated");
    assert.match(markup, new RegExp(`<select id="${categoryLabel[1]}" name="category"`));
    assert.ok(markup.indexOf(">Category<") < markup.indexOf(">Listing type<"));
    assert.match(markup, /name="listingType" value="MADE_TO_ORDER"/);
  });
});

describe("account and notification copy shown once (#1263)", () => {
  it("names unread notifications for screen readers on every page", () => {
    const bell = source("src/components/NotificationBell.tsx");
    assert.match(bell, /\{!n\.read && <span className="sr-only">Unread: <\/span>\}/);
    assert.doesNotMatch(bell, /overlay && !n\.read && <span className="sr-only">/);
  });

  it("shows the follower count once per followed maker", () => {
    const following = source("src/app/account/following/page.tsx");
    assert.match(following, /initialCount=\{s\.followerCount\}/);
    assert.equal(following.match(/s\.followerCount/g)?.length ?? 0, 1);
  });

  it("shows the account email once on My Account", () => {
    const account = source("src/app/account/page.tsx");
    assert.equal(account.match(/\{me\.email\}/g)?.length ?? 0, 1);
    assert.match(account, /<p className="[^"]*\bbreak-all\b[^"]*">\{me\.email\}<\/p>/);
  });

  it("says once per settings page that required email is always sent", () => {
    for (const path of ["src/app/account/settings/page.tsx", "src/app/dashboard/seller/page.tsx"]) {
      assert.equal(source(path).match(/always sent/g)?.length ?? 0, 1, path);
    }
  });

  it("keeps shop-update line breaks and wraps long URLs in the feed", () => {
    const feed = source("src/app/account/feed/FeedClient.tsx");
    const message = feed.match(/<p className="([^"]*)">\{item\.message\}<\/p>/);
    assert.ok(message, "broadcast message paragraph is present");
    assert.match(message[1], /\bwhitespace-pre-line\b/);
    assert.match(message[1], /\b(break-words|wrap-anywhere|wrap-break-word)\b/);
  });
});
