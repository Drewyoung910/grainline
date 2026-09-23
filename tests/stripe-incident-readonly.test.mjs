import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_EVENTS, PLATFORM_WEBHOOK_URL, REVIEWED_PLATFORM_ENDPOINT_ID, makeStripeReadOnlyClient, verifyStripeIncidentReadOnly } from "../scripts/stripe-incident-readonly.mjs";

const secret = "sk_test_fixture_value";
const endpoint = () => ({
  id: REVIEWED_PLATFORM_ENDPOINT_ID,
  url: PLATFORM_WEBHOOK_URL,
  status: "enabled",
  livemode: false,
  enabled_events: [...PLATFORM_EVENTS],
});
const client = (pages) => ({ webhookEndpoints: { list: async ({ starting_after }) => pages[starting_after || "first"] } });
const one = (item = endpoint()) => client({ first: { data: [item], has_more: false } });

test("valid test key inventories the reviewed platform endpoint without asserting incident closure", async () => {
  const result = await verifyStripeIncidentReadOnly({ secret, stripe: one() });
  assert.equal(result.primaryEndpointId, REVIEWED_PLATFORM_ENDPOINT_ID);
  assert.equal(result.primaryEventSetMatchesReviewed, true);
  assert.equal(result.providerMutationPerformed, false);
  assert.equal(result.webhookSecretEqualityVerified, false);
  assert.equal(result.credentialIncidentAccepted, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("rejects missing or live keys before contacting Stripe", async () => {
  let calls = 0;
  const stripe = { webhookEndpoints: { list: async () => { calls += 1; return { data: [], has_more: false }; } } };
  for (const value of [undefined, "sk_live_123456789", "rk_test_123456789", "sk_test_short"]) {
    await assert.rejects(verifyStripeIncidentReadOnly({ secret: value, stripe }), /test-key-required/);
  }
  assert.equal(calls, 0);
});

test("fails closed on changed endpoint, mode, event set, duplicate or missing canonical endpoint", async () => {
  const variants = [
    { ...endpoint(), id: "we_replaced" },
    { ...endpoint(), livemode: true },
    { ...endpoint(), status: "disabled" },
    { ...endpoint(), enabled_events: [...PLATFORM_EVENTS, "*"] },
    { ...endpoint(), enabled_events: [...PLATFORM_EVENTS, PLATFORM_EVENTS[0]] },
    { ...endpoint(), url: "https://example.test/api/stripe/webhook" },
  ];
  for (const value of variants) {
    await assert.rejects(verifyStripeIncidentReadOnly({ secret, stripe: one(value) }), /stripe-incident-readonly:/);
  }
  await assert.rejects(verifyStripeIncidentReadOnly({ secret, stripe: client({ first: { data: [endpoint(), endpoint()], has_more: false } }) }), /provider-endpoint-identity/);
});

test("refuses provider failure, malformed responses and incomplete pagination without leaking provider text", async () => {
  const failure = { webhookEndpoints: { list: async () => { throw new Error("Bearer exposed-provider-error"); } } };
  await assert.rejects(verifyStripeIncidentReadOnly({ secret, stripe: failure }), /^Error: stripe-incident-readonly:provider-read-failed$/);
  await assert.rejects(verifyStripeIncidentReadOnly({ secret, stripe: client({ first: { data: [], has_more: "yes" } }) }), /provider-response-shape/);
  await assert.rejects(verifyStripeIncidentReadOnly({ secret, stripe: client({ first: { data: [endpoint()], has_more: true } }) }), /provider-pagination/);
});

test("native adapter performs only a bounded GET and never emits a credential", async () => {
  const calls = [];
  const stripe = makeStripeReadOnlyClient(secret, async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ data: [endpoint()], has_more: false }) };
  });
  const result = await verifyStripeIncidentReadOnly({ secret, stripe });
  assert.equal(result.credentialIncidentAccepted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://api.stripe.com");
  assert.equal(calls[0].url.pathname, "/v1/webhook_endpoints");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(JSON.stringify(result).includes(secret), false);
});
