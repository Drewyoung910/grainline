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

  it("removes direct Order access while retaining the transactional claim", () => {
    assert.match(restore, /await lockCheckoutSessionMutation\(tx, input\.sessionId\)/);
    assert.match(restore, /claimLegacyStockRestore\(sessionId, tx\)/);
    assert.doesNotMatch(restore, /\btx\.order\b|\bprisma\.order\b/);
    const lock = restore.indexOf("await lockCheckoutSessionMutation(tx, input.sessionId)");
    const claim = restore.indexOf("await claimCheckoutStockRestore(tx, input.sessionId)");
    const stock = restore.indexOf("return restoreReservedStockItems(tx, items)");
    assert.ok(lock >= 0 && lock < claim && claim < stock);
  });
});
