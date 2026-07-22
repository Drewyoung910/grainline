import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Notification order, payment, and fulfillment authority", () => {
  const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
  const refund = source("src/app/api/orders/[id]/refund/route.ts");
  const webhook = source("src/app/api/stripe/webhook/route.ts");
  const serviceAccess = source("src/lib/notificationServiceAccess.ts");
  const sql = source("docs/rls-drafts/notification-service-authority.sql");

  it("co-commits all three seller fulfillment notifications with transition audits", () => {
    assert.match(fulfillment, /const transition = await prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(fulfillment, /action: "ORDER_FULFILLMENT_TRANSITION"/);
    assert.match(fulfillment, /actorId: authz\.seller\.userId/);
    assert.match(fulfillment, /previousStatus: authz\.order\.fulfillmentStatus \?\? "PENDING"/);
    assert.match(fulfillment, /trackingCarrier: action === "shipped"/);
    assert.equal(
      (fulfillment.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_FULFILLMENT/g) ?? []).length,
      3,
    );
    assert.equal(
      (fulfillment.match(/relatedUserId: authz\.seller\.userId/g) ?? []).length,
      3,
    );
  });

  it("binds seller and blocked-checkout refunds to their existing payment ledgers", () => {
    assert.match(refund, /localRefundEvidenceEventId, recordLocalRefundEvidence/);
    assert.match(refund, /metadata: \{[\s\S]{0,220}notificationBody: refundNotificationBody/);
    assert.match(refund, /sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_PAYMENT/);
    assert.match(refund, /sourceId: refundAuthoritySourceId/);
    assert.match(refund, /relatedUserId: me\.id/);
    assert.match(webhook, /"BLOCKED_CHECKOUT_REFUND_RECORDED",[\s\S]{0,80}refundId/);
    assert.match(webhook, /sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_PAYMENT/);
  });

  it("binds checkout, dispute, and payout notifications to provider-backed evidence", () => {
    assert.equal(
      (webhook.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_CHECKOUT/g) ?? []).length,
      2,
    );
    assert.match(webhook, /paymentEventId: event\.id/);
    assert.match(webhook, /sourceId: notifySellerUserId\.paymentEventId/);
    assert.match(webhook, /relatedUserId: notifySellerUserId\.buyerUserId \?\? undefined/);
    assert.match(webhook, /const payoutEvent = await prisma\.sellerPayoutEvent\.upsert/);
    assert.match(webhook, /sourceType: NOTIFICATION_SOURCE_TYPES\.STRIPE_PAYOUT_FAILURE/);
    assert.match(webhook, /sourceId: payoutEvent\.id/);
  });

  it("derives recipients, payloads, and event identity inside one narrow order wrapper", () => {
    assert.match(sql, /p_source_type = 'order_checkout'/);
    assert.match(sql, /source_audit\.action = 'STRIPE_CHECKOUT_ORDER_CREATED'/);
    assert.match(sql, /source_audit\.metadata ->> 'stripeSessionId' = source_order\."stripeSessionId"/);
    assert.match(sql, /p_source_type = 'order_fulfillment'/);
    assert.match(sql, /source_audit\.action = 'ORDER_FULFILLMENT_TRANSITION'/);
    assert.match(sql, /source_audit\."actorId" = source_seller\."userId"/);
    assert.match(sql, /p_source_type = 'order_payment'/);
    assert.match(sql, /source_payment\."stripeEventId" = p_source_id/);
    assert.match(sql, /source_payment\.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'/);
    assert.match(sql, /source_payment\.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'/);
    assert.match(sql, /source_payment\.metadata ->> 'stripeEventType' = 'charge\.dispute\.created'/);
    assert.match(sql, /p_related_user_id IS NOT DISTINCT FROM source_order\."buyerId"/);
    assert.match(sql, /dispute_audit\.metadata ->> 'disputeSideEffectsApplied' = 'true'/);
    assert.match(sql, /p_source_type = 'stripe_payout_failure'/);
    assert.match(sql, /pg_catalog\.lower\(source_payout\.status\) = 'failed'/);
    assert.match(serviceAccess, /public\.grainline_notification_create_order_event\(/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_order_event/);
  });
});
