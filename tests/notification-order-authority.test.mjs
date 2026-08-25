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
  const refundFinalization = source("src/lib/orderRefundFinalization.ts");
  const payoutWebhook = source("src/lib/stripePayoutWebhook.ts");
  const refundAuthority = source(
    "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
  );
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
    assert.match(refund, /finalizeSellerOrderRefund\(\{/);
    assert.doesNotMatch(refund, /recordLocalRefundEvidence/);
    assert.match(refundAuthority, /'notificationBody',[\s\S]{0,260}'Your maker issued a refund of '/);
    assert.match(refundAuthority, /'localAction', 'SELLER_REFUND_RECORDED'/);
    assert.match(refundAuthority, /'localAction', 'BLOCKED_CHECKOUT_REFUND_RECORDED'/);
    assert.match(refundFinalization, /recordSellerOrderRefund\(input, tx\)/);
    assert.match(refundFinalization, /recordBlockedCheckoutOrderRefund\(input, tx\)/);
    assert.equal(
      (refundFinalization.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_PAYMENT/g) ?? []).length,
      4,
    );
    assert.equal(
      (refundFinalization.match(/createNotificationOrThrow\(\{/g) ?? []).length,
      2,
    );
    assert.equal(
      (refundFinalization.match(/enqueueEmailOutboxOnce\(/g) ?? []).length,
      2,
    );
    assert.match(refundFinalization, /sourceId,[\s\S]*relatedUserId: input\.actorUserId/);
    assert.match(refundFinalization, /BLOCKED_CHECKOUT_REFUND_ACTION,[\s\S]*result\.refundId/);
    assert.doesNotMatch(
      refundFinalization.slice(
        refundFinalization.indexOf("export async function finalizeBlockedCheckoutOrderRefund"),
      ),
      /relatedUserId:/,
    );
    assert.match(webhook, /finalizeBlockedCheckoutOrderRefund\(\{/);
  });

  it("binds checkout, dispute, and payout notifications to provider-backed evidence", () => {
    assert.equal(
      (webhook.match(/sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_CHECKOUT/g) ?? []).length,
      2,
    );
    assert.match(webhook, /applySignedDisputeWebhook\(tx,/);
    assert.match(webhook, /sourceId: event\.id/);
    assert.match(webhook, /relatedUserId: result\.buyerUserId/);
    assert.match(webhook, /processStripePayoutFailedEvent\(event, claimGeneration\)/);
    assert.match(payoutWebhook, /applySellerPayoutFailure\(\{/);
    assert.match(payoutWebhook, /result\.action === "stale_ignored"/);
    assert.doesNotMatch(payoutWebhook, /prisma\.sellerPayoutEvent/);
    assert.match(payoutWebhook, /sourceType: NOTIFICATION_SOURCE_TYPES\.STRIPE_PAYOUT_FAILURE/);
    assert.match(payoutWebhook, /sourceId: result\.payoutEventId/);
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
