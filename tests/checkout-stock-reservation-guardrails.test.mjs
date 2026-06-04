import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  checkoutStockReservationRepairAction,
} = await import("../src/lib/checkoutStockReservationRepairState.ts");

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("durable checkout stock reservation guardrails", () => {
  it("persists checkout stock reservations with restore indexes and status checks", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260529190000_add_checkout_stock_reservation/migration.sql");

    assert.match(schema, /model CheckoutStockReservation/);
    assert.match(schema, /stripeSessionId String\? +@unique/);
    assert.match(schema, /@@index\(\[status, expiresAt\]\)/);
    assert.match(migration, /CREATE TABLE "CheckoutStockReservation"/);
    assert.match(migration, /CHECK \("status" IN \('RESERVED', 'SESSION_CREATED', 'COMPLETED', 'RESTORED'\)\)/);
    assert.match(migration, /CHECK \(jsonb_typeof\("reservedItems"\) = 'array'\)/);
  });

  it("creates durable reservations before Stripe session creation and restores them on create failures", () => {
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");

    for (const route of [singleCheckout, sellerCheckout]) {
      assert.match(route, /createCheckoutStockReservation\(\{/);
      assert.match(route, /checkoutStockReservationMetadata\(checkoutReservationId\)/);
      assert.match(route, /markCheckoutStockReservationSession\(\{/);
      assert.match(route, /restoreCheckoutStockReservationOnce\(\{[\s\S]*reason: "checkout_create_error"/);
      assert.doesNotMatch(route, /SET "stockQuantity" = "stockQuantity" \+ \$\{reserved/);
    }
  });

  it("marks paid reservations complete and prefers reservation-backed stock restores", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.match(webhook, /markCheckoutStockReservationCompleted\(tx, \{[\s\S]*reservationId: sessionMeta\.checkoutReservationId/);
    assert.match(restore, /restoreCheckoutStockReservationOnce\(\{[\s\S]*reservationId: input\.metadata\.checkoutReservationId/);
    assert.match(restore, /if \(reservationRestore\.handled\) return/);
  });

  it("registers a bounded cron to repair no-session reservations", () => {
    const vercel = source("vercel.json");
    const cronRoute = source("src/app/api/cron/checkout-stock-reservations/route.ts");
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.match(vercel, /"path": "\/api\/cron\/checkout-stock-reservations"/);
    assert.match(vercel, /"schedule": "\*\/15 \* \* \* \*"/);
    assert.match(cronRoute, /verifyCronRequest/);
    assert.match(cronRoute, /beginCronRun\("checkout-stock-reservations", quarterHourBucket\(\)\)/);
    assert.match(cronRoute, /restoreStaleCheckoutStockReservations/);
    assert.match(restore, /CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE = 50/);
    assert.match(restore, /status: "RESERVED", stripeSessionId: null/);
    assert.match(restore, /let reason = "stale_no_session"/);
  });

  it("repairs stale Stripe-session reservations only when the session is unpaid and restorable", () => {
    const restore = source("src/lib/checkoutStockRestore.ts");

    assert.equal(checkoutStockReservationRepairAction({ status: "expired", payment_status: "unpaid" }), "restore");
    assert.equal(checkoutStockReservationRepairAction({ status: "open", payment_status: "unpaid" }), "expire_and_restore");
    assert.equal(checkoutStockReservationRepairAction({ status: "complete", payment_status: "unpaid" }), "skip_paid_or_complete");
    assert.equal(checkoutStockReservationRepairAction({ status: "expired", payment_status: "paid" }), "skip_paid_or_complete");
    assert.equal(checkoutStockReservationRepairAction({ status: "unknown", payment_status: "unpaid" }), "skip_unrecognized");

    assert.match(restore, /status: "SESSION_CREATED", stripeSessionId: \{ not: null \}/);
    assert.match(restore, /stripe\.checkout\.sessions\.retrieve\(reservation\.stripeSessionId\)/);
    assert.match(restore, /stripe\.checkout\.sessions\.expire\(reservation\.stripeSessionId\)/);
    assert.match(restore, /source: "checkout_stock_reservation_paid_missing_order"/);
    assert.match(restore, /reason = "stale_stripe_session_unpaid"/);
    assert.match(restore, /where: \{ stripeSessionId: reservation\.stripeSessionId \}/);
  });
});
