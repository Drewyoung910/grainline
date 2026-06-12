import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("system audit logging", () => {
  it("keeps system audit rows separate from human admin undo logs", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260529173000_add_system_audit_log/migration.sql");
    const helper = source("src/lib/systemAudit.ts");

    assert.match(schema, /model SystemAuditLog/);
    assert.match(schema, /actorType\s+String\s+@db\.VarChar\(40\)/);
    assert.match(schema, /actorId\s+String\?\s+@db\.VarChar\(255\)/);
    assert.match(schema, /@@index\(\[targetType, targetId\]\)/);
    const systemModel = schema.match(/model SystemAuditLog \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.doesNotMatch(systemModel, /@relation/);

    assert.match(migration, /CREATE TABLE "SystemAuditLog"/);
    assert.match(migration, /"SystemAuditLog_metadata_size_chk"/);
    assert.match(migration, /<= 64000/);

    assert.match(helper, /export async function logSystemAction\(/);
    assert.match(helper, /export async function logSystemActionOrThrow/);
    assert.match(helper, /throw new SystemAuditLogError\(\)/);
    assert.match(helper, /truncateText\(sanitizeText\(reason\), 1000\)/);
    assert.match(helper, /import \{ sanitizeEmailOutboxError \} from "@\/lib\/emailOutboxSanitize";/);
    assert.match(helper, /console\.error\("System audit log failed:", sanitizeEmailOutboxError\(error\)\);/);
    assert.doesNotMatch(helper, /console\.error\("System audit log failed:", error\);/);
    assert.match(helper, /source: "system_audit_log"/);
  });

  it("audits automated Guild and case state transitions at the mutation point", () => {
    const guildMember = source("src/app/api/cron/guild-member-check/route.ts");
    const guildMetrics = source("src/app/api/cron/guild-metrics/route.ts");
    const caseAutoClose = source("src/app/api/cron/case-auto-close/route.ts");
    const caseEscalate = source("src/app/api/cases/[id]/escalate/route.ts");

    assert.match(guildMember, /logSystemActionOrThrow/);
    assert.match(guildMember, /action: "AUTO_REVOKE_GUILD_MEMBER"/);
    assert.match(guildMember, /client: tx/);

    assert.match(guildMetrics, /action: "AUTO_REVOKE_GUILD_MASTER"/);
    assert.match(guildMetrics, /action: "PRUNE_LISTING_VIEW_DAILY"/);
    assert.match(guildMetrics, /client: tx/);

    assert.match(caseAutoClose, /action: "AUTO_CLOSE_CASE"/);
    assert.match(caseAutoClose, /action: "AUTO_ESCALATE_CASE"/);
    assert.match(caseAutoClose, /client: tx/);

    assert.match(caseEscalate, /action: "BULK_ESCALATE_CASES"/);
    assert.match(caseEscalate, /action: "ESCALATE_CASE"/);
    assert.match(caseEscalate, /actorType: validCron \? "cron" : "staff"/);
  });

  it("audits Stripe webhook financial state transitions through SystemAuditLog", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(webhook, /import \{ logSystemActionOrThrow \} from "@\/lib\/systemAudit"/);
    assert.match(webhook, /action: "STRIPE_CHECKOUT_ORDER_CREATED"/);
    assert.match(webhook, /checkoutMode: "cart"/);
    assert.match(webhook, /checkoutMode: "single"/);
    assert.match(webhook, /action: "STRIPE_REFUND_RECORDED"/);
    assert.match(webhook, /action: "STRIPE_DISPUTE_RECORDED"/);
    assert.match(webhook, /actorType: "webhook"/);
    assert.match(webhook, /actorId: event\.id/);

    for (const action of [
      "STRIPE_CHECKOUT_ORDER_CREATED",
      "STRIPE_REFUND_RECORDED",
      "STRIPE_DISPUTE_RECORDED",
    ]) {
      const index = webhook.indexOf(`action: "${action}"`);
      assert.notEqual(index, -1, `${action} should be present`);
      const block = webhook.slice(Math.max(0, index - 250), index + 600);
      assert.match(block, /client: tx/);
      assert.match(block, /targetType: "ORDER"/);
      assert.match(block, /targetId:/);
      assert.match(block, /metadata: \{/);
    }
  });

  it("deduplicates Stripe refund and dispute audit rows through payment ledger writes", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const refundStart = webhook.indexOf('if (event.type === "charge.refunded")');
    const disputeStart = webhook.indexOf("if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type))");
    const payoutStart = webhook.indexOf('if (event.type === "payout.failed")');

    assert.ok(refundStart >= 0, "charge.refunded branch should exist");
    assert.ok(disputeStart > refundStart, "dispute branch should follow refund branch");
    assert.ok(payoutStart > disputeStart, "payout branch should follow dispute branch");

    const helperStart = webhook.indexOf("async function recordOrderPaymentEvent");
    const helper = webhook.slice(helperStart, refundStart);
    assert.match(helper, /orderPaymentEvent\.createMany/);
    assert.match(helper, /skipDuplicates: true/);
    assert.match(helper, /return result\.count > 0/);

    const refundBranch = webhook.slice(refundStart, disputeStart);
    assert.match(refundBranch, /const refundLedgerCreated = await recordOrderPaymentEvent/);
    assert.match(
      refundBranch,
      /if \(refundLedgerCreated\) \{\s+await logSystemActionOrThrow\(\{[\s\S]*action: "STRIPE_REFUND_RECORDED"/,
    );

    const disputeBranch = webhook.slice(disputeStart, payoutStart);
    assert.match(disputeBranch, /const disputeLedgerCreated = await recordOrderPaymentEvent/);
    assert.match(
      disputeBranch,
      /if \(disputeLedgerCreated\) \{\s+await logSystemActionOrThrow\(\{[\s\S]*action: "STRIPE_DISPUTE_RECORDED"/,
    );
  });
});
