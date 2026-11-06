import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const { recentCronRunsWithPartialIssues } = await import("../src/lib/cronRunPartialIssues.ts");

const db = new PGlite();
after(() => db.close());
await db.exec(`
  CREATE TABLE "CronRun" (
    "id" varchar(160) PRIMARY KEY,
    "jobName" varchar(100) NOT NULL,
    "bucket" varchar(32) NOT NULL,
    "status" varchar(32) NOT NULL,
    "result" jsonb,
    "startedAt" timestamp(3) NOT NULL
  );
`);

// A Prisma-shaped $queryRaw over PGlite: tagged-template values become $1, $2, ...
const client = {
  async $queryRaw(strings, ...values) {
    const text = strings.reduce((sql, part, i) => sql + "$" + i + part);
    return (await db.query(text, values)).rows;
  },
};

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
async function run(id, hours, result, status = "COMPLETED", jobName = "email-outbox") {
  await db.query(
    'INSERT INTO "CronRun" ("id","jobName","bucket","status","result","startedAt") VALUES ($1,$2,\'b\',$3,$4,$5)',
    [id, jobName, status, result === undefined ? null : JSON.stringify(result), hoursAgo(hours)],
  );
}

describe("ops-health partial-issue scan", () => {
  it("finds a partial failure from 20 hours ago behind hundreds of clean runs", async () => {
    await run("old_partial", 20, { processed: 3, failures: [{ id: "x" }] });
    for (let i = 0; i < 300; i++) await run(`clean_${i}`, i * 0.05, { processed: 1, failed: 0, failures: [] });
    await run("numeric", 5, { failed: 2 });
    await run("too_old", 30, { failures: [{ id: "y" }] });
    await run("still_running", 1, { failures: [{ id: "z" }] }, "RUNNING");
    await run("self", 1, { failures: [{ id: "z" }] }, "COMPLETED", "ops-health");
    await run("odd_shapes", 2, { errors: "not-array", failed: true, manualReview: "3" });
    await run("scalar", 2, 7);
    await run("no_result", 2, undefined);

    const rows = await recentCronRunsWithPartialIssues(client, new Date(now - 24 * 3600000), 50);
    assert.deepEqual(rows.map((row) => row.id).sort(), ["numeric", "old_partial"]);
  });
});
