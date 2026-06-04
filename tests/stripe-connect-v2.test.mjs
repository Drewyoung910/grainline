import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildStripeConnectV2AccountCreateParams,
  STRIPE_CONNECT_ACCOUNT_VERSION,
  STRIPE_CONNECT_CONTROLLER_SUMMARY,
  STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX,
  STRIPE_CONNECT_V2_API_VERSION,
  isStripeConnectV2AccountEvent,
  isSupportedStripeConnectAccountVersion,
  stripeConnectV2AccountIdFromNotification,
  stripeWebhookCreatedSeconds,
} from "../src/lib/stripeConnectV2State.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Stripe Connect v2 migration guardrails", () => {
  it("builds Accounts v2 params for an express-dashboard marketplace account", () => {
    const params = buildStripeConnectV2AccountCreateParams({
      email: " maker@example.com ",
      country: "us",
    });

    assert.equal(STRIPE_CONNECT_ACCOUNT_VERSION, "v2");
    assert.equal(isSupportedStripeConnectAccountVersion("v2"), true);
    assert.equal(isSupportedStripeConnectAccountVersion(null), true);
    assert.equal(isSupportedStripeConnectAccountVersion("v1"), false);
    assert.equal(STRIPE_CONNECT_V2_API_VERSION, "2026-02-25.clover");
    assert.equal(STRIPE_CONNECT_CONTROLLER_SUMMARY, "dashboard:express|fees:application|losses:application|requirements:stripe");
    assert.deepEqual(params, {
      contact_email: "maker@example.com",
      identity: { country: "US" },
      dashboard: "express",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
      },
    });
  });

  it("normalizes country and omits blank contact email", () => {
    assert.deepEqual(
      buildStripeConnectV2AccountCreateParams({ email: " ", country: "bad" }).identity,
      { country: "US" },
    );
    assert.equal(
      "contact_email" in buildStripeConnectV2AccountCreateParams({ email: " ", country: "ca" }),
      false,
    );
  });

  it("normalizes v1 and v2 webhook event timestamps", () => {
    assert.equal(stripeWebhookCreatedSeconds(1770000000), 1770000000);
    assert.equal(stripeWebhookCreatedSeconds("2026-02-03T04:05:06.000Z"), 1770091506);
    assert.equal(stripeWebhookCreatedSeconds("not-a-date"), undefined);
  });

  it("extracts account ids from Accounts v2 thin notifications only", () => {
    assert.equal(STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX, "v2.core.account");
    assert.equal(isStripeConnectV2AccountEvent("v2.core.account[requirements].updated"), true);
    assert.equal(isStripeConnectV2AccountEvent("v2.core.account[configuration.recipient].updated"), true);
    assert.equal(isStripeConnectV2AccountEvent("v2.core.account.created"), true);
    assert.equal(isStripeConnectV2AccountEvent("v2.core.accounting.updated"), false);
    assert.equal(isStripeConnectV2AccountEvent("v2.core.event_destination.ping"), false);
    assert.equal(
      stripeConnectV2AccountIdFromNotification({
        related_object: { id: "acct_123", type: "v2.core.account" },
      }),
      "acct_123",
    );
    assert.equal(
      stripeConnectV2AccountIdFromNotification({
        related_object: { id: "acct_123", type: "v2.core.event_destination" },
      }),
      null,
    );
    assert.equal(stripeConnectV2AccountIdFromNotification({ related_object: null }), null);
  });

  it("creates connected accounts through the v2 raw endpoint, not legacy express account creation", () => {
    const helper = source("src/lib/stripeConnectV2.ts");
    const route = source("src/app/api/stripe/connect/create/route.ts");

    assert.match(helper, /"POST"/);
    assert.match(helper, /"\/v2\/core\/accounts"/);
    assert.match(helper, /apiVersion: STRIPE_CONNECT_V2_API_VERSION/);
    assert.match(helper, /idempotencyKey/);
    assert.doesNotMatch(route, /type:\s*"express"/);
    assert.doesNotMatch(route, /stripe\.accounts\.create\(/);
    assert.match(route, /stripeAccountVersion: STRIPE_CONNECT_ACCOUNT_VERSION/);
    assert.match(route, /stripeControllerType: STRIPE_CONNECT_CONTROLLER_SUMMARY/);
    assert.match(route, /isSupportedStripeConnectAccountVersion\(seller\.stripeAccountVersion\)/);
  });

  it("keeps Express dashboard login links and account.updated charges_enabled semantics", () => {
    const loginLinkRoute = source("src/app/api/stripe/connect/login-link/route.ts");
    const dashboardRoute = source("src/app/api/stripe/connect/dashboard/route.ts");
    const createRoute = source("src/app/api/stripe/connect/create/route.ts");

    assert.match(loginLinkRoute, /createLoginLink\(stripeAccountId\)/);
    assert.match(loginLinkRoute, /isSupportedStripeConnectAccountVersion\(seller\.stripeAccountVersion\)/);
    assert.match(loginLinkRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(loginLinkRoute, /import \{ privateJson, privateResponse \} from "@\/lib\/privateResponse"/);
    assert.match(loginLinkRoute, /privateJson\(\{ url: loginLink\.url \}\)/);
    assert.match(loginLinkRoute, /privateResponse\(rateLimitResponse\(/);
    assert.match(loginLinkRoute, /source: "stripe_connect_login_link"/);
    assert.doesNotMatch(loginLinkRoute, /Sentry\.captureException|console\.error\(/);
    assert.doesNotMatch(loginLinkRoute, /NextResponse\.json/);
    assert.match(dashboardRoute, /createLoginLink\(seller\.stripeAccountId\)/);
    assert.match(dashboardRoute, /isSupportedStripeConnectAccountVersion\(seller\.stripeAccountVersion\)/);
    assert.match(dashboardRoute, /ensureUserByClerkId\(userId\)/);
    assert.match(dashboardRoute, /accountAccessErrorResponse\(err\)/);
    assert.match(dashboardRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(dashboardRoute, /import \{ privateJson, privateResponse \} from "@\/lib\/privateResponse"/);
    assert.match(dashboardRoute, /privateJson\(\{ url: link\.url \}\)/);
    assert.match(dashboardRoute, /privateResponse\(rateLimitResponse\(/);
    assert.match(dashboardRoute, /source: "stripe_connect_dashboard_link"/);
    assert.doesNotMatch(dashboardRoute, /Sentry\.captureException|console\.error\(/);
    assert.doesNotMatch(dashboardRoute, /NextResponse\.json/);

    assert.match(createRoute, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(createRoute, /import \{ privateJson, privateResponse \} from "@\/lib\/privateResponse"/);
    assert.match(createRoute, /privateJson\(\{ url: link\.url \}\)/);
    assert.match(createRoute, /privateResponse\(rateLimitResponse\(/);
    assert.doesNotMatch(createRoute, /NextResponse\.json/);
    assert.match(createRoute, /catch \(error\) \{[\s\S]*source: "stripe_connect_create_status_refresh"/);
    const refreshTelemetryStart = createRoute.indexOf('source: "stripe_connect_create_status_refresh"');
    const refreshTelemetryBlock = createRoute.slice(refreshTelemetryStart, createRoute.indexOf("// Non-fatal", refreshTelemetryStart));
    for (const forbidden of [
      /accountId/,
      /stripeAccountId/,
      /seller\.id/,
      /userId/,
      /email/,
      /returnUrl/,
      /customReturnUrl/,
    ]) {
      assert.doesNotMatch(refreshTelemetryBlock, forbidden);
    }
    assert.match(refreshTelemetryBlock, /stripeAccountVersion/);
    assert.match(refreshTelemetryBlock, /previousChargesEnabled/);

    const statusRoute = source("src/app/api/stripe/connect/status/route.ts");
    assert.match(statusRoute, /safeRateLimit\(stripeConnectRatelimit, userId\)/);
    assert.match(statusRoute, /rateLimitResponse\(reset, "Too many Stripe status checks\."\)/);
    assert.match(statusRoute, /ensureUserByClerkId\(userId\)/);
    assert.match(statusRoute, /accountAccessErrorResponse\(err\)/);

    const webhook = source("src/app/api/stripe/webhook/route.ts");
    assert.match(webhook, /event\.type === "account\.updated"/);
    assert.match(webhook, /charges_enabled\?: boolean/);
    assert.match(webhook, /mirrorStripeChargesEnabled/);
    assert.doesNotMatch(webhook, /parseEventNotification/);
    assert.doesNotMatch(webhook, /STRIPE_V2_WEBHOOK_SECRET/);

    const v2Webhook = source("src/app/api/stripe/webhook/v2/route.ts");
    assert.match(v2Webhook, /STRIPE_V2_WEBHOOK_SECRET/);
    assert.match(v2Webhook, /stripe\.parseEventNotification\(body, signature, secret\)/);
    assert.match(v2Webhook, /isStripeConnectV2AccountEvent\(stripeEventType\)/);
    assert.match(v2Webhook, /stripeConnectV2AccountIdFromNotification\(notification\)/);
    assert.match(v2Webhook, /stripe\.accounts\.retrieve\(accountId\)/);
    assert.match(v2Webhook, /mirrorStripeChargesEnabled/);
    assert.match(v2Webhook, /chargesEnabled: Boolean\(account\.charges_enabled\)/);
    assert.match(v2Webhook, /route: "\/api\/stripe\/webhook\/v2"/);

    const middleware = source("src/middleware.ts");
    assert.match(middleware, /"\/api\/stripe\/webhook\/v2"/);
    assert.match(middleware, /pathname === "\/api\/stripe\/webhook\/v2"/);

    assert.match(webhook, /event\.type === "account\.application\.deauthorized"/);
  });

  it("preserves destination-charge accounting and full-refund transfer reversal behavior", () => {
    for (const path of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /payment_intent_data: \{/);
      assert.match(text, /transfer_data: \{/);
      assert.match(text, /amount: sellerTransferAmount/);
      assert.doesNotMatch(text, /application_fee_amount\s*:/);
    }

    const refunds = source("src/lib/marketplaceRefunds.ts");
    assert.match(refunds, /if \(isFullRefund\) \{/);
    assert.match(refunds, /reverse_transfer: true/);
    assert.match(refunds, /suffix.*"full"/s);
  });

  it("keeps schema and migration diagnostics backward-compatible", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260506203000_stripe_connect_v2_diagnostics/migration.sql");
    assert.match(schema, /stripeAccountId\s+String\?\s+@unique/);
    assert.match(schema, /chargesEnabled\s+Boolean\s+@default\(false\)/);
    assert.match(schema, /stripeAccountVersion\s+String\?\s+@db\.VarChar\(20\)/);
    assert.match(schema, /stripeControllerType\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(migration, /ADD COLUMN "stripeAccountVersion" VARCHAR\(20\)/);
    assert.match(migration, /ADD COLUMN "stripeControllerType" VARCHAR\(100\)/);
  });

  it("reads Connect version diagnostics before deletion and clears them during anonymization", () => {
    const accountDeletion = source("src/lib/accountDeletion.ts");
    assert.match(accountDeletion, /stripeAccountVersion: true/);
    assert.match(accountDeletion, /stripeControllerType: true/);
    assert.match(accountDeletion, /runAccountDeletionStripeRejectSideEffect\(\{/);
    assert.match(accountDeletion, /stripeAccountVersion,/);
    assert.match(accountDeletion, /stripeControllerType,/);
    assert.match(accountDeletion, /stripeAccountVersion: null/);
    assert.match(accountDeletion, /stripeControllerType: null/);
    assert.match(accountDeletion, /manualStripeReconciliationNote/);
  });
});
