#!/usr/bin/env node
import { fileURLToPath } from "node:url";

export const PLATFORM_WEBHOOK_URL = "https://thegrainline.com/api/stripe/webhook";
export const REVIEWED_PLATFORM_ENDPOINT_ID = "we_1TG9607dFPHZMTngXaWRazjq";
export const PLATFORM_EVENTS = Object.freeze([
  "charge.dispute.closed",
  "charge.dispute.created",
  "charge.dispute.funds_reinstated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.updated",
  "charge.refunded",
  "checkout.session.async_payment_failed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "checkout.session.expired",
]);

function reject(code) {
  throw new Error(`stripe-incident-readonly:${code}`);
}

export function assertTestKey(secret) {
  if (typeof secret !== "string" || !/^sk_test_[A-Za-z0-9_]{8,}$/.test(secret)) {
    reject("test-key-required");
  }
}

export function makeStripeReadOnlyClient(secret, fetchImpl = fetch) {
  assertTestKey(secret);
  return {
    webhookEndpoints: {
      async list({ limit, starting_after: startingAfter }) {
        if (limit !== 100 || (startingAfter && !/^we_[A-Za-z0-9]+$/.test(startingAfter))) {
          reject("invalid-read-request");
        }
        const url = new URL("https://api.stripe.com/v1/webhook_endpoints");
        url.searchParams.set("limit", "100");
        if (startingAfter) url.searchParams.set("starting_after", startingAfter);
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": "2026-02-25.clover" },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status !== 200) reject("provider-http-status");
        const body = await response.text();
        if (body.length > 1_000_000) reject("provider-response-size");
        try { return JSON.parse(body); } catch { reject("provider-response-json"); }
      },
    },
  };
}

export async function verifyStripeIncidentReadOnly({ secret, stripe }) {
  assertTestKey(secret);
  if (!stripe?.webhookEndpoints || typeof stripe.webhookEndpoints.list !== "function") {
    reject("client-contract");
  }

  const ids = new Set();
  const canonical = [];
  let startingAfter;
  for (let page = 0; page < 5; page += 1) {
    let response;
    try {
      response = await stripe.webhookEndpoints.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    } catch {
      reject("provider-read-failed");
    }
    if (!response || !Array.isArray(response.data) || typeof response.has_more !== "boolean") {
      reject("provider-response-shape");
    }
    for (const endpoint of response.data) {
      if (!endpoint || typeof endpoint.id !== "string" || !/^we_[A-Za-z0-9]+$/.test(endpoint.id) || ids.has(endpoint.id)) {
        reject("provider-endpoint-identity");
      }
      ids.add(endpoint.id);
      if (endpoint.url === PLATFORM_WEBHOOK_URL) canonical.push(endpoint);
    }
    if (!response.has_more) break;
    if (page === 4 || response.data.length !== 100) reject("provider-pagination");
    startingAfter = response.data.at(-1).id;
  }

  if (canonical.length !== 1) reject("canonical-endpoint-count");
  const endpoint = canonical[0];
  if (endpoint.id !== REVIEWED_PLATFORM_ENDPOINT_ID) reject("canonical-endpoint-drift");
  if (endpoint.status !== "enabled" || endpoint.livemode !== false) reject("canonical-endpoint-state");
  if (!Array.isArray(endpoint.enabled_events) || endpoint.enabled_events.some((value) => typeof value !== "string")) {
    reject("canonical-event-shape");
  }
  const events = [...new Set(endpoint.enabled_events)].sort();
  if (events.length !== endpoint.enabled_events.length || JSON.stringify(events) !== JSON.stringify(PLATFORM_EVENTS)) {
    reject("canonical-event-drift");
  }

  return Object.freeze({
    status: "read-only-current-key-observed",
    keyMode: "test",
    primaryEndpointId: endpoint.id,
    primaryEndpointUrl: PLATFORM_WEBHOOK_URL,
    primaryEndpointEnabled: true,
    primaryEndpointTestMode: true,
    primaryEventSetMatchesReviewed: true,
    endpointInventoryCount: ids.size,
    providerMutationPerformed: false,
    replacementKeyAuthenticated: false,
    webhookSecretEqualityVerified: false,
    signedReplacementDeliveryVerified: false,
    predecessorRevoked: false,
    credentialIncidentAccepted: false,
    orderRlsActivated: false,
  });
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  assertTestKey(secret);
  const stripe = makeStripeReadOnlyClient(secret);
  const result = await verifyStripeIncidentReadOnly({ secret, stripe });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.stderr.write("stripe-incident-readonly:unexpected-arguments\n");
    process.exitCode = 2;
  } else {
    main().catch((error) => {
      const code = typeof error?.message === "string" && /^stripe-incident-readonly:[a-z-]+$/.test(error.message)
        ? error.message
        : "stripe-incident-readonly:execution-failed";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
  }
}
