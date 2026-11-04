import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

describe("message UI consistency", () => {
  it("shares the inbox controls between the inbox and an open thread", () => {
    const inbox = source("src/app/messages/page.tsx");
    const rail = source("src/components/ConversationRail.tsx");
    const controls = source("src/components/MessageInboxControls.tsx");
    assert.match(inbox, /<MessageInboxControls/);
    assert.match(rail, /<MessageInboxControls/);
    assert.match(rail, /onTabChange=\{setTab\}/);
    assert.match(rail, /onQueryChange=\{setQuery\}/);
    assert.match(controls, /const controlled = Boolean\(onTabChange \|\| onQueryChange\)/);
    assert.match(controls, /event\.preventDefault\(\)/);
    assert.doesNotMatch(rail, /className="sticky/);
    assert.match(source("src/components/MessagesShell.tsx"), /grid-cols-\[400px_minmax\(0,1fr\)\]/);
  });

  it("distinguishes Grainline account pages from provider sign-in security", () => {
    for (const path of ["src/components/Header.tsx", "src/components/UserAvatarMenu.tsx"]) {
      const component = source(path);
      assert.match(component, /My Account/);
      assert.match(component, /Sign-in &amp; security/);
      assert.doesNotMatch(component, />\s*Manage Account\s*</);
    }
  });

  it("keeps active inbox counts when archived or searched results are selected", () => {
    const inbox = source("src/app/messages/page.tsx");
    assert.match(inbox, /isArchivedTab \|\| q/);
    assert.match(inbox, /archived: false, query: "", cursor: null, limit: 51/);
    assert.match(inbox, /unreadTotal=\{unreadTotal\}/);
    assert.match(inbox, /awaitingReplyTotal=\{sentTotal\}/);
  });

  it("keeps a bounded path to older conversations beside an open thread", () => {
    const route = source("src/app/api/messages/inbox/route.ts");
    const rail = source("src/components/ConversationRail.tsx");
    assert.match(route, /limit: RAIL_CONVERSATIONS \+ 1/);
    assert.match(route, /hasMore: conversations\.length > RAIL_CONVERSATIONS/);
    assert.match(route, /url\.searchParams\.get\("tab"\)/);
    assert.match(route, /url\.searchParams\.get\("q"\)/);
    assert.match(rail, /Older conversations/);
  });

  it("preserves every thread action while the surrounding layout changes", () => {
    const thread = source("src/app/messages/[id]/page.tsx");
    for (const contract of [
      /<MarkReadClient id=\{id\}/,
      /<ThreadMessages/,
      /<MessageComposer/,
      /<ThreadCustomOrderButton/,
      /<BlockReportButton/,
      /async function archiveThread/,
      /async function unarchiveThread/,
      /normalizeMessageAttachments/,
    ]) {
      assert.match(thread, contract);
    }
  });
});
