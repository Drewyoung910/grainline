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
      "src/app/api/cart/checkout/single/route.ts": /createConsistentSingleCheckoutStockReservation/,
      "src/app/api/cart/checkout-seller/route.ts": /createConsistentCartCheckoutStockReservation/,
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
      "grainline_checkout_reservation_create_cart_consistent",
      "grainline_checkout_reservation_create_single_consistent",
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
    assert.match(
      audit,
      /does not authorize a merge, migration, deployment, grant change/,
    );
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
    assert.match(audit, /CSR-A25: a lost Stripe create response could reopen payable stock/);
    assert.match(preAudit, /OPS-A25: a missing Stripe response is not proof no Session exists/);
  });

  it("pins the application deployment and ambiguous provider-response boundary", () => {
    const deploymentAudit = source("docs/checkout-stock-reservation-app-deployment-audit.md");
    const strategy = source("STRATEGY.md");

    assert.match(deploymentAudit, /dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6/);
    assert.match(deploymentAudit, /69c14c0618ea7ab9c74756422273d17d66db7efa/);
    assert.match(deploymentAudit, /16239fce2956c6dc726c24ccd7a91d1ea35463bd/);
    assert.match(deploymentAudit, /21e18ced17e876160e728b4c6f1a691ec6624b94/);
    assert.match(deploymentAudit, /ac4c9d2139f5294c5e91edd24acb3dbe71b4976c/);
    assert.match(deploymentAudit, /31819848330/);
    assert.match(deploymentAudit, /31814032227/);
    assert.match(
      deploymentAudit,
      /bec37f40d995e311bee5d80fc63c3485f7d325cdcd846b88656684fe2f592afe/,
    );
    assert.match(deploymentAudit, /actual database proof ran/);
    assert.match(deploymentAudit, /checkoutSessionCreateAttempted = true/);
    assert.match(deploymentAudit, /one bounded Stripe idempotency key/);
    assert.match(deploymentAudit, /same Order transaction/);
    assert.match(deploymentAudit, /made-to-order single checkout legitimately/);
    assert.match(deploymentAudit, /policyless ENABLE plus direct-grant revocation/);
    assert.match(deploymentAudit, /84a58f0fc818b502564ef6bcd974ff4af3cc4395/);
    assert.match(deploymentAudit, /31822968848/);
    assert.match(deploymentAudit, /dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw/);
    assert.match(deploymentAudit, /authenticated production smoke subsequently passed/);
    assert.match(strategy, /production-safe disposable checkout smoke subsequently passed/);
    assert.match(strategy, /Paid completion remains a distinct accounting/i);
  });

  it("keeps current production posture honest in the coverage ledger", () => {
    const matrix = source("docs/rls-coverage-matrix.md");
    const strategy = source("STRATEGY.md");
    const row = matrix
      .split("\n")
      .find((line) => line.startsWith("| `CheckoutStockReservation`"));

    assert.ok(row);
    assert.match(row, /`RLS_LIVE_PHASE_A`/);
    assert.match(row, /Policyless ENABLE/);
    assert.match(row, /zero direct runtime\/PUBLIC table or column authority/);
    assert.match(row, /405d6dff327bee76aced17f3876f8f18f29e05db/);
    assert.match(row, /31894742120/);
    assert.match(row, /31903152300/);
    assert.match(
      row,
      /899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0/,
    );
    assert.match(row, /FORCE remains the next separate posture-only release/);
    assert.match(row, /checkout-stock-reservation-activation-plan\.md/);
    assert.match(row, /checkout-stock-reservation-activation-release\.md/);
    assert.match(strategy, /CheckoutStockReservation source-consistency boundary/);
    assert.match(strategy, /Two fresh provider slots passed/);
    assert.match(strategy, /31903152300/);
  });
});
