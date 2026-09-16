import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-legacy-refund-lock-authority.sql",
  "utf8",
);
const helper = fs.readFileSync(
  "src/lib/orderLegacyRefundLockAuthority.ts",
  "utf8",
);
const webhook = fs.readFileSync(
  "src/app/api/stripe/webhook/route.ts",
  "utf8",
);
const caseRoute = fs.readFileSync(
  "src/app/api/cases/[id]/resolve/route.ts",
  "utf8",
);
const cron = fs.readFileSync(
  "src/app/api/cron/notification-prune/route.ts",
  "utf8",
);

describe("Order legacy refund-lock authority", () => {
  it("separates signed-event, staff-Case and bounded maintenance authority", () => {
    assert.match(
      sql,
      /grainline_blocked_checkout_legacy_refund_lock_release\([\s\S]*p_event_claim_generation bigint[\s\S]*p_session_id text[\s\S]*p_order_id text/,
    );
    assert.match(
      sql,
      /locked_event\."claimGeneration" IS DISTINCT FROM p_event_claim_generation/,
    );
    assert.match(sql, /locked_event\."processedAt" IS NOT NULL/);
    assert.match(sql, /locked_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(
      sql,
      /grainline_case_legacy_refund_lock_release\([\s\S]*p_actor_user_id text[\s\S]*p_case_id text/,
    );
    assert.match(sql, /locked_actor\.role::text NOT IN \('EMPLOYEE', 'ADMIN'\)/);
    assert.match(sql, /source_case\."orderId" = locked_order\.id/);
    assert.match(sql, /grainline_order_legacy_refund_lock_prune/);
    assert.match(sql, /p_batch_size NOT BETWEEN 1 AND 100/);
    assert.match(sql, /FOR UPDATE SKIP LOCKED[\s\S]*LIMIT p_batch_size/);
  });

  it("preserves the exact legacy-only cleanup predicate", () => {
    for (const functionName of [
      "grainline_blocked_checkout_legacy_refund_lock_release",
      "grainline_case_legacy_refund_lock_release",
      "grainline_order_legacy_refund_lock_prune",
    ]) {
      const start = sql.indexOf(`public.${functionName}(`);
      assert.ok(start >= 0, `${functionName} declaration missing`);
      const end = sql.indexOf(`$${functionName}$;`, start);
      assert.ok(end > start, `${functionName} body missing`);
      const body = sql.slice(start, end);
      assert.match(body, /"sellerRefundId" = 'pending'/);
      assert.match(body, /"caseResolutionClaimId" IS NULL/);
      assert.match(body, /"refundClaimId" IS NULL/);
      assert.match(body, /interval '15 minutes'/);
    }
  });

  it("keeps the fixed operations narrow and off table grants or RLS posture", () => {
    assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 3);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, 3);
    assert.equal((sql.match(/TO grainline_app_runtime/g) ?? []).length, 3);
    assert.match(sql, /pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/);
    assert.match(sql, /accepted_function_count <> 3/);
    assert.match(sql, /named_runtime_function_count <> 3/);
    assert.doesNotMatch(
      sql,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/,
    );
    assert.match(helper, /rows\.length !== 1/);
    assert.match(helper, /Number\.isSafeInteger/);
  });

  it("removes the broad direct helper from every application caller", () => {
    const retiredHelper = fs.readFileSync("src/lib/refundLocks.ts", "utf8");
    assert.match(retiredHelper, /Retired compatibility marker/);
    assert.doesNotMatch(
      retiredHelper,
      /releaseStaleRefundLocks|\bprisma\.order\b|(?:FROM|UPDATE)\s+public\."Order"/,
    );
    assert.match(webhook, /releaseBlockedCheckoutLegacyRefundLock\(\{/);
    assert.match(caseRoute, /releaseCaseLegacyRefundLock\(\{/);
    assert.match(cron, /pruneLegacyRefundLocks\(\)/);
    assert.doesNotMatch(webhook, /releaseStaleRefundLocks/);
    assert.doesNotMatch(caseRoute, /releaseStaleRefundLocks/);
    assert.doesNotMatch(cron, /from "@\/lib\/refundLocks"/);
  });

  it("validates the Case body before making the exact repair call", () => {
    const parse = caseRoute.indexOf("CaseResolveSchema.parse(");
    const release = caseRoute.indexOf("await releaseCaseLegacyRefundLock({");
    const prepare = caseRoute.indexOf("prepared = await prepareCaseStaffResolution({");
    assert.ok(parse >= 0 && parse < release && release < prepare);
  });
});
