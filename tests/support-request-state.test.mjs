import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  isSupportRequestStatus,
  supportRequestStatusTransition,
} = await import("../src/lib/supportRequestState.ts");
const supportRequestRetention = await import("../src/lib/supportRequestRetentionState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("support request state transitions", () => {
  it("accepts only known support request statuses", () => {
    assert.equal(isSupportRequestStatus("OPEN"), true);
    assert.equal(isSupportRequestStatus("IN_PROGRESS"), true);
    assert.equal(isSupportRequestStatus("CLOSED"), true);
    assert.equal(isSupportRequestStatus("RESOLVED"), false);
  });

  it("preserves closedAt and blocks reopening closed support requests", () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z");

    assert.deepEqual(
      supportRequestStatusTransition({ status: "CLOSED", closedAt }, "OPEN"),
      { ok: false, reason: "closed_terminal" },
    );
    assert.deepEqual(
      supportRequestStatusTransition({ status: "CLOSED", closedAt }, "IN_PROGRESS"),
      { ok: false, reason: "closed_terminal" },
    );

    const sameClosed = supportRequestStatusTransition({ status: "CLOSED", closedAt }, "CLOSED");
    assert.equal(sameClosed.ok, true);
    assert.equal(sameClosed.ok && sameClosed.data.closedAt, closedAt);
  });

  it("records previous and new status metadata for audit history", () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const transition = supportRequestStatusTransition({ status: "IN_PROGRESS", closedAt: null }, "CLOSED", now);

    assert.deepEqual(transition, {
      ok: true,
      data: { status: "CLOSED", closedAt: now },
      metadata: {
        previousStatus: "IN_PROGRESS",
        status: "CLOSED",
        previousClosedAt: null,
        closedAt: "2026-05-02T00:00:00.000Z",
      },
    });
  });

  it("wires the transition helper into the admin support action and UI", () => {
    const actions = source("src/app/admin/support/actions.ts");
    const page = source("src/app/admin/support/page.tsx");

    assert.match(actions, /select: \{ kind: true, status: true, closedAt: true \}/);
    assert.match(actions, /supportRequestStatusTransition\(current, status, now\)/);
    assert.match(actions, /\.\.\.transition\.metadata/);
    assert.doesNotMatch(actions, /metadata:\s*\{\s*status\s*\}/);
    assert.match(page, /request\.status === "OPEN"[\s\S]*In progress/);
    assert.match(page, /request\.status === "IN_PROGRESS"[\s\S]*Reopen/);
  });

  it("requires durable closure evidence before closing data requests", () => {
    const actions = source("src/app/admin/support/actions.ts");
    const page = source("src/app/admin/support/page.tsx");
    const schema = source("prisma/schema.prisma");

    assert.match(schema, /closureEvidence\s+String\?\s+@db\.VarChar\(4000\)/);
    assert.match(schema, /closureEvidenceAt\s+DateTime\?/);
    assert.match(schema, /closureEvidenceById\s+String\?/);
    assert.match(schema, /closureEvidenceBy\s+User\?\s+@relation\("SupportRequestClosureEvidence"/);

    assert.match(actions, /current\.kind === "DATA_REQUEST"/);
    assert.match(actions, /status === "CLOSED"/);
    assert.match(actions, /normalizeSupportRequestClosureEvidence\(formData\?\.get\("closureEvidence"\)\)/);
    assert.match(actions, /closureEvidenceById: admin\.id/);
    assert.match(actions, /closureEvidenceRecorded: true/);
    assert.match(actions, /closureEvidenceLength: closureEvidence\.evidence\.length/);
    assert.doesNotMatch(actions, /metadata: \{[\s\S]*closureEvidence: closureEvidence\.evidence/);

    assert.match(page, /name="closureEvidence"/);
    assert.match(page, /required/);
    assert.match(page, /minLength=\{SUPPORT_REQUEST_CLOSURE_EVIDENCE_MIN_CHARS\}/);
    assert.match(page, /provider action or exception/);
    assert.match(page, /request\.kind === "DATA_REQUEST" && request\.status !== "CLOSED"/);
  });

  it("keeps closed support request retention explicit and wired to daily pruning", () => {
    const now = new Date("2028-06-30T12:00:00.000Z");
    const cutoff = supportRequestRetention.supportRequestRetentionCutoff({ now });
    const route = source("src/app/api/cron/notification-prune/route.ts");
    const helper = source("src/lib/supportRequestRetention.ts");
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260630143000_seller_metrics_sales_bigint/migration.sql");
    const privacy = source("src/app/privacy/page.tsx");
    const runbook = source("docs/runbook.md");

    assert.equal(supportRequestRetention.SUPPORT_REQUEST_RETENTION_DAYS, 365 * 2);
    assert.equal(cutoff.toISOString(), "2026-07-01T12:00:00.000Z");
    assert.match(route, /pruneClosedSupportRequests\(\)/);
    assert.match(route, /supportRequestsPruned/);
    assert.match(helper, /WHERE status = 'CLOSED'/);
    assert.match(helper, /"closedAt" IS NOT NULL/);
    assert.match(helper, /"closedAt" < \$\{cutoff\}/);
    assert.doesNotMatch(helper, /status IN \('OPEN', 'IN_PROGRESS'\)/);
    assert.match(schema, /@@index\(\[status, closedAt\]\)/);
    assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupportRequest_status_closedAt_idx"/);
    assert.match(privacy, /Closed support and privacy data-request\s+records are retained for up to <strong>2 years<\/strong>/);
    assert.match(runbook, /Closed support and privacy data-request rows are pruned/);
  });
});
