import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  runBoundedDeletionBatches,
  runCronCursorPages,
} = await import("../src/lib/cronBatchState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("cron batch termination helpers", () => {
  it("stops cursor pagination on an empty first page", async () => {
    const cursors = [];
    const processed = [];

    const result = await runCronCursorPages({
      pageSize: 2,
      fetchPage: async (cursor) => {
        cursors.push(cursor);
        return [];
      },
      getCursor: (item) => item.id,
      processPage: async (items) => {
        processed.push(...items);
      },
    });

    assert.deepEqual(result, { pagesFetched: 1, itemsSeen: 0 });
    assert.deepEqual(cursors, [null]);
    assert.deepEqual(processed, []);
  });

  it("continues after a full cursor page and stops on a partial page", async () => {
    const cursors = [];
    const processed = [];
    const pages = new Map([
      [null, [{ id: "seller-1" }, { id: "seller-2" }]],
      ["seller-2", [{ id: "seller-3" }]],
    ]);

    const result = await runCronCursorPages({
      pageSize: 2,
      fetchPage: async (cursor) => {
        cursors.push(cursor);
        return pages.get(cursor) ?? [];
      },
      getCursor: (item) => item.id,
      processPage: async (items) => {
        processed.push(...items.map((item) => item.id));
      },
    });

    assert.deepEqual(result, { pagesFetched: 2, itemsSeen: 3 });
    assert.deepEqual(cursors, [null, "seller-2"]);
    assert.deepEqual(processed, ["seller-1", "seller-2", "seller-3"]);
  });

  it("stops cursor pagination when a full page is followed by an empty page", async () => {
    const cursors = [];

    const result = await runCronCursorPages({
      pageSize: 2,
      fetchPage: async (cursor) => {
        cursors.push(cursor);
        return cursor === null ? [{ id: "seller-1" }, { id: "seller-2" }] : [];
      },
      getCursor: (item) => item.id,
      processPage: async () => {},
    });

    assert.deepEqual(result, { pagesFetched: 2, itemsSeen: 2 });
    assert.deepEqual(cursors, [null, "seller-2"]);
  });

  it("marks deletion batches complete on zero or partial batch results", async () => {
    const empty = await runBoundedDeletionBatches({
      batchSize: 1000,
      timeBudgetMs: 60_000,
      deleteBatch: () => 0,
      now: () => 0,
    });
    assert.deepEqual(empty, { count: 0, complete: true });

    const partial = await runBoundedDeletionBatches({
      batchSize: 1000,
      timeBudgetMs: 60_000,
      deleteBatch: () => 125,
      now: () => 0,
    });
    assert.deepEqual(partial, { count: 125, complete: true });
  });

  it("marks deletion batches incomplete when the time budget is exhausted", async () => {
    let nowMs = 0;
    let calls = 0;

    const result = await runBoundedDeletionBatches({
      batchSize: 1000,
      timeBudgetMs: 25,
      deleteBatch: () => {
        calls += 1;
        nowMs += 10;
        return 1000;
      },
      now: () => nowMs,
    });

    assert.deepEqual(result, { count: 3000, complete: false });
    assert.equal(calls, 3);
  });

  it("routes long-running crons through shared termination helpers", () => {
    const guildMetrics = source("src/app/api/cron/guild-metrics/route.ts");
    const guildMemberCheck = source("src/app/api/cron/guild-member-check/route.ts");
    const notificationPrune = source("src/app/api/cron/notification-prune/route.ts");
    const emailOutbox = source("src/app/api/cron/email-outbox/route.ts");

    assert.match(guildMetrics, /runCronCursorPages\(\{/);
    assert.match(guildMetrics, /runBoundedDeletionBatches\(\{/);
    assert.match(guildMemberCheck, /runCronCursorPages\(\{/);
    assert.match(notificationPrune, /runBoundedDeletionBatches\(\{/);
    assert.match(emailOutbox, /processEmailOutboxBatch\(\{ take: 50, concurrency: 2 \}\)/);
  });
});
