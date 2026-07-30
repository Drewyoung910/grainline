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
    const caseTransitionAuthority = source(
      "prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql",
    );

    assert.match(guildMember, /logSystemActionOrThrow/);
    assert.match(guildMember, /action: "AUTO_REVOKE_GUILD_MEMBER"/);
    assert.match(guildMember, /client: tx/);

    assert.match(guildMetrics, /action: "AUTO_REVOKE_GUILD_MASTER"/);
    assert.match(guildMetrics, /action: "PRUNE_LISTING_VIEW_DAILY"/);
    assert.match(guildMetrics, /client: tx/);

    assert.match(caseAutoClose, /runCaseCronTransitionBatch/);
    assert.doesNotMatch(caseAutoClose, /logSystemActionOrThrow|prisma\.case\./);
    assert.match(caseTransitionAuthority, /audit_action := 'AUTO_CLOSE_CASE'/);
    assert.match(caseTransitionAuthority, /audit_action := 'AUTO_ESCALATE_CASE'/);
    assert.match(
      caseTransitionAuthority,
      /INSERT INTO public\."SystemAuditLog"/,
    );

    assert.match(caseEscalate, /escalateCaseWithFixedAuthority/);
    assert.doesNotMatch(
      caseEscalate,
      /BULK_ESCALATE_CASES|logSystemActionOrThrow|logUserAuditActionOrThrow/,
    );
    assert.match(caseTransitionAuthority, /'ESCALATE_CASE'/);
    assert.match(caseTransitionAuthority, /'staff'/);
  });

  it("audits Stripe webhook financial state transitions through SystemAuditLog", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const mirror = source("src/lib/stripeWebhookMirror.ts");
    const v2Webhook = source("src/app/api/stripe/webhook/v2/route.ts");

    assert.match(webhook, /import \{ logSystemActionOrThrow \} from "@\/lib\/systemAudit"/);
    assert.match(webhook, /action: "STRIPE_CHECKOUT_ORDER_CREATED"/);
    assert.match(webhook, /checkoutMode: "cart"/);
    assert.match(webhook, /checkoutMode: "single"/);
    assert.match(webhook, /action: "STRIPE_REFUND_RECORDED"/);
    assert.match(webhook, /action: "STRIPE_DISPUTE_RECORDED"/);
    assert.match(webhook, /action: "STRIPE_ACCOUNT_DEAUTHORIZED"/);
    assert.match(webhook, /actorType: "webhook"/);
    assert.match(webhook, /actorId: event\.id/);

    assert.match(mirror, /import \{ logSystemActionOrThrow \} from "@\/lib\/systemAudit"/);
    assert.match(mirror, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(mirror, /action: "STRIPE_ACCOUNT_CHARGES_UPDATED"/);
    assert.match(mirror, /targetType: "SELLER_PROFILE"/);
    assert.match(mirror, /targetId: seller\.id/);
    assert.match(mirror, /actorType: auditActorType/);
    assert.match(mirror, /actorId: actorId \?\? null/);
    assert.match(mirror, /previousChargesEnabled: seller\.chargesEnabled/);
    assert.match(mirror, /chargesEnabled: effectiveChargesEnabled/);
    assert.match(mirror, /stripeChargesEnabled: chargesEnabled/);

    assert.match(webhook, /actorType: "webhook",\s*actorId: event\.id,[\s\S]*action: "STRIPE_ACCOUNT_DEAUTHORIZED"/);
    assert.match(webhook, /previousChargesEnabled: seller\.chargesEnabled/);
    assert.match(webhook, /stripeAccountCleared: true/);
    assert.match(v2Webhook, /actorType: "webhook"/);
    assert.match(v2Webhook, /actorId: stripeEventId/);

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
