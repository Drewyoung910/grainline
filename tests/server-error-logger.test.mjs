import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  sanitizeServerErrorMessage,
  sanitizeServerErrorTags,
  sanitizeServerErrorExtra,
} = await import("../src/lib/serverErrorLogger.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("server error logger", () => {
  it("sanitizes high-risk values before telemetry context", () => {
    const message = sanitizeServerErrorMessage(
      new Error("Failed for maker@example.com at https://example.com/reset?token=sk_test_123456789012 acct_123456789012345"),
    );

    assert.match(message, /\[email\]/);
    assert.match(message, /\[url\]/);
    assert.match(message, /\[token\]/);
    assert.doesNotMatch(message, /maker@example\.com/);
    assert.doesNotMatch(message, /https:\/\/example\.com/);
    assert.doesNotMatch(message, /acct_123456789012345/);

    assert.deepEqual(
      sanitizeServerErrorTags({
        route: "/dashboard/seller",
        recipient: "maker@example.com",
      }),
      {
        route: "/dashboard/seller",
        recipient: "[email]",
      },
    );
    assert.deepEqual(
      sanitizeServerErrorExtra({
        url: "https://example.com/private?x=1",
        count: 2,
        ok: false,
      }),
      {
        url: "[url]",
        count: 2,
        ok: false,
      },
    );
  });

  it("routes selected server action failures through the shared helper", () => {
    const files = [
      "src/app/admin/actions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/dashboard/onboarding/actions.ts",
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/seller/page.tsx",
    ];

    for (const path of files) {
      const text = source(path);
      assert.match(text, /logServerError\(/, `${path} should use shared server error logging`);
    }

    assert.doesNotMatch(source("src/app/admin/actions.ts"), /console\.error\("markReviewed failed:/);
    assert.doesNotMatch(source("src/app/admin/actions.ts"), /console\.error\("appendNote failed:/);
    assert.doesNotMatch(source("src/app/admin/support/actions.ts"), /console\.error\("setSupportRequestStatus failed:/);
    assert.doesNotMatch(source("src/app/dashboard/onboarding/actions.ts"), /console\.error\("\[onboarding action\] error:/);
    assert.doesNotMatch(source("src/app/dashboard/page.tsx"), /console\.error\("Archive listing failed:/);
    assert.doesNotMatch(source("src/app/dashboard/seller/page.tsx"), /console\.error\("\[stripe-connect\] Failed to refresh seller account status:/);

    assert.match(source("src/lib/serverErrorLogger.ts"), /sanitizeEmailOutboxError\(error\.stack\)/);
    assert.match(source("src/lib/serverErrorLogger.ts"), /level: context\.level/);
  });

  it("routes selected API final catches through the shared helper", () => {
    const routes = [
      ["src/app/api/cases/route.ts", "case_create_route"],
      ["src/app/api/cases/[id]/messages/route.ts", "case_message_route"],
      ["src/app/api/cases/[id]/escalate/route.ts", "case_escalate_route"],
      ["src/app/api/cases/[id]/mark-resolved/route.ts", "case_mark_resolved_route"],
      ["src/app/api/cases/[id]/resolve/route.ts", "case_resolve_route"],
      ["src/app/api/listings/[id]/similar/route.ts", "listing_similar_route"],
      ["src/app/api/listings/[id]/stock/route.ts", "listing_stock_route"],
      ["src/app/api/verification/apply/route.ts", "verification_apply_route"],
      ["src/app/api/orders/[id]/confirm-delivery/route.ts", "buyer_confirm_delivery_route"],
      ["src/app/api/orders/[id]/fulfillment/route.ts", "order_fulfillment_route"],
      ["src/app/api/orders/[id]/refund/route.ts", "seller_refund_route"],
      ["src/app/api/orders/[id]/label/route.ts", "label_purchase_route"],
      ["src/app/api/seller/analytics/route.ts", "seller_analytics"],
      ["src/app/api/seller/analytics/recent-sales/route.ts", "seller_analytics_recent_sales"],
      ["src/app/api/stripe/connect/dashboard/route.ts", "stripe_connect_dashboard_link"],
      ["src/app/api/stripe/connect/login-link/route.ts", "stripe_connect_login_link"],
      ["src/app/api/cart/route.ts", "cart_route"],
      ["src/app/api/cart/add/route.ts", "cart_add_route"],
      ["src/app/api/cron/commission-expire/route.ts", "cron_commission_expire"],
      ["src/app/api/cron/case-auto-close/route.ts", "cron_case_auto_close"],
    ];

    for (const [path, sourceTag] of routes) {
      const text = source(path);
      assert.match(text, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"|import \{ logServerError \} from '@\/lib\/serverErrorLogger'/);
      assert.match(text, new RegExp(`logServerError\\([^,]+, \\{\\s*source: ["']${sourceTag}["']`), `${path} should use ${sourceTag}`);
      assert.doesNotMatch(text, /console\.error\(/, `${path} should not raw-console final route failures`);
    }

    const caseResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    assert.match(caseResolve, /source: "case_refund_orphaned_after_stripe"/);
    assert.match(caseResolve, /refundCount: stripeRefundIds\.length/);
    const orphanedRefundTelemetry = caseResolve.slice(
      caseResolve.indexOf('source: "case_refund_orphaned_after_stripe"'),
      caseResolve.indexOf("await prisma.$transaction", caseResolve.indexOf('source: "case_refund_orphaned_after_stripe"')),
    );
    assert.doesNotMatch(orphanedRefundTelemetry, /stripeRefundId[:,]/);
    assert.doesNotMatch(orphanedRefundTelemetry, /stripeRefundIds[:,]/);

    const adminUndo = source("src/app/api/admin/audit/[id]/undo/route.ts");
    assert.match(adminUndo, /import \{ logServerError \} from '@\/lib\/serverErrorLogger'/);
    assert.match(adminUndo, /safeMessage === 'This action cannot be undone\.'/);
    assert.match(adminUndo, /source: 'admin_audit_undo_route'/);
    assert.doesNotMatch(adminUndo, /console\.error\('Admin undo failed:', error\)/);
  });

  it("sanitizes notification preference and message email side-effect failures", () => {
    const notifications = source("src/lib/notifications.ts");
    const messageThread = source("src/app/messages/[id]/page.tsx");

    assert.match(notifications, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(notifications, /source: "email_preference_check"/);
    assert.match(notifications, /failClosed: true/);
    assert.doesNotMatch(notifications, /console\.error\("Failed to check email preference:", e\)/);

    assert.match(messageThread, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(messageThread, /source: "message_thread_email"/);
    assert.doesNotMatch(messageThread, /console\.error\("Failed to send message notification email:", e\)/);
  });
});
