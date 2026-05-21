import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const notificationRetention = await import("../src/lib/notificationRetentionState.ts");
const webhookRetention = await import("../src/lib/webhookEventRetentionState.ts");

describe("retention and ops-health follow-ups", () => {
  it("keeps read and unread notification retention windows explicit", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const cutoffs = notificationRetention.notificationRetentionCutoffs(now);

    assert.equal(notificationRetention.READ_NOTIFICATION_RETENTION_DAYS, 90);
    assert.equal(notificationRetention.UNREAD_NOTIFICATION_RETENTION_DAYS, 365);
    assert.equal(cutoffs.readCutoff.toISOString(), "2026-02-20T12:00:00.000Z");
    assert.equal(cutoffs.unreadCutoff.toISOString(), "2025-05-21T12:00:00.000Z");
  });

  it("wires unread notification and webhook event pruning into notification-prune", () => {
    const route = readFileSync("src/app/api/cron/notification-prune/route.ts", "utf8");

    assert.match(route, /pruneReadNotifications\(readCutoff\)/);
    assert.match(route, /pruneUnreadNotifications\(unreadCutoff\)/);
    assert.match(route, /pruneWebhookEventRetention\(\)/);
    assert.match(route, /unreadPruned/);
    assert.match(route, /webhookEventsPruned/);
  });

  it("retains processed webhook events for 90 days only", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const cutoff = webhookRetention.webhookEventRetentionCutoff(now);
    const source = readFileSync("src/lib/webhookEventRetention.ts", "utf8");

    assert.equal(webhookRetention.WEBHOOK_EVENT_RETENTION_DAYS, 90);
    assert.equal(cutoff.toISOString(), "2026-02-20T12:00:00.000Z");
    assert.match(source, /FROM "StripeWebhookEvent"/);
    assert.match(source, /FROM "ResendWebhookEvent"/);
    assert.match(source, /FROM "ClerkWebhookEvent"/);
    assert.match(source, /"processedAt" IS NOT NULL/);
    assert.doesNotMatch(source, /lastError/);
  });

  it("keeps listing-view cleanup time-budgeted inside guild metrics", () => {
    const source = readFileSync("src/app/api/cron/guild-metrics/route.ts", "utf8");

    assert.match(source, /const VIEW_CLEANUP_TIME_BUDGET_MS = 60_000/);
    assert.match(source, /while \(Date\.now\(\) < deadline\)/);
    assert.match(source, /deletedViewRowsComplete/);
  });

  it("keeps Guild Master revocation behind a real 30-day warning grace", () => {
    const source = readFileSync("src/app/api/cron/guild-metrics/route.ts", "utf8");

    assert.match(source, /const GUILD_MASTER_WARNING_GRACE_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(source, /metricWarningSentAt: true/);
    assert.match(source, /now\.getTime\(\) - warningSentAt\.getTime\(\) < GUILD_MASTER_WARNING_GRACE_MS/);
    assert.match(source, /metricWarningSentAt: warningSentAt \?\? now/);
    assert.match(source, /const revocationCutoff = new Date\(now\.getTime\(\) - GUILD_MASTER_WARNING_GRACE_MS\)/);
    assert.match(source, /metricWarningSentAt: \{ lte: revocationCutoff \}/);
  });

  it("rechecks Guild Master metrics immediately before revocation", () => {
    const source = readFileSync("src/app/api/cron/guild-metrics/route.ts", "utf8");

    assert.match(source, /const revocationMetrics = await calculateSellerMetrics\(seller\.id\)/);
    assert.match(source, /const revocationCriteria = meetsGuildMasterRequirements\(revocationMetrics\)/);
    assert.match(source, /if \(revocationCriteria\.allMet\) \{/);
    assert.match(source, /consecutiveMetricFailures: 0,\s*metricWarningSentAt: null,\s*lastMetricCheckAt: now/s);
    assert.ok(
      source.indexOf("const revocationMetrics = await calculateSellerMetrics(seller.id)") <
        source.indexOf("const revocationCutoff = new Date(now.getTime() - GUILD_MASTER_WARNING_GRACE_MS)"),
      "fresh metrics must be recalculated before revocation update",
    );
  });

  it("surfaces webhook failure piles in ops-health", () => {
    const source = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");

    assert.match(source, /stripeWebhookFailureCount/);
    assert.match(source, /resendWebhookFailureCount/);
    assert.match(source, /clerkWebhookFailureCount/);
    assert.match(source, /lastError:\s*\{\s*not:\s*null\s*\}/);
    assert.match(source, /processedAt:\s*null/);
  });

  it("keeps verbose health token comparison constant-time", () => {
    const source = readFileSync("src/lib/healthState.ts", "utf8");

    assert.match(source, /timingSafeEqual\(sha256\(supplied\), sha256\(token\)\)/);
    assert.doesNotMatch(source, /supplied\s*===\s*token/);
  });
});
