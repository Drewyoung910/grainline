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
    const signedAuthority = source(
      "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
    );
    const deauthorizationAuthority = source(
      "docs/rls-drafts/order-seller-deauthorization-authority.sql",
    );
    const paidCheckoutAuthority = source(
      "docs/rls-drafts/order-paid-checkout-authority.sql",
    );
    const mirror = source("src/lib/stripeWebhookMirror.ts");
    const v2Webhook = source("src/app/api/stripe/webhook/v2/route.ts");

    assert.doesNotMatch(webhook, /logSystemActionOrThrow/);
    assert.match(paidCheckoutAuthority, /'webhook', p_event_id, 'STRIPE_CHECKOUT_ORDER_CREATED'/);
    assert.match(paidCheckoutAuthority, /'checkoutMode', source_mode/);
    assert.match(signedAuthority, /'STRIPE_REFUND_RECORDED'/);
    assert.match(signedAuthority, /'STRIPE_DISPUTE_RECORDED'/);
    assert.match(webhook, /applyStripeSellerDeauthorization/);
    assert.match(deauthorizationAuthority, /'webhook', p_event_id, 'STRIPE_ACCOUNT_DEAUTHORIZED'/);

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

    assert.match(
      deauthorizationAuthority,
      /INSERT INTO public\."SystemAuditLog"[\s\S]*'webhook', p_event_id, 'STRIPE_ACCOUNT_DEAUTHORIZED'/,
    );
    assert.match(deauthorizationAuthority, /'previousChargesEnabled', seller_was_public/);
    assert.match(deauthorizationAuthority, /'stripeAccountCleared', true/);
    assert.match(v2Webhook, /actorType: "webhook"/);
    assert.match(v2Webhook, /actorId: stripeEventId/);

    const checkoutIndex = paidCheckoutAuthority.indexOf("'STRIPE_CHECKOUT_ORDER_CREATED'");
    assert.notEqual(checkoutIndex, -1);
    const checkoutBlock = paidCheckoutAuthority.slice(Math.max(0, checkoutIndex - 350), checkoutIndex + 900);
    assert.match(checkoutBlock, /INSERT INTO public\."SystemAuditLog"/);
    assert.match(checkoutBlock, /'ORDER', source_order_id/);
    assert.match(checkoutBlock, /pg_catalog\.jsonb_build_object/);

    for (const action of ["STRIPE_REFUND_RECORDED", "STRIPE_DISPUTE_RECORDED"]) {
      const index = signedAuthority.indexOf(`'${action}'`);
      assert.notEqual(index, -1, `${action} should be present in fixed authority`);
      const block = signedAuthority.slice(Math.max(0, index - 500), index + 700);
      assert.match(block, /INSERT INTO public\."SystemAuditLog"/);
      assert.match(block, /'webhook'/);
      assert.match(block, /'ORDER'/);
      assert.match(block, /pg_catalog\.jsonb_build_object/);
    }
  });

  it("deduplicates Stripe refund and dispute audit rows through payment ledger writes", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const signedAuthority = source(
      "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql",
    );
    const refundStart = webhook.indexOf('if (event.type === "charge.refunded")');
    const disputeStart = webhook.indexOf("if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type))");
    const payoutStart = webhook.indexOf('if (event.type === "payout.failed")');

    assert.ok(refundStart >= 0, "charge.refunded branch should exist");
    assert.ok(disputeStart > refundStart, "dispute branch should follow refund branch");
    assert.ok(payoutStart > disputeStart, "payout branch should follow dispute branch");

    const refundBranch = webhook.slice(refundStart, disputeStart);
    assert.match(refundBranch, /applySignedRefundWebhook\(tx,/);

    const disputeBranch = webhook.slice(disputeStart, payoutStart);
    assert.match(disputeBranch, /applySignedDisputeWebhook\(tx,/);
    assert.doesNotMatch(webhook, /async function recordOrderPaymentEvent/);
    assert.equal(
      (signedAuthority.match(/WHERE payment\."stripeEventId" = p_event_id/gu) ?? []).length,
      2,
    );
    assert.equal(
      (signedAuthority.match(/replay payload is inconsistent/gu) ?? []).length,
      2,
    );
    assert.equal(
      (signedAuthority.match(/INSERT INTO public\."SystemAuditLog"/gu) ?? []).length,
      2,
    );
  });
});
