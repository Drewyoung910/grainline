import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { orderOpsHealthSummaryFromRows } from "../src/lib/orderOpsHealthState.ts";

const migration = readFileSync(
  "prisma/migrations/20260930033000_order_ops_health_summary/migration.sql",
  "utf8",
);
const wrapper = readFileSync("src/lib/orderOpsHealth.ts", "utf8");
const route = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");
const adminLayout = readFileSync("src/app/admin/layout.tsx", "utf8");
const adminMobileNav = readFileSync("src/components/AdminMobileNav.tsx", "utf8");

test("Order ops health exposes one fixed count-only runtime authority", () => {
  assert.equal((migration.match(/CREATE FUNCTION/g) ?? []).length, 1);
  assert.match(migration, /grainline_order_ops_health_summary\(\)/);
  assert.match(migration, /RETURNS TABLE\([\s\S]*issue_count bigint/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /LANGUAGE sql[\s\S]*STABLE[\s\S]*PARALLEL SAFE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
  assert.doesNotMatch(migration, /(?:ALTER|GRANT|REVOKE)[\s\S]{0,80}ON TABLE/);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s/i);
});

test("Order ops health thresholds match the existing repair schedules", () => {
  assert.match(migration, /'ambiguous_refund_pending_reconciliation'/);
  assert.match(migration, /"sellerRefundId" = 'pending'/);
  assert.match(migration, /"refundClaimProviderAuthorizedAt"[\s\S]*"sellerRefundLockedAt"[\s\S]*interval '30 minutes'/);
  assert.match(migration, /"labelClawbackStatus" = 'MANUAL_REVIEW'/);
  assert.match(migration, /"labelClawbackStatus" = 'RETRY_PENDING'[\s\S]*interval '30 minutes'/);
  assert.match(migration, /"reviewNeeded" = true[\s\S]*interval '24 hours'/);
  assert.match(migration, /status IN \('RESERVED', 'SESSION_CREATED'\)[\s\S]*interval '2 hours 30 minutes'/);
  assert.match(migration, /"repairClaimedAt"[\s\S]*interval '15 minutes'/);
  assert.match(migration, /"lastRepairError" IS NOT NULL[\s\S]*interval '30 minutes'/);
  assert.match(migration, /FROM public\."SellerPayoutEvent"[\s\S]*status = 'failed'[\s\S]*interval '24 hours'/);
});

test("Order ops health row parser accepts database count shapes and fails closed", () => {
  const row = {
    ambiguous_refund_count: "1",
    stale_refund_claim_count: 2n,
    manual_review_label_clawback_count: 3,
    overdue_label_clawback_retry_count: "4",
    aging_review_needed_count: 5n,
    stale_checkout_reservation_count: 6,
    recent_payout_failure_count: "7",
    issue_count: 28n,
  };
  assert.deepEqual(orderOpsHealthSummaryFromRows([row]), {
    ambiguousRefundCount: 1,
    staleRefundClaimCount: 2,
    manualReviewLabelClawbackCount: 3,
    overdueLabelClawbackRetryCount: 4,
    agingReviewNeededCount: 5,
    staleCheckoutReservationCount: 6,
    recentPayoutFailureCount: 7,
    issueCount: 28,
  });
  assert.throws(() => orderOpsHealthSummaryFromRows([]), /invalid row count/);
  assert.throws(
    () => orderOpsHealthSummaryFromRows([{ ...row, ambiguous_refund_count: -1 }]),
    /out-of-range/,
  );
  assert.throws(
    () => orderOpsHealthSummaryFromRows([{ ...row, issue_count: 27 }]),
    /inconsistent counts/,
  );
});

test("ops-health consumes only the fixed aggregate and returns unhealthy on Order issues", () => {
  assert.match(wrapper, /FROM public\.grainline_order_ops_health_summary\(\)/);
  assert.doesNotMatch(wrapper, /public\."(?:Order|CheckoutStockReservation|SellerPayoutEvent)"/);
  assert.match(route, /orderOpsHealthSummary\(\)/);
  assert.match(route, /orderOpsHealthIssueCount: orderHealth\.issueCount/);
  assert.match(route, /orderAmbiguousRefundCount: orderHealth\.ambiguousRefundCount/);
  assert.match(route, /orderStaleCheckoutReservationCount: orderHealth\.staleCheckoutReservationCount/);
  assert.match(route, /orderRecentPayoutFailureCount: orderHealth\.recentPayoutFailureCount/);
  assert.match(route, /issues\.orderOpsHealthIssueCount > 0/);
  assert.match(route, /status: response\.ok \? HTTP_STATUS\.OK : HTTP_STATUS\.SERVICE_UNAVAILABLE/);
});

test("staff navigation surfaces the existing review queue count on desktop and mobile", () => {
  assert.match(adminLayout, /readStaffOrderPage\(user\.id, "REVIEW_NEEDED", 1, 1,/);
  assert.match(adminLayout, /reviewNeededOrderCount = reviewNeededOrders\.totalCount/);
  assert.match(adminLayout, /reviewNeededOrderCount > 99 \? "99\+" : reviewNeededOrderCount/);
  assert.match(adminMobileNav, /badgeKey: "reviewNeededOrderCount"/);
});

test("database aggregate enforces table closure and counts only aged actionable states", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      SET TIME ZONE 'UTC';
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        "sellerRefundId" text,
        "refundClaimProviderAuthorizedAt" timestamp(3) without time zone,
        "sellerRefundLockedAt" timestamp(3) without time zone,
        "labelClawbackStatus" text,
        "labelClawbackNextAttemptAt" timestamp(3) without time zone,
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE public."CheckoutStockReservation" (
        id text PRIMARY KEY,
        status text NOT NULL,
        "expiresAt" timestamp(3) without time zone NOT NULL,
        "repairClaimedAt" timestamp(3) without time zone,
        "lastRepairError" text,
        "lastRepairAttemptAt" timestamp(3) without time zone
      );
      CREATE TABLE public."SellerPayoutEvent" (
        id text PRIMARY KEY,
        status text NOT NULL,
        "updatedAt" timestamp(3) without time zone NOT NULL
      );
      REVOKE ALL ON public."Order", public."CheckoutStockReservation",
        public."SellerPayoutEvent" FROM PUBLIC, grainline_app_runtime;

      INSERT INTO public."Order" (
        id, "sellerRefundId", "refundClaimProviderAuthorizedAt",
        "sellerRefundLockedAt", "labelClawbackStatus",
        "labelClawbackNextAttemptAt", "reviewNeeded", "updatedAt"
      ) VALUES
        ('ambiguous', 'ambiguous_refund_pending_reconciliation', NULL, NULL,
          NULL, NULL, false, CURRENT_TIMESTAMP),
        ('stale-refund', 'pending', CURRENT_TIMESTAMP - interval '31 minutes',
          CURRENT_TIMESTAMP - interval '32 minutes', NULL, NULL, false,
          CURRENT_TIMESTAMP),
        ('fresh-refund', 'pending', CURRENT_TIMESTAMP - interval '29 minutes',
          CURRENT_TIMESTAMP - interval '29 minutes', NULL, NULL, false,
          CURRENT_TIMESTAMP),
        ('manual-clawback', NULL, NULL, NULL, 'MANUAL_REVIEW', NULL, false,
          CURRENT_TIMESTAMP),
        ('overdue-clawback', NULL, NULL, NULL, 'RETRY_PENDING',
          CURRENT_TIMESTAMP - interval '31 minutes', false, CURRENT_TIMESTAMP),
        ('future-clawback', NULL, NULL, NULL, 'RETRY_PENDING',
          CURRENT_TIMESTAMP + interval '1 minute', false, CURRENT_TIMESTAMP),
        ('aging-review', NULL, NULL, NULL, NULL, NULL, true,
          CURRENT_TIMESTAMP - interval '25 hours'),
        ('fresh-review', NULL, NULL, NULL, NULL, NULL, true,
          CURRENT_TIMESTAMP - interval '23 hours');

      INSERT INTO public."CheckoutStockReservation" (
        id, status, "expiresAt", "repairClaimedAt", "lastRepairError",
        "lastRepairAttemptAt"
      ) VALUES
        ('stale-expiry', 'RESERVED', CURRENT_TIMESTAMP - interval '2 hours 31 minutes',
          NULL, NULL, NULL),
        ('stale-claim', 'SESSION_CREATED', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP - interval '16 minutes', NULL, NULL),
        ('stale-error', 'RESERVED', CURRENT_TIMESTAMP, NULL, 'provider failure',
          CURRENT_TIMESTAMP - interval '31 minutes'),
        ('fresh', 'RESERVED', CURRENT_TIMESTAMP, NULL, NULL, NULL),
        ('terminal', 'RESTORED', CURRENT_TIMESTAMP - interval '10 hours',
          CURRENT_TIMESTAMP - interval '10 hours', 'old',
          CURRENT_TIMESTAMP - interval '10 hours');

      INSERT INTO public."SellerPayoutEvent" (id, status, "updatedAt") VALUES
        ('recent-failure', 'failed', CURRENT_TIMESTAMP - interval '23 hours'),
        ('old-failure', 'failed', CURRENT_TIMESTAMP - interval '25 hours');
    `);
    await database.exec("SET TIME ZONE 'America/Chicago'");
    await database.exec(migration);

    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query('SELECT * FROM public."Order"'),
      /permission denied/,
    );
    const result = await database.query(
      "SELECT * FROM public.grainline_order_ops_health_summary()",
    );
    await database.exec("RESET ROLE");
    assert.deepEqual(orderOpsHealthSummaryFromRows(result.rows), {
      ambiguousRefundCount: 1,
      staleRefundClaimCount: 1,
      manualReviewLabelClawbackCount: 1,
      overdueLabelClawbackRetryCount: 1,
      agingReviewNeededCount: 1,
      staleCheckoutReservationCount: 3,
      recentPayoutFailureCount: 1,
      issueCount: 9,
    });
  } finally {
    await database.close();
  }
});
