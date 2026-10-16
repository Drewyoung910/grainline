import assert from "node:assert/strict";
import { test } from "node:test";

import { expireBlockedPairCheckoutSessions } from "../src/lib/blockedPairCheckoutSessions.ts";

const nowSeconds = 2_000_000_000;
const session = (id, buyerId, sellerId) => ({
  id,
  metadata: { buyerId, sellerId },
});

test("blocked-pair expiry touches both pair directions and no unrelated checkout", async () => {
  const sessions = [
    session("cs_first", "user-a", "seller-b"),
    session("cs_second", "user-b", "seller-a"),
    session("cs_other_buyer", "user-c", "seller-b"),
    session("cs_other_seller", "user-a", "seller-c"),
  ];
  const calls = { list: [], expire: [], restore: [], report: [] };
  const result = await expireBlockedPairCheckoutSessions({
    targets: [
      { buyerId: "user-a", sellerId: "seller-b" },
      { buyerId: "user-b", sellerId: "seller-a" },
    ],
    nowSeconds,
  }, {
    list: async (params) => {
      calls.list.push(params);
      return { data: sessions, has_more: false };
    },
    expire: async (id) => { calls.expire.push(id); },
    restore: async (row, sellerId) => { calls.restore.push([row.id, sellerId]); },
    report: (error, context) => { calls.report.push([error, context]); },
  });

  assert.deepEqual(result, { checked: 2, expired: 2, failed: 0 });
  assert.deepEqual(calls.expire, ["cs_first", "cs_second"]);
  assert.deepEqual(calls.restore, [
    ["cs_first", "seller-b"],
    ["cs_second", "seller-a"],
  ]);
  assert.deepEqual(calls.report, []);
  assert.deepEqual(calls.list, [{
    created: { gte: nowSeconds - 2 * 60 * 60 },
    limit: 100,
    status: "open",
  }]);
});

test("blocked-pair expiry reports one provider failure and continues the other target", async () => {
  const reported = [];
  const restored = [];
  const result = await expireBlockedPairCheckoutSessions({
    targets: [
      { buyerId: "user-a", sellerId: "seller-b" },
      { buyerId: "user-b", sellerId: "seller-a" },
    ],
    nowSeconds,
  }, {
    list: async () => ({
      data: [
        session("cs_first", "user-a", "seller-b"),
        session("cs_second", "user-b", "seller-a"),
      ],
      has_more: false,
    }),
    expire: async (id) => {
      if (id === "cs_first") throw new Error("provider offline");
    },
    restore: async (row) => { restored.push(row.id); },
    report: (error, context) => { reported.push([error.message, context]); },
  });

  assert.deepEqual(result, { checked: 2, expired: 1, failed: 1 });
  assert.deepEqual(restored, ["cs_second"]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0][0], "provider offline");
  assert.deepEqual(reported[0][1], {
    stage: "expire",
    sessionId: "cs_first",
    buyerId: "user-a",
    sellerId: "seller-b",
  });
});
