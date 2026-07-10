import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Stripe money-movement proof harness", () => {
  it("exposes the launch evidence script as an explicit npm command", () => {
    const pkg = JSON.parse(source("package.json"));

    assert.equal(
      pkg.scripts["audit:stripe-money"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/stripe-money-movement-proof.mjs",
    );
  });

  it("fails closed to Stripe test mode and staging/local DB evidence", () => {
    const script = source("scripts/stripe-money-movement-proof.mjs");

    assert.match(script, /const CONFIRMATION_VALUE = "test-mode"/);
    assert.match(script, /const DB_CONFIRMATION_VALUE = "staging-or-local"/);
    assert.match(script, /env\.STRIPE_MONEY_PROOF_CONFIRM/);
    assert.match(script, /env\.STRIPE_MONEY_PROOF_DB_CONFIRM/);
    assert.match(script, /STRIPE_SECRET_KEY must be a Stripe test-mode secret key/);
    assert.match(script, /!secretKey\.startsWith\("sk_test_"\)/);
    assert.match(script, /STRIPE_MONEY_PROOF_CONNECTED_ACCOUNT_ID/);
    assert.match(script, /STRIPE_MONEY_PROOF_EVIDENCE_PATH/);
    assert.match(script, /must stay inside the repository/);
    assert.match(script, /pathToFileURL\(process\.argv\[1\]\)\.href/);
    assert.match(script, /writeEvidence\(config, payload\)/);
    assert.match(script, /redact/);
    assert.match(script, /POSTGRES_URL_PATTERN/);
    assert.match(script, /STRIPE_SECRET_PATTERN/);
  });

  it("creates real Stripe test-mode destination charges and refund reversals", () => {
    const script = source("scripts/stripe-money-movement-proof.mjs");

    assert.match(script, /new Stripe\(config\.secretKey, \{ apiVersion: STRIPE_API_VERSION \}\)/);
    assert.match(script, /STRIPE_API_VERSION = "2025-10-29\.clover"/);
    assert.match(script, /paymentIntents\.create/);
    assert.match(script, /payment_method: "pm_card_visa"/);
    assert.match(script, /transfer_data: \{/);
    assert.match(script, /destination: config\.connectedAccountId/);
    assert.match(script, /createMarketplaceRefundWithCreator/);
    assert.match(script, /refundIdempotencyKeyBase/);
    assert.match(script, /stripe\.refunds\.create\(params, requestOptions\)/);
    assert.match(script, /resolution: "FULL"/);
    assert.match(script, /resolution: "PARTIAL"/);
    assert.match(script, /canReverseTransfer: true/);
    assert.match(script, /canReverseTransfer: false/);
    assert.match(script, /transferReversalId/);
  });

  it("co-writes local refund ledger and system audit evidence for proof orders", () => {
    const script = source("scripts/stripe-money-movement-proof.mjs");
    const helper = source("src/lib/localRefundEvidence.ts");
    const core = source("src/lib/localRefundEvidenceCore.ts");

    assert.match(script, /prisma\.order\.upsert/);
    assert.match(script, /buildLocalRefundEvidenceRecords/);
    assert.match(script, /sellerRefundId: refundId/);
    assert.match(script, /sellerRefundAmountCents: amountCents/);
    assert.match(script, /orderPaymentEvent\.createMany/);
    assert.match(script, /data: ledgerData/);
    assert.match(script, /skipDuplicates: true/);
    assert.match(script, /systemAuditLog\.create/);
    assert.match(script, /data: auditData/);
    assert.match(script, /verifyLocalRefundEvidence/);

    assert.match(helper, /buildLocalRefundEvidenceRecords\(input\)/);
    assert.match(core, /localRefundEvidenceEventId\(action, refundId\)/);
    assert.match(core, /truncateText\(sanitizeText\(value\), max\)/);
    assert.match(core, /\(currency \?\? DEFAULT_CURRENCY\)\.toLowerCase\(\)/);
    assert.match(core, /eventType: "REFUND"/);
    assert.match(core, /action,/);
  });

  it("proves label clawback success, retry, and manual-review states", () => {
    const script = source("scripts/stripe-money-movement-proof.mjs");

    assert.match(script, /transfers\.createReversal/);
    assert.match(script, /labelClawbackIdempotencyKey/);
    assert.match(script, /labelClawbackStatus: "REVERSED"/);
    assert.match(script, /labelClawbackReversalId: reversal\.id/);
    assert.match(script, /labelClawbackReviewNote/);
    assert.match(script, /labelClawbackStatusAfterFailure/);
    assert.match(script, /labelClawbackNextAttemptAt/);
    assert.match(script, /labelClawbackErrorMessage/);
    assert.match(script, /previousAttempts: 0/);
    assert.match(script, /previousAttempts: 4/);
    assert.match(script, /labelClawbackStatus: "MANUAL_REVIEW"/);
  });

  it("documents the proof as launch evidence without claiming it has already run", () => {
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");
    const backlog = source("docs/deferred-launch-backlog.md");

    assert.match(runbook, /Pre-launch Stripe money-movement proof/);
    assert.match(runbook, /Do not run this command with live Stripe keys/);
    assert.match(launch, /npm run audit:stripe-money/);
    assert.match(launch, /Stripe test-mode money-movement proof artifact/);
    assert.match(backlog, /Stripe refund runtime reconciliation/);
    assert.match(backlog, /Shipping label clawback reconciliation/);
  });
});
