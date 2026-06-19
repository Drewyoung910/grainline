import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("HTTP status constants", () => {
  it("defines named statuses used by shared API helpers", () => {
    const helper = source("src/lib/httpStatus.ts");

    for (const [name, code] of [
      ["OK", 200],
      ["CREATED", 201],
      ["ACCEPTED", 202],
      ["BAD_REQUEST", 400],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["METHOD_NOT_ALLOWED", 405],
      ["PAYLOAD_TOO_LARGE", 413],
      ["LENGTH_REQUIRED", 411],
      ["TOO_MANY_REQUESTS", 429],
      ["INTERNAL_SERVER_ERROR", 500],
      ["BAD_GATEWAY", 502],
      ["SERVICE_UNAVAILABLE", 503],
    ]) {
      assert.match(helper, new RegExp(`${name}: ${code}`));
    }
  });

  it("keeps shared request, account, and rate-limit helpers on named statuses", () => {
    for (const path of ["src/lib/requestBody.ts", "src/lib/accountAccessError.ts", "src/lib/ratelimit.ts"]) {
      const text = source(path);
      assert.ok(
        text.includes('import { HTTP_STATUS } from "@/lib/httpStatus"') ||
          text.includes('import { HTTP_STATUS } from "./httpStatus.ts"'),
        `${path} should use HTTP_STATUS`,
      );
    }

    assert.match(source("src/lib/requestBody.ts"), /readonly status = HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/lib/requestBody.ts"), /readonly status = HTTP_STATUS\.BAD_REQUEST/);
    assert.match(source("src/lib/requestBody.ts"), /readonly status = HTTP_STATUS\.LENGTH_REQUIRED/);
    assert.match(source("src/lib/accountAccessError.ts"), /status = HTTP_STATUS\.FORBIDDEN/);
    assert.match(source("src/lib/ratelimit.ts"), /status: HTTP_STATUS\.TOO_MANY_REQUESTS/);
  });

  it("keeps high-signal account and Stripe Connect routes on named statuses", () => {
    for (const path of [
      "src/app/api/account/delete/route.ts",
      "src/app/api/account/export/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/stripe/connect/dashboard/route.ts",
      "src/app/api/stripe/connect/login-link/route.ts",
      "src/app/api/stripe/connect/status/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (400|401|403|404|405|409|413|500|503)\b/,
        `${path} should use named statuses for local responses`,
      );
    }

    assert.match(source("src/app/api/account/export/route.ts"), /HTTP_STATUS\.METHOD_NOT_ALLOWED/);
    assert.match(source("src/app/api/account/delete/route.ts"), /HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(source("src/app/api/account/shipping-address/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/stripe/connect/create/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/stripe/connect/login-link/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/stripe/connect/dashboard/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/stripe/connect/status/route.ts"), /HTTP_STATUS\.CONFLICT/);
  });

  it("keeps high-signal checkout, refund, label, case, and shipping routes on named statuses", () => {
    for (const path of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/orders/[id]/refund/route.ts",
      "src/app/api/orders/[id]/label/route.ts",
      "src/app/api/cases/[id]/resolve/route.ts",
      "src/app/api/shipping/quote/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (400|401|403|404|409|413|500|502)\b|status = (400|401|403|404|409|413|500|502)\b|=== (400|401|403|404|409|413|500|502)\b/,
        `${path} should use named statuses for local high-signal responses`,
      );
    }

    assert.match(source("src/app/api/cart/checkout/single/route.ts"), /HTTP_STATUS\.CONFLICT/);
    assert.match(source("src/app/api/cart/checkout-seller/route.ts"), /HTTP_STATUS\.CONFLICT/);
    assert.match(source("src/app/api/orders/[id]/refund/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/orders/[id]/label/route.ts"), /HTTP_STATUS\.BAD_GATEWAY/);
    assert.match(source("src/app/api/cases/[id]/resolve/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/shipping/quote/route.ts"), /HTTP_STATUS\.FORBIDDEN/);
  });

  it("keeps health and touched account routes on named statuses", () => {
    for (const path of [
      "src/app/api/health/route.ts",
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/feed/route.ts",
      "src/app/api/account/notifications/preferences/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (200|400|401|403|404|405|409|413|429|500|502|503)\b/,
        `${path} should use named statuses for local responses`,
      );
    }

    assert.match(source("src/app/api/health/route.ts"), /HTTP_STATUS\.OK/);
    assert.match(source("src/app/api/health/route.ts"), /HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(source("src/app/api/account/accept-terms/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/account/notifications/preferences/route.ts"), /HTTP_STATUS\.BAD_REQUEST/);
    assert.match(source("src/app/api/account/feed/route.ts"), /HTTP_STATUS\.UNAUTHORIZED/);
  });

  it("keeps touched interaction, commission, and cron routes on named statuses", () => {
    for (const path of [
      "src/app/api/favorites/route.ts",
      "src/app/api/commission/route.ts",
      "src/app/api/cron/quality-score/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (400|401|403|404|413|500)\b/,
        `${path} should use named statuses for local responses`,
      );
    }

    assert.match(source("src/app/api/favorites/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/commission/route.ts"), /HTTP_STATUS\.FORBIDDEN/);
    assert.match(source("src/app/api/cron/quality-score/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
  });

  it("keeps touched review and admin mutation routes on named statuses", () => {
    for (const path of [
      "src/app/api/reviews/[id]/route.ts",
      "src/app/api/reviews/[id]/reply/route.ts",
      "src/app/api/admin/verify-pin/route.ts",
      "src/app/api/admin/users/[id]/ban/route.ts",
      "src/app/api/admin/audit/[id]/undo/route.ts",
      "src/app/api/admin/email/route.ts",
      "src/app/api/admin/listings/[id]/review/route.ts",
      "src/app/api/admin/listings/[id]/route.ts",
      "src/app/api/admin/reports/[id]/resolve/route.ts",
      "src/app/api/admin/reviews/[id]/route.ts",
      "src/app/api/cart/route.ts",
      "src/app/api/cart/add/route.ts",
      "src/app/api/cron/commission-expire/route.ts",
      "src/app/api/cron/case-auto-close/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"|import \{ HTTP_STATUS \} from '@\/lib\/httpStatus'/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (400|401|403|404|409|411|413|500|503)\b|status = (400|401|403|404|409|411|413|500|503)\b|=== (400|401|403|404|409|411|413|500|503)\b/,
        `${path} should use named statuses for local touched responses`,
      );
    }

    assert.match(source("src/app/api/reviews/[id]/route.ts"), /HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(source("src/app/api/admin/verify-pin/route.ts"), /HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(source("src/app/api/cart/add/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/cron/case-auto-close/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
  });

  it("keeps cron auth and failure statuses named across cron routes", () => {
    for (const path of [
      "src/app/api/cron/account-deletion-side-effects/route.ts",
      "src/app/api/cron/ban-side-effects/route.ts",
      "src/app/api/cron/case-auto-close/route.ts",
      "src/app/api/cron/checkout-stock-reservations/route.ts",
      "src/app/api/cron/commission-expire/route.ts",
      "src/app/api/cron/email-outbox/route.ts",
      "src/app/api/cron/guild-member-check/route.ts",
      "src/app/api/cron/guild-metrics/route.ts",
      "src/app/api/cron/label-clawback-retry/route.ts",
      "src/app/api/cron/notification-prune/route.ts",
      "src/app/api/cron/ops-health/route.ts",
      "src/app/api/cron/order-pii-prune/route.ts",
      "src/app/api/cron/quality-score/route.ts",
      "src/app/api/cron/site-metrics-snapshot/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/, `${path} should import HTTP_STATUS`);
      assert.doesNotMatch(
        text,
        /status: (401|500)\b/,
        `${path} should use named statuses for shared cron auth/failure responses`,
      );
      assert.match(text, /HTTP_STATUS\.UNAUTHORIZED/);
    }

    assert.match(source("src/app/api/cron/account-deletion-side-effects/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(source("src/app/api/cron/site-metrics-snapshot/route.ts"), /HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
  });
});
