import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  sellerDeauthorizationResultFromRows,
} from "../src/lib/orderSellerDeauthorizationState.ts";

const platformWebhook = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const v2Webhook = fs.readFileSync("src/app/api/stripe/webhook/v2/route.ts", "utf8");
const providerCutover = fs.readFileSync("scripts/stripe-connect-provider-cutover.mjs", "utf8");
const authority = fs.readFileSync("src/lib/orderSellerDeauthorizationAuthority.ts", "utf8");
const webhookState = fs.readFileSync("src/lib/stripeWebhookState.ts", "utf8");
const webhookRoute = v2Webhook;
const candidate = fs.readFileSync(
  "docs/rls-drafts/order-seller-deauthorization-authority.sql",
  "utf8",
);

describe("Order seller deauthorization application authority", () => {
  it("parses only complete and internally consistent database results", () => {
    assert.deepEqual(sellerDeauthorizationResultFromRows([{
      outcome: "applied",
      seller_profile_id: "seller-1",
      public_visibility_changed: true,
      affected_order_count: 2n,
    }]), {
      outcome: "applied",
      sellerProfileId: "seller-1",
      publicVisibilityChanged: true,
      affectedOrderCount: 2,
    });
    assert.deepEqual(sellerDeauthorizationResultFromRows([{
      outcome: "absent",
      seller_profile_id: null,
      public_visibility_changed: false,
      affected_order_count: 0,
    }]), {
      outcome: "absent",
      sellerProfileId: null,
      publicVisibilityChanged: false,
      affectedOrderCount: 0,
    });
    for (const malformed of [
      [],
      [{ outcome: "forged", seller_profile_id: "seller-1", public_visibility_changed: true, affected_order_count: 1 }],
      [{ outcome: "applied", seller_profile_id: null, public_visibility_changed: true, affected_order_count: 1 }],
      [{ outcome: "absent", seller_profile_id: "seller-1", public_visibility_changed: false, affected_order_count: 0 }],
      [{ outcome: "absent", seller_profile_id: null, public_visibility_changed: true, affected_order_count: 0 }],
      [{ outcome: "absent", seller_profile_id: null, public_visibility_changed: false, affected_order_count: -1 }],
    ]) {
      assert.throws(() => sellerDeauthorizationResultFromRows(malformed), /seller deauthorization authority/);
    }
  });

  it("binds terminal seller cleanup to the reachable signed Accounts-v2 closure event", () => {
    const start = v2Webhook.indexOf('if (stripeEventType === "v2.core.account.closed")');
    const end = v2Webhook.indexOf("const account = await stripe.accounts.retrieve", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const branch = v2Webhook.slice(start, end);

    assert.match(providerCutover, /"v2\.core\.account\.closed"/);
    assert.match(branch, /applyStripeSellerDeauthorization\(\{[\s\S]*eventId: stripeEventId[\s\S]*claimGeneration[\s\S]*accountId: sourceObjectId[\s\S]*eventCreatedAt: new Date\(eventCreatedSeconds \* 1000\)/);
    assert.match(branch, /deauthorization\.publicVisibilityChanged[\s\S]*revalidatePublicSellerVisibilityCaches/);
    assert.match(branch, /deauthorization\.sellerProfileId[\s\S]*expireOpenCheckoutSessionsForSeller/);
    assert.match(branch, /source: "stripe_v2_account_closed"/);
    assert.doesNotMatch(branch, /prisma\.(?:sellerProfile|order)\./);
    assert.doesNotMatch(branch, /DEAUTHORIZED_SELLER_REVIEW_NOTE|updateMany|findMany/);
    assert.doesNotMatch(platformWebhook, /account\.application\.deauthorized/);
    assert.doesNotMatch(platformWebhook, /applyStripeSellerDeauthorization/);
    assert.match(candidate, /source_event\.type <> 'v2\.core\.account\.closed'/);
    assert.doesNotMatch(candidate, /source_event\.type <> 'account\.application\.deauthorized'/);
  });

  it("normalizes the signed Stripe instant to a UTC database timestamp", () => {
    assert.match(authority, /eventCreatedAt\.toISOString\(\)/);
    assert.match(authority, /::timestamptz AT TIME ZONE 'UTC'/);
    assert.doesNotMatch(authority, /\$\{input\.eventCreatedAt\}::timestamp/);
  });

  it("matches the bounded signed webhook age and future-skew acceptance window", () => {
    assert.match(webhookState, /STRIPE_WEBHOOK_MAX_EVENT_AGE_SECONDS = 30 \* 24 \* 60 \* 60/);
    assert.match(webhookState, /STRIPE_WEBHOOK_FUTURE_SKEW_SECONDS = 10 \* 60/);
    assert.match(webhookRoute, /export const maxDuration = 30/);
    assert.match(candidate, /p_event_created_at < source_now - interval '30 days 1 minute'/);
    assert.match(candidate, /p_event_created_at > source_now \+ interval '10 minutes'/);
    assert.doesNotMatch(candidate, /p_event_created_at < source_now - interval '8 days'/);
    assert.doesNotMatch(candidate, /p_event_created_at < source_now - interval '30 days'/);
    assert.doesNotMatch(candidate, /p_event_created_at > source_now \+ interval '5 minutes'/);
  });
});
