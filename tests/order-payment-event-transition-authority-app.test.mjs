import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const transitionConsumers = [
  "src/app/api/orders/[id]/confirm-delivery/route.ts",
  "src/app/api/orders/[id]/fulfillment/route.ts",
  "src/app/api/orders/[id]/label/route.ts",
  "src/app/api/orders/[id]/refund/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/localRefundEvidence.ts",
  "src/lib/refundLedgerSql.ts",
];

const directLedgerAccess =
  /(?:prisma|tx)\.orderPaymentEvent|paymentEvents\s*:|FROM\s+(?:public\.)?"OrderPaymentEvent"|JOIN\s+(?:public\.)?"OrderPaymentEvent"|blockingRefundLedgerWhere|blockingRefundLedgerExistsSql|latestOpenDisputeLedger(?:Exists|Rows)Sql|latestDisputeLedgerRowsSql/;

function source(file) {
  return readFileSync(file, "utf8");
}

describe("OrderPaymentEvent transition-authority application conversion", () => {
  it("removes base-ledger access from every remaining ordinary-runtime consumer", () => {
    assert.equal(transitionConsumers.length, 7);
    for (const file of transitionConsumers) {
      assert.doesNotMatch(
        source(file),
        directLedgerAccess,
        `${file} regained direct payment-ledger authority`,
      );
    }
  });

  it("uses database-maintained projections at every contended transition", () => {
    const confirmation = source(
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
    );
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const fulfillmentAuthority = source(
      "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
    );
    const label = source("src/app/api/orders/[id]/label/route.ts");
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(confirmation, /finalizeBuyerOrderReceipt/u);
    assert.match(fulfillment, /finalizeSellerOrderFulfillment/u);
    assert.match(fulfillmentAuthority, /locked_order\."paymentRefundBlocked"/u);
    assert.match(fulfillmentAuthority, /locked_order\."paymentOpenDisputeBlocked"/u);
    assert.match(label, /paymentRefundBlockedSql/u);
    assert.match(label, /paymentOpenDisputeBlockedSql/u);
    assert.match(refund, /paymentOpenDisputeBlocked/u);
    assert.match(webhook, /paymentRefundBlocked/u);
    assert.match(webhook, /paymentOpenDisputeBlocked/u);
  });

  it("keeps runtime SQL projection-only and retires the unused generic writer", () => {
    const ledgerSql = source("src/lib/refundLedgerSql.ts");
    const localEvidence = source("src/lib/localRefundEvidence.ts");

    assert.match(ledgerSql, /paymentRefundBlockedSql/u);
    assert.match(ledgerSql, /paymentOpenDisputeBlockedSql/u);
    assert.doesNotMatch(ledgerSql, /OrderPaymentEvent/u);
    assert.match(localEvidence, /export \{ localRefundEvidenceEventId \}/u);
    assert.doesNotMatch(
      localEvidence,
      /createMany|logSystemActionOrThrow|recordLocalRefundEvidence/u,
    );
  });
});
