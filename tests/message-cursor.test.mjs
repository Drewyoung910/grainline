import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  messageAfterCursorWhere,
  messageBeforeCursorWhere,
  parseMessageCursor,
} = await import("../src/lib/messageCursor.ts");

describe("message keyset cursors", () => {
  it("parses bounded timestamp and id pairs and rejects malformed history cursors", () => {
    const cursor = parseMessageCursor("1710000000000", "msg_abc-123", { requireId: true });
    assert.equal(cursor?.createdAt.getTime(), 1710000000000);
    assert.equal(cursor?.id, "msg_abc-123");
    assert.equal(parseMessageCursor("1710000000000", "", { requireId: true }), null);
    assert.equal(parseMessageCursor("bad", "msg_1", { requireId: true }), null);
    assert.equal(parseMessageCursor("1710000000000", "bad/id", { requireId: true }), null);
  });

  it("keeps same-timestamp rows on the id tie-breaker in both directions", () => {
    const cursor = parseMessageCursor("1710000000000", "msg_b", { requireId: true });
    assert.ok(cursor);
    assert.deepEqual(messageAfterCursorWhere(cursor), {
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: "msg_b" } },
      ],
    });
    assert.deepEqual(messageBeforeCursorWhere(cursor), {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: "msg_b" } },
      ],
    });
  });

  it("retains timestamp-only compatibility for already-open older clients", () => {
    const cursor = parseMessageCursor("1710000000000", null);
    assert.ok(cursor);
    assert.equal(cursor.id, null);
    assert.deepEqual(messageAfterCursorWhere(cursor), {
      createdAt: { gt: cursor.createdAt },
    });
  });
});
