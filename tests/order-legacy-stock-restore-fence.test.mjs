import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-legacy-stock-restore-fence.sql",
  "utf8",
);
const restore = fs.readFileSync("src/lib/checkoutStockRestore.ts", "utf8");

describe("Order legacy stock-restore fence", () => {
  it("moves the exact Order fence inside the fixed claim under one Session lock", () => {
    const advisory = sql.indexOf("pg_catalog.pg_advisory_xact_lock(\n    913337");
    const orderFence = sql.indexOf('FROM public."Order" AS source_order');
    const eventInsert = sql.indexOf('INSERT INTO public."StripeWebhookEvent"');
    assert.ok(advisory >= 0 && advisory < orderFence && orderFence < eventInsert);
    assert.match(sql, /source_order\."stripeSessionId" = p_session_id/);
    assert.match(sql, /IF order_exists THEN\s+RETURN false;/);
    assert.match(sql, /"sourceObjectId"[\s\S]*p_session_id/);
    assert.match(
      sql,
      /"sourceObjectId" IS NOT NULL[\s\S]*"sourceObjectId" IS DISTINCT FROM p_session_id/,
    );
    assert.match(sql, /"sourceObjectId" IS NULL/);
  });

  it("keeps the successor fixed, runtime-only and table-grant neutral", () => {
    assert.match(sql, /VOLATILE[\s\S]*PARALLEL UNSAFE[\s\S]*SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.match(sql, /named_runtime_function_count <> 1/);
    assert.doesNotMatch(
      sql,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/,
    );
  });

  it("retires unbound legacy restoration and fails closed without a durable reservation", () => {
    assert.match(restore, /reportMissingDurableStockReservation/);
    assert.match(restore, /Checkout stock restoration requires a durable reservation/);
    assert.match(restore, /level: "error"/);
    assert.match(restore, /releaseCheckoutLock\(input\.metadata\.checkoutLockKey, input\.sessionId\)/);
    assert.doesNotMatch(restore, /\btx\.order\b|\bprisma\.order\b/);
    assert.doesNotMatch(restore, /UPDATE "Listing"|tx\.listing\.updateMany/);
    assert.doesNotMatch(restore, /applyLegacyStockRestore|claimLegacyStockRestore/);
  });
});
