import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("buyer-deletion Stripe replay proof harness", () => {
  it("exposes the replay verifier as an explicit npm command", () => {
    const pkg = JSON.parse(source("package.json"));

    assert.equal(
      pkg.scripts["audit:buyer-deletion-replay"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/buyer-deletion-stripe-replay-proof.mjs",
    );
  });

  it("fails closed to Stripe test-mode replay and staging/local read verification", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /const CONFIRMATION_VALUE = "test-mode-replay"/);
    assert.match(script, /const DB_CONFIRMATION_VALUE = "staging-or-local-read"/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_CONFIRM/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM/);
    assert.match(script, /STRIPE_SECRET_KEY must be a Stripe test-mode secret key/);
    assert.match(script, /!secretKey\.startsWith\("sk_test_"\)/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_SESSION_ID/);
    assert.match(script, /!sessionId\.startsWith\("cs_test_"\)/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH/);
    assert.match(script, /must stay inside the repository/);
    assert.match(script, /pathToFileURL\(process\.argv\[1\]\)\.href/);
  });

  it("verifies a real paid Stripe session instead of fabricating checkout completion", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /new Stripe\(config\.secretKey, \{ apiVersion: STRIPE_API_VERSION \}\)/);
    assert.match(script, /stripe\.checkout\.sessions\.retrieve\(config\.sessionId/);
    assert.match(script, /expand: \["payment_intent\.latest_charge"\]/);
    assert.match(script, /session\.livemode === false/);
    assert.match(script, /session\.payment_status === "paid"/);
    assert.match(script, /session\.metadata\?\.buyerId/);
    assert.match(script, /stripe\.events\.retrieve\(config\.expectedEventId\)/);
    assert.match(script, /retrievedEvent\.type === "checkout\.session\.completed"/);
    assert.doesNotMatch(script, /checkout\.sessions\.create/);
    assert.doesNotMatch(script, /paymentIntents\.create/);
    assert.doesNotMatch(script, /order\.create\(/);
    assert.doesNotMatch(script, /order\.upsert/);
  });

  it("checks the source buyer state and local blocked-order PII purge", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /prisma\.user\.findUnique/);
    assert.match(script, /buyerStateReason\(sourceBuyer\)/);
    assert.match(script, /Buyer account was deleted before payment completion/);
    assert.match(script, /Buyer account was suspended before payment completion/);
    assert.match(script, /Buyer account could not be verified at payment completion/);
    assert.match(script, /prisma\.order\.findUnique/);
    assert.match(script, /where: \{ stripeSessionId: config\.sessionId \}/);
    assert.match(script, /BUYER_PII_FIELDS/);
    assert.match(script, /order\.buyerId == null/);
    assert.match(script, /piiFieldsWithValues\.length === 0/);
    assert.match(script, /Boolean\(order\.buyerDataPurgedAt\)/);
    assert.match(script, /order\.reviewNeeded === true/);
    assert.match(script, /BLOCKED_CHECKOUT_REVIEW_MARKER/);
  });

  it("requires processed webhook, refund ledger, and system audit evidence", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /order\.sellerRefundId\?\.startsWith\("re_"\)/);
    assert.match(script, /order\.sellerRefundLockedAt == null/);
    assert.match(script, /firstMatchingRefundEvent\(order\)/);
    assert.match(script, /metadataValue\(refundEvent\.metadata, "localAction"\) === BLOCKED_REFUND_ACTION/);
    assert.match(script, /refundAccounting\.buyerRefundAmountCents === order\.sellerRefundAmountCents/);
    assert.match(script, /prisma\.systemAuditLog\.findFirst/);
    assert.match(script, /action: CHECKOUT_CREATED_ACTION/);
    assert.match(script, /action: BLOCKED_REFUND_ACTION/);
    assert.match(script, /prisma\.stripeWebhookEvent\.findUnique/);
    assert.match(script, /Boolean\(webhookEvent\.processedAt\)/);
    assert.match(script, /!webhookEvent\.lastError/);
  });

  it("redacts retained evidence and stores hashes instead of raw Stripe or DB identifiers", async () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /DB_ENV_ASSIGNMENT_PATTERN/);
    assert.match(script, /POSTGRES_URL_PATTERN/);
    assert.match(script, /STRIPE_SECRET_PATTERN/);
    assert.match(script, /URL_USERINFO_PATTERN/);
    assert.match(script, /BEARER_PATTERN/);
    assert.match(script, /hashValue\(config\.sessionId\)/);
    assert.match(script, /metadataBuyerIdHash/);
    assert.match(script, /paymentIntentIdHash/);
    assert.match(script, /chargeIdHash/);
    assert.match(script, /issues: issues\.slice\(0, EVIDENCE_MAX_ISSUES\)\.map\(redact\)/);

    const { buildEvidencePayload } = await import("../scripts/buyer-deletion-stripe-replay-proof.mjs");
    const payload = buildEvidencePayload({
      actionableCount: 1,
      completedAt: "2026-07-11T00:00:01.000Z",
      config: {
        expectedBuyerState: "deleted",
        expectedEventId: "evt_test_secret",
        sessionId: "cs_test_secret",
      },
      issues: [
        "DATABASE_URL=postgres://user:secret@example/db STRIPE_SECRET_KEY=sk_test_secret Bearer token-value",
      ],
      proof: null,
      startedAt: "2026-07-11T00:00:00.000Z",
      status: "failed",
    });
    const serialized = JSON.stringify(payload);

    assert.match(serialized, /\[redacted-buyer-deletion-replay-proof-env\]/);
    assert.doesNotMatch(serialized, /postgres:\/\/user:secret/);
    assert.doesNotMatch(serialized, /sk_test_secret/);
    assert.doesNotMatch(serialized, /cs_test_secret/);
    assert.doesNotMatch(serialized, /evt_test_secret/);
    assert.doesNotMatch(serialized, /token-value/);
  });

  it("documents the verifier as launch evidence without claiming it has already run", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:buyer-deletion-replay/);
    assert.match(launch, /real paid Checkout Session whose original buyer was deleted, suspended, or missing/);
    assert.match(runbook, /Pre-launch buyer-deletion Stripe replay proof/);
    assert.match(runbook, /does not create or fake a paid Checkout Session/);
    assert.match(backlog, /`npm run audit:buyer-deletion-replay`/);
    assert.match(claude, /Do not close the buyer-deletion Stripe replay launch blocker from source tests/);
  });
});
