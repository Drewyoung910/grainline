import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applySignedDisputeWebhook,
  applySignedRefundWebhook,
} from "../src/lib/orderPaymentSignedWebhook.ts";

const route = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

function clientReturning(rows) {
  return { $queryRaw: async () => rows };
}

const refundInput = {
  eventId: "evt_refund",
  claimGeneration: 1n,
  chargeId: "ch_1",
  eventCreatedSeconds: 100,
  amountRefundedCents: 500,
  currency: "usd",
  refundId: "re_1",
  refundAmountCents: 500,
  refundStatus: "succeeded",
  refundCreatedSeconds: 99,
  refundReason: null,
};

const disputeInput = {
  eventId: "evt_dispute",
  claimGeneration: 1n,
  chargeId: "ch_1",
  disputeId: "dp_1",
  eventCreatedSeconds: 100,
  amountCents: 500,
  currency: "usd",
  reason: "fraudulent",
  status: "needs_response",
};

test("typed helpers accept only exact fixed-authority result shapes", async () => {
  const refund = await applySignedRefundWebhook(clientReturning([{
    action: "inserted",
    paymentEventId: "payment-1",
    orderId: "order-1",
    orderUpdated: true,
  }]), refundInput);
  assert.equal(refund.paymentEventId, "payment-1");

  const dispute = await applySignedDisputeWebhook(clientReturning([{
    action: "applied",
    paymentEventId: "payment-2",
    orderId: "order-1",
    sellerUserId: "seller-1",
    buyerUserId: "buyer-1",
    caseId: "case-1",
    caseAction: "create",
    notificationAuthorized: true,
  }]), disputeInput);
  assert.equal(dispute.notificationAuthorized, true);
});

test("typed helpers reject malformed, contradictory and multirow results", async () => {
  await assert.rejects(
    applySignedRefundWebhook(clientReturning([]), refundInput),
    /invalid cardinality/,
  );
  await assert.rejects(
    applySignedRefundWebhook(clientReturning([{
      action: "replay",
      paymentEventId: "payment-1",
      orderId: "order-1",
      orderUpdated: true,
    }]), refundInput),
    /impossible update state/,
  );
  await assert.rejects(
    applySignedDisputeWebhook(clientReturning([{
      action: "stale_recorded",
      paymentEventId: "payment-2",
      orderId: "order-1",
      sellerUserId: "seller-1",
      buyerUserId: "buyer-1",
      caseId: "case-1",
      caseAction: "create",
      notificationAuthorized: true,
    }]), disputeInput),
    /authorized an invalid notification|non-application returned participant side effects/,
  );
  await assert.rejects(
    applySignedDisputeWebhook(clientReturning([{
      action: "unknown",
      paymentEventId: "payment-2",
      orderId: "order-1",
      sellerUserId: "seller-1",
      buyerUserId: "buyer-1",
      caseId: null,
      caseAction: null,
      notificationAuthorized: false,
    }]), disputeInput),
    /invalid action/,
  );
});

test("webhook conversion uses fixed writers and co-commits dispute notification", () => {
  const refundStart = route.indexOf('if (event.type === "charge.refunded")');
  const disputeStart = route.indexOf("if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type))");
  const payoutStart = route.indexOf('if (event.type === "payout.failed")');
  assert.ok(refundStart >= 0 && disputeStart > refundStart && payoutStart > disputeStart);
  const refundBranch = route.slice(refundStart, disputeStart);
  const disputeBranch = route.slice(disputeStart, payoutStart);
  assert.match(refundBranch, /applySignedRefundWebhook\(tx,/);
  assert.match(refundBranch, /typeof charge\.amount_refunded !== "number"/);
  assert.match(refundBranch, /typeof charge\.currency !== "string"/);
  assert.match(refundBranch, /const amountRefundedCents = charge\.amount_refunded/);
  assert.match(refundBranch, /const chargeCurrency = charge\.currency/);
  assert.match(refundBranch, /\n\s*amountRefundedCents,/);
  assert.match(refundBranch, /currency: chargeCurrency/);
  assert.match(disputeBranch, /applySignedDisputeWebhook\(tx,/);
  assert.match(disputeBranch, /typeof dispute\.amount !== "number"/);
  assert.match(disputeBranch, /typeof dispute\.currency !== "string"/);
  assert.match(disputeBranch, /typeof dispute\.status !== "string"/);
  assert.match(disputeBranch, /const disputeAmountCents = dispute\.amount/);
  assert.match(disputeBranch, /const disputeStatus = dispute\.status/);
  assert.match(disputeBranch, /amountCents: disputeAmountCents/);
  assert.match(disputeBranch, /status: disputeStatus/);
  assert.match(
    disputeBranch,
    /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*createNotificationOrThrow\([\s\S]*\}, tx\)/,
  );
  assert.doesNotMatch(refundBranch, /orderPaymentEvent\.(?:create|createMany|update)/);
  assert.doesNotMatch(disputeBranch, /orderPaymentEvent\.(?:create|createMany|update)/);
  assert.doesNotMatch(disputeBranch, /shouldApplyDisputeWebhookSideEffects/);
  assert.doesNotMatch(route, /async function recordOrderPaymentEvent/);
  assert.doesNotMatch(route, /async function lockChargeMutation/);
});
