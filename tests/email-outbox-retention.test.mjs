import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  EMAIL_OUTBOX_DEAD_RETENTION_DAYS,
  EMAIL_OUTBOX_SENT_RETENTION_DAYS,
  emailOutboxRetentionCutoffs,
} = await import("../src/lib/emailOutboxRetentionState.ts");

describe("email outbox retention", () => {
  it("uses 30-day retention windows for sent/skipped and dead outbox rows", () => {
    const now = new Date("2026-05-18T12:00:00.000Z");
    const cutoffs = emailOutboxRetentionCutoffs(now);

    assert.equal(EMAIL_OUTBOX_SENT_RETENTION_DAYS, 30);
    assert.equal(EMAIL_OUTBOX_DEAD_RETENTION_DAYS, 30);
    assert.equal(cutoffs.sentOrSkippedCutoff.toISOString(), "2026-04-18T12:00:00.000Z");
    assert.equal(cutoffs.deadCutoff.toISOString(), "2026-04-18T12:00:00.000Z");
  });

  it("wires retention pruning into the daily notification prune cron", () => {
    const source = readFileSync("src/app/api/cron/notification-prune/route.ts", "utf8");

    assert.match(source, /import \{ pruneEmailOutboxRetention \}/);
    assert.match(source, /pruneEmailOutboxRetention\(\)/);
    assert.match(source, /emailOutboxPruned/);
  });

  it("surfaces dead outbox jobs in ops health", () => {
    const source = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");

    assert.match(source, /deadEmailOutboxCount/);
    assert.match(source, /status:\s*"DEAD"/);
  });

  it("keeps a status+updatedAt index for the terminal-row retention query", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260522164000_add_email_outbox_retention_index/migration.sql",
      "utf8",
    );

    assert.match(schema, /model EmailOutbox[\s\S]*@@index\(\[status, updatedAt\]\)/);
    assert.match(migration, /CREATE INDEX "EmailOutbox_status_updatedAt_idx"/);
  });
});
