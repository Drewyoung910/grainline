import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildStripeConnectV2AccountCreateParams,
  STRIPE_CONNECT_ACCOUNT_VERSION,
  STRIPE_CONNECT_CONTROLLER_SUMMARY,
  STRIPE_CONNECT_V2_API_VERSION,
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
  });

  it("keeps Express dashboard login links and account.updated charges_enabled semantics", () => {
    assert.match(source("src/app/api/stripe/connect/login-link/route.ts"), /createLoginLink\(stripeAccountId\)/);
    assert.match(source("src/app/api/stripe/connect/dashboard/route.ts"), /createLoginLink\(seller\.stripeAccountId\)/);

    const webhook = source("src/app/api/stripe/webhook/route.ts");
    assert.match(webhook, /event\.type === "account\.updated"/);
    assert.match(webhook, /charges_enabled\?: boolean/);
    assert.match(webhook, /const newChargesEnabled = Boolean\(account\.charges_enabled\)/);
    assert.match(webhook, /data: \{ chargesEnabled: newChargesEnabled \}/);

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
});
