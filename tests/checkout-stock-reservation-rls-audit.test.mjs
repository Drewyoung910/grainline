import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath) {
  return fs.readFileSync(relativePath, "utf8");
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

describe("CheckoutStockReservation RLS authority audit", () => {
  it("pins the complete direct-access source inventory", () => {
    const directAccessSources = walkFiles("src")
      .filter((file) => /(?:prisma|tx)\.checkoutStockReservation\./.test(source(file)))
      .map((file) => file.split(path.sep).join("/"))
      .sort();

    assert.deepEqual(directAccessSources, []);

    const semanticSources = {
      "src/app/api/cart/checkout/single/route.ts": /createSingleCheckoutStockReservation/,
      "src/app/api/cart/checkout-seller/route.ts": /createCartCheckoutStockReservation/,
      "src/app/api/cart/checkout/rollback/route.ts": /restoreBuyerExpiredCheckoutStockOnce/,
      "src/app/api/stripe/webhook/route.ts": /markCheckoutStockReservationCompleted[\s\S]*restoreUnorderedCheckoutStockOnce/,
      "src/lib/checkoutSessionExpiry.ts": /restoreSellerExpiredCheckoutStockOnce/,
      "src/lib/checkoutStockRestore.ts": /claimStaleCheckoutStockReservations[\s\S]*pruneCheckoutStockReservationBatch/,
      "src/lib/accountDeletion.ts": /claimAccountCheckoutStockReservations[\s\S]*scrubCheckoutStockReservationsForAccount/,
      "src/app/api/cart/checkout/resume/route.ts": /resumeCheckoutStockReservations/,
      "src/app/api/account/export/route.ts": /exportCheckoutStockReservations/,
    };
    for (const [file, pattern] of Object.entries(semanticSources)) {
      assert.match(source(file), pattern, file);
    }
  });

  it("partitions every mutation, projection and cleanup capability", () => {
    const audit = source("docs/checkout-stock-reservation-rls-audit.md");
    const requiredOperations = [
      "grainline_checkout_reservation_create_cart",
      "grainline_checkout_reservation_create_single",
      "grainline_checkout_reservation_bind_session",
      "grainline_checkout_reservation_complete",
      "grainline_checkout_reservation_checkout_abort",
      "grainline_checkout_reservation_webhook_restore",
      "grainline_checkout_reservation_buyer_expired_restore",
      "grainline_checkout_reservation_seller_expired_restore",
      "grainline_checkout_reservation_repair_claim_batch",
      "grainline_checkout_reservation_account_claim_batch",
      "grainline_checkout_reservation_repair_finalize",
      "grainline_checkout_reservation_prune_batch",
      "grainline_checkout_reservation_resume",
      "grainline_checkout_reservation_export",
      "grainline_checkout_reservation_account_scrub",
    ];
    for (const operation of requiredOperations) assert.match(audit, new RegExp(operation));

    assert.match(audit, /policyless ENABLE and later FORCE RLS/);
    assert.match(audit, /zero direct runtime\/PUBLIC/);
    assert.match(audit, /No public\/runtime function accepts a free-form restore reason/);
    assert.match(audit, /database-selected stale-repair claim\/finalize protocol/);
    assert.match(audit, /monotonic repair generation and claim clock/);
    assert.match(audit, /does not authorize\s+a\s+migration, deployment, grant/);
  });

  it("records the payable-session race and exact replay-fingerprint mismatch", () => {
    const audit = source("docs/checkout-stock-reservation-rls-audit.md");
    const preAudit = source("docs/order-payment-shipping-pre-rls-audit.md");
    const sessionLock = source("src/lib/checkoutSessionLock.ts");
    const inspector = source("scripts/order-payment-shipping-legacy-inspect.mjs");

    assert.match(audit, /return stock while the external session remains payable/);
    assert.match(audit, /attempt\s+to expire it before any bound-reservation restore/);
    assert.match(audit, /if expiry is not confirmed/);
    assert.match(preAudit, /OPS-A18: unexpected checkout failures can reopen payable stock/);

    assert.match(sessionLock, /digest\("base64url"\)\s*\.slice\(0, 32\)/);
    assert.ok(inspector.includes("^[A-Za-z0-9_-]{32}$"));
    assert.doesNotMatch(inspector, /"payloadHash" !~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(audit, /32-character base64url/);
    assert.match(audit, /64 lowercase\s+hex/);
    assert.match(preAudit, /OPS-A19: reservation replay fingerprints have three conflicting contracts/);
    assert.match(audit, /CSR-A09: account-scrub item shape differs/);
    assert.match(preAudit, /OPS-A20: reservation account-scrub shape/);
    assert.match(audit, /CSR-A10: unpaid completion currently restores/);
    assert.match(preAudit, /OPS-A21: an unpaid completion event is not restoration evidence/);
    assert.match(audit, /CSR-A11: the first semantic inventory omitted provider-expiry callers/);
    assert.match(preAudit, /OPS-A22: indirect buyer and seller expiry paths were missing from inventory/);
    assert.match(audit, /CSR-A12: a webhook lease was not bound to its Stripe object/);
    assert.match(preAudit, /OPS-A23: webhook claim generation did not bind the provider object/);
    assert.match(audit, /CSR-A13: account cleanup is intentionally retry-bounded/);
    assert.match(preAudit, /OPS-A24: reservation cleanup is one-batch-per-deletion-attempt/);
  });

  it("keeps current production posture honest in the coverage ledger", () => {
    const matrix = source("docs/rls-coverage-matrix.md");
    const strategy = source("STRATEGY.md");
    const row = matrix
      .split("\n")
      .find((line) => line.startsWith("| `CheckoutStockReservation`"));

    assert.ok(row);
    assert.match(row, /`BLOCKED_DESIGN`/);
    assert.match(row, /checkout-stock-reservation-rls-audit\.md/);
    assert.doesNotMatch(row, /RLS_LIVE/);
    assert.match(strategy, /next isolated dependency is `CheckoutStockReservation`/);
    assert.match(strategy, /StripeWebhookEvent FORCE\s+remains a separate/);
  });
});
