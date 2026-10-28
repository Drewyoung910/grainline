import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("maker dashboard control sizing and state announcements (#1245, #1247, #1248)", () => {
  it("shows a disabled notice instead of the broadcast composer for inactive shops", () => {
    const composer = source("src/components/BroadcastComposer.tsx");
    const settings = source("src/app/dashboard/seller/page.tsx");

    assert.match(composer, /disabledReason\?: string \| null;/);
    assert.match(composer, /\{disabledReason \? \([\s\S]*?\) : \(\s*<form onSubmit=\{handleSend\}/);
    assert.match(
      settings,
      /<BroadcastComposer[\s\S]*?disabledReason=\{\s*!currentRow\?\.chargesEnabled[\s\S]*?: currentRow\.vacationMode[\s\S]*?: null\s*\}/,
    );
  });

  it("announces broadcast errors and the follower count the API returns", () => {
    const composer = source("src/components/BroadcastComposer.tsx");
    const route = source("src/app/api/seller/broadcast/route.ts");

    // The success copy relies on this existing POST response field.
    assert.match(route, /return privateJson\(\{\s*broadcastId: broadcast\.id,\s*recipientCount: notificationFollowers\.length,/);
    assert.match(composer, /<p role="alert" className="text-sm text-red-600">\{error\}<\/p>/);
    assert.match(composer, /<p role="status"[^>]*>\{sentNotice\}<\/p>/);
    assert.match(composer, /Update sent to \$\{count\} follower\$\{count === 1 \? "" : "s"\}\./);
    assert.match(composer, /setSentNotice\(broadcastSentMessage\(data\)\)/);
  });

  it("keeps shop listing actions at 12px+ with coarse-pointer targets and Delete set apart", () => {
    const ui = source("src/app/seller/[id]/shop/ShopListingActions.tsx");

    assert.doesNotMatch(ui, /text-\[1[01]px\]/);
    for (const name of ["SHOP_ACTION_CLASS", "SHOP_WARNING_ACTION_CLASS", "SHOP_SUCCESS_ACTION_CLASS", "SHOP_DANGER_ACTION_CLASS"]) {
      const value = ui.match(new RegExp(`const ${name} =\\s*"([^"]+)"`))?.[1] ?? "";
      assert.match(value, /\btext-xs\b/, name);
      assert.match(value, /pointer-coarse:min-h-11/, name);
    }
    assert.match(ui, /flex flex-wrap gap-2/);
    // Delete renders last, after Edit, pushed to the far edge with extra padding.
    assert.ok(ui.indexOf("Edit →") < ui.indexOf("Delete\n"), "Delete should follow Edit");
    assert.match(ui, /<div className="ml-auto flex pl-2">\s*<button[\s\S]*?className=\{SHOP_DANGER_ACTION_CLASS\}/);
  });

  it("gives small maker controls 44px targets on touch", () => {
    const shop = source("src/app/seller/[id]/shop/page.tsx");
    const tags = source("src/components/TagsInput.tsx");
    const blog = source("src/app/dashboard/blog/page.tsx");
    const sales = source("src/app/dashboard/sales/page.tsx");

    const statusTabs = shop.slice(shop.indexOf("{STATUS_TABS.map((tab) =>"), shop.indexOf("{tab.label}"));
    assert.match(statusTabs, /inline-flex min-h-7 [^`]*pointer-coarse:min-h-11/);
    assert.doesNotMatch(statusTabs, /py-0\.5/);

    assert.match(tags, /aria-label=\{`Remove \$\{t\}`\}/);
    assert.match(tags, /h-6 w-6[^"]*pointer-coarse:h-11 pointer-coarse:w-11/);
    assert.doesNotMatch(tags, /className="rounded-full px-1 hover:bg-neutral-200"/);

    assert.equal(blog.match(/min-h-\[30px\][^"]*pointer-coarse:min-h-11"/g)?.length, 4);
    assert.equal(sales.match(/inline-flex items-center rounded-lg[^"]*pointer-coarse:min-h-11"/g)?.length, 4);
  });

  it("fits analytics totals at phone width and exposes toggle state", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    const overview = page.slice(page.indexOf("Section A: Overview"), page.indexOf("Section B: Engagement"));
    assert.equal(overview.match(/className="card-section min-w-0 p-4 sm:p-5"/g)?.length, 4);
    assert.equal(overview.match(/className="text-xl font-bold tabular-nums wrap-anywhere sm:text-2xl"/g)?.length, 4);
    assert.doesNotMatch(overview, /text-2xl font-bold"/);

    assert.match(page, /aria-pressed=\{range === r\.key\}/);
    assert.match(page, /aria-pressed=\{metric === m\.key\}/);
    assert.doesNotMatch(page, /reviewCount\} reviews\)/);
    assert.match(page, /reviewCount\} review\$\{data\.guildMetrics\.reviewCount === 1 \? "" : "s"\}\)/);
  });

  it("exposes MarkdownToolbar formatting state to assistive tech", () => {
    const toolbar = source("src/components/MarkdownToolbar.tsx");
    const activeButtons = [...toolbar.matchAll(/<button[\s\S]*?className=\{btnClass\(editor\.isActive\(([^)]*)\)\)\}/g)];

    assert.equal(activeButtons.length, 10);
    for (const [button, mark] of activeButtons) {
      if (mark === '"link"') {
        assert.match(button, /aria-expanded=\{showLinkInput\}/);
        assert.match(button, /aria-label=\{editor\.isActive\("link"\) \? "Edit link" : "Link"\}/);
      } else {
        assert.ok(button.includes(`aria-pressed={editor.isActive(${mark})}`), `${mark} toggle needs aria-pressed`);
      }
    }
  });
});
