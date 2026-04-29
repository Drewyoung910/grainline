import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  accountFeedCursorTieMode,
  buildAccountFeedCursor,
  compareAccountFeedItemsDesc,
  isAccountFeedItemAfterCursor,
  parseAccountFeedCursor,
} = await import("../src/lib/accountFeedCursor.ts");

describe("account feed cursor helpers", () => {
  it("round-trips stable structured cursors", () => {
    const item = { kind: "listing", id: "lst_2", date: "2026-04-28T12:00:00.000Z" };
    const parsed = parseAccountFeedCursor(buildAccountFeedCursor(item));
    assert.equal(parsed?.date.toISOString(), item.date);
    assert.equal(parsed?.id, item.id);
    assert.equal(parsed?.kind, item.kind);
    assert.equal(parsed?.legacy, false);
  });

  it("keeps legacy ISO cursor support", () => {
    const parsed = parseAccountFeedCursor("2026-04-28T12:00:00.000Z");
    assert.equal(parsed?.date.toISOString(), "2026-04-28T12:00:00.000Z");
    assert.equal(parsed?.legacy, true);
    assert.equal(parseAccountFeedCursor("not-a-cursor"), null);
  });

  it("sorts ties deterministically by kind and id", () => {
    const date = "2026-04-28T12:00:00.000Z";
    const items = [
      { kind: "broadcast", id: "b_1", date },
      { kind: "listing", id: "l_1", date },
      { kind: "blog", id: "p_1", date },
      { kind: "listing", id: "l_2", date },
    ].sort(compareAccountFeedItemsDesc);
    assert.deepEqual(items.map((item) => `${item.kind}:${item.id}`), [
      "listing:l_2",
      "listing:l_1",
      "blog:p_1",
      "broadcast:b_1",
    ]);
  });

  it("identifies same-timestamp items after a structured cursor", () => {
    const cursor = parseAccountFeedCursor(buildAccountFeedCursor({
      kind: "listing",
      id: "l_1",
      date: "2026-04-28T12:00:00.000Z",
    }));
    assert.ok(cursor);
    assert.equal(isAccountFeedItemAfterCursor({ kind: "blog", id: "p_1", date: "2026-04-28T12:00:00.000Z" }, cursor), true);
    assert.equal(isAccountFeedItemAfterCursor({ kind: "listing", id: "l_0", date: "2026-04-28T12:00:00.000Z" }, cursor), true);
    assert.equal(isAccountFeedItemAfterCursor({ kind: "listing", id: "l_2", date: "2026-04-28T12:00:00.000Z" }, cursor), false);
  });

  it("reports source tie modes for Prisma keyset filters", () => {
    const cursor = parseAccountFeedCursor(buildAccountFeedCursor({
      kind: "blog",
      id: "p_1",
      date: "2026-04-28T12:00:00.000Z",
    }));
    assert.ok(cursor);
    assert.equal(accountFeedCursorTieMode("listing", cursor), "none");
    assert.equal(accountFeedCursorTieMode("blog", cursor), "after-id");
    assert.equal(accountFeedCursorTieMode("broadcast", cursor), "all");
  });
});
