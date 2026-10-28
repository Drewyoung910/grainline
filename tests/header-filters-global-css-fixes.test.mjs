import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const require = createRequire(import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function between(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end} after ${start}`);
  return text.slice(from, to);
}

describe("header signed-out requests and anonymous cart badge (UI-01 / #287)", () => {
  const header = source("src/components/Header.tsx");
  const loadAll = between(header, "const loadAll = React.useCallback", "}, [isLoaded, isSignedIn,");

  it("decides signed-in state from Clerk, not from /api/me answering 200", () => {
    assert.match(header, /const \{ isLoaded, isSignedIn \} = useUser\(\)/);
    const notLoaded = loadAll.indexOf("if (!isLoaded) return;");
    const signedOut = loadAll.indexOf("if (!isSignedIn) {");
    const meFetch = loadAll.indexOf('fetch("/api/me"');
    assert.ok(notLoaded > -1 && signedOut > -1 && meFetch > -1);
    assert.ok(notLoaded < meFetch && signedOut < meFetch, "guests must return before any API request");
  });

  it("only requests the signed-in cart and notification counts for a real session", () => {
    const roleGuard = loadAll.indexOf("if (!data?.role) {");
    assert.ok(roleGuard > -1);
    assert.ok(roleGuard < loadAll.indexOf("loadCartCount();"));
    assert.ok(roleGuard < loadAll.indexOf("loadNotifCount();"));
  });

  it("shows the anonymous cart count for guests", () => {
    const signedOutState = between(loadAll, "const showSignedOutState = () => {", "};");
    assert.match(signedOutState, /loadAnonymousCartCount\(\);/);
    assert.match(signedOutState, /setIsLoggedIn\(false\);/);
    assert.match(header, /if \(isLoggedIn\) loadCartCount\(\);\s*else loadAnonymousCartCount\(\);/);
  });
});

describe("mobile menu landmarks and focus return (UI-26)", () => {
  const header = source("src/components/Header.tsx");

  it("names the menu and its inner navigation distinctly", () => {
    assert.equal((header.match(/aria-label="Main navigation"/g) ?? []).length, 1);
    assert.match(header, /role="dialog"\s*aria-label="Menu"/);
    assert.match(header, /<nav\s+ref=\{drawerNavRef\}\s+aria-label="Site"/);
  });

  it("returns focus to the menu button on every close path", () => {
    assert.match(header, /ref=\{menuButtonRef\}\s*onClick=\{openDrawer\}/);
    // Animated closes (X, Escape, click-catcher, link taps) and the instant
    // close on navigation both record whether focus should come back.
    assert.equal((header.match(/restoreMenuFocusRef\.current = shouldRestoreMenuFocus\(\)/g) ?? []).length, 2);
    assert.match(header, /if \(drawerOpen \|\| !restoreMenuFocusRef\.current\) return;[\s\S]*?menuButtonRef\.current\?\.focus\(\)/);
    // Focus that moved elsewhere on purpose is left alone.
    assert.match(header, /active === document\.body \|\| Boolean\(drawerRef\.current\?\.contains\(active\)\)/);
  });
});

describe("mobile filter and sort sheets (UI-17 / #1234)", () => {
  const sheets = source("src/components/MobileFilterBar.tsx");
  const header = source("src/components/Header.tsx");

  it("stack the backdrop and sheet above the site header", () => {
    const headerZ = Number(header.match(/\} z-\[(\d+)\] text-neutral-900/)?.[1]);
    assert.equal(headerZ, 50);
    const sheetZ = [...sheets.matchAll(/fixed inset-(?:0|x-0 bottom-0) z-\[(\d+)\]/g)].map((m) => Number(m[1]));
    assert.equal(sheetZ.length, 4, "two backdrops and two sheets");
    for (const z of sheetZ) assert.ok(z > headerZ, `z-[${z}] must cover the header`);
    assert.doesNotMatch(sheets, /fixed inset-0 z-40|z-50 flex flex-col bg-white/);
  });

  it("drop the decorative drag handle and fit the visible viewport and safe area", () => {
    assert.doesNotMatch(sheets, /Drag handle|h-1 w-10 rounded-full bg-neutral-300/);
    assert.match(sheets, /max-h-\[85dvh\]/);
    assert.match(sheets, /max-h-\[50dvh\]/);
    assert.doesNotMatch(sheets, /max-h-\[(?:85|50)vh\]/);
    assert.equal((sheets.match(/env\(safe-area-inset-bottom\)/g) ?? []).length, 2);
    assert.equal((sheets.match(/after:top-full after:h-24 after:bg-white/g) ?? []).length, 2);
  });

  it("pin Apply and Reset outside the scrolling filter list", () => {
    const form = between(sheets, "const form = (", "const filterActions = (");
    assert.doesNotMatch(form, /type="submit"/);
    assert.match(form, /id=\{filterFormId\}/);
    assert.match(sheets, /type="submit"\s*form=\{filterFormId\}/);
    const filterSheet = between(sheets, 'aria-label="Filters"', "const sortSheet");
    assert.ok(
      filterSheet.indexOf("{filterActions}") > filterSheet.indexOf("{tagsSection}"),
      "actions render after the scroll area",
    );
  });
});

describe("maker map cluster labels (UI-13)", () => {
  it("uses a font the OpenFreeMap liberty style serves", () => {
    const map = source("src/components/AllSellersMap.tsx");
    assert.match(map, /style: "https:\/\/tiles\.openfreemap\.org\/styles\/liberty"/);
    assert.match(map, /"text-font": \["Noto Sans Regular"\]/);
  });
});

describe("global CSS layering (UI-08, UI-11, #1270, #1275)", () => {
  const postcss = require("postcss");
  const css = source("src/app/globals.css");
  const ast = postcss.parse(css);

  function layerOf(selector) {
    const found = [];
    ast.walkRules((rule) => {
      if (rule.selectors.includes(selector)) {
        const parent = rule.parent;
        found.push(parent.type === "atrule" ? `@${parent.name} ${parent.params}`.trim() : "unlayered");
      }
    });
    return found;
  }

  it("defaults bare borders to the light neutral in @layer base (UI-08)", () => {
    let rule = null;
    ast.walkDecls("border-color", (decl) => {
      if (decl.value === "var(--color-neutral-200, currentColor)") rule = decl.parent;
    });
    assert.ok(rule, "missing default border-color rule");
    assert.deepEqual(rule.selectors, ["*", "::after", "::before", "::backdrop", "::file-selector-button"]);
    assert.equal(rule.parent.type, "atrule");
    assert.equal(`${rule.parent.name} ${rule.parent.params}`, "layer base");
  });

  it("puts the card classes in @layer components so utilities override them (UI-11)", () => {
    for (const selector of [".card-listing", ".card-listing:hover", ".card-section", ".card-warm", ".card-warm:hover"]) {
      assert.deepEqual(layerOf(selector), ["@layer components"], selector);
    }
  });

  it("registers font-display as a utility so variants work (#1270)", () => {
    assert.deepEqual(layerOf(".font-display"), []);
    let utility = null;
    ast.walkAtRules("utility", (rule) => {
      if (rule.params === "font-display") utility = rule;
    });
    assert.ok(utility, "missing @utility font-display");
    assert.match(utility.toString(), /font-family: Georgia, 'Times New Roman', serif;/);
  });

  it("hides the prose backticks around Seller Handbook code words (#1275)", () => {
    const handbook = source("src/app/seller-handbook/page.tsx");
    assert.match(handbook, /prose-code:before:content-none prose-code:after:content-none/);
    assert.match(handbook, /prose-h2:font-display/);
    assert.match(source("src/app/help/shipping-and-returns/page.tsx"), /prose-headings:font-display/);
    assert.match(source("src/app/help/trust-and-safety/page.tsx"), /prose-headings:font-display/);
  });

  it("compiles the variants and layers with the real Tailwind build", async () => {
    const tailwind = require("@tailwindcss/postcss");
    const input = fileURLToPath(new URL("src/app/globals.css", root));
    const result = await postcss([tailwind({ base: rootPath, optimize: false })]).process(css, { from: input });
    const out = postcss.parse(result.css);
    const owners = new Map();
    out.walkRules((rule) => {
      for (const selector of rule.selectors) {
        let node = rule.parent;
        while (node && !(node.type === "atrule" && node.name === "layer")) node = node.parent;
        if (!owners.has(selector)) owners.set(selector, node ? node.params : "unlayered");
      }
    });
    assert.equal(owners.get(".card-section"), "components");
    assert.equal(owners.get(".card-listing"), "components");
    assert.equal(owners.get(".card-warm"), "components");
    assert.equal(owners.get(".prose-headings\\:font-display"), "utilities");
    assert.equal(owners.get(".prose-h2\\:font-display"), "utilities");
    assert.equal(owners.get(".prose-code\\:before\\:content-none"), "utilities");
    assert.equal(owners.get(".prose-code\\:after\\:content-none"), "utilities");
  });
});

describe("branded root error page (UI-09)", () => {
  const page = source("src/app/global-error.tsx");

  it("renders its own branded document with a retry and a way home", () => {
    assert.doesNotMatch(page, /next\/error/);
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.match(page, /background: "#F7F5F0"/);
    assert.match(page, /fontFamily: "Georgia, 'Times New Roman', serif"/);
    assert.match(page, /reset,\s*\}: \{/);
    assert.match(page, /onClick=\{reset\}[\s\S]*?Try again/);
    assert.match(page, /<a\s+href="\/"[\s\S]*?background: "#2C1F1A"[\s\S]*?Go home/);
    assert.match(page, /Sentry\.captureException\(error\)/);
  });
});

describe("variant selection reminder", () => {
  it("waits until the buyer has started choosing", () => {
    const selector = source("src/components/VariantSelector.tsx");
    assert.match(selector, /const anySelected = groups\.some\(\(g\) => selected\[g\.id\]\);/);
    assert.match(selector, /groups\.length > 0 && anySelected && !allSelected && \(/);
  });
});

describe("homepage stat labels (#1271)", () => {
  it("are readable on phones without changing the four-stat structure", () => {
    const home = source("src/app/page.tsx");
    const band = between(home, "<dl", "</dl>");
    assert.equal((band.match(/<dt\b/g) ?? []).length, 4);
    assert.equal((band.match(/<dd\b/g) ?? []).length, 4);
    assert.equal((band.match(/text-\[10px\] leading-tight text-\[#2C1F1A\]\/80 sm:text-xs/g) ?? []).length, 4);
    assert.doesNotMatch(band, /text-\[9px\]|\/65/);
  });
});
