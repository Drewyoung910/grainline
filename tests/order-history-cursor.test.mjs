import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderHistoryCursor,
  orderListCursorFromRow,
  parseOrderHistoryCursor,
} from "../src/lib/orderHistoryCursor.ts";

test("Order history cursors round-trip exact bounded navigation state", () => {
  const token = buildOrderHistoryCursor({
    direction: "older",
    page: 2,
    boundary: { createdAtEpochMillis: 1788166800000, orderId: "order-1" },
  });
  assert.deepEqual(parseOrderHistoryCursor(token), {
    direction: "older",
    page: 2,
    boundary: { createdAtEpochMillis: 1788166800000, orderId: "order-1" },
  });
  assert.deepEqual(orderListCursorFromRow({
    id: "order-2",
    createdAt: new Date("2026-08-31T08:00:00.000Z"),
  }), {
    createdAtEpochMillis: 1788163200000,
    orderId: "order-2",
  });
});

test("Order history cursors reject malformed, extended and out-of-range state", () => {
  assert.equal(parseOrderHistoryCursor("not-json"), null);
  assert.equal(parseOrderHistoryCursor(["duplicate"]), null);
  assert.equal(parseOrderHistoryCursor(Buffer.from(JSON.stringify({
    v: 1, d: "older", p: 2, t: 1, i: "order-1", extra: true,
  })).toString("base64url")), null);
  assert.equal(parseOrderHistoryCursor(Buffer.from(JSON.stringify({
    v: 1, d: "sideways", p: 2, t: 1, i: "order-1",
  })).toString("base64url")), null);
  assert.throws(() => buildOrderHistoryCursor({
    direction: "newer",
    page: 1001,
    boundary: { createdAtEpochMillis: 1, orderId: "order-1" },
  }), /cursor is invalid/);
});
