import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CLERK_PRODUCTION_INSTANCE,
  CLERK_WEBHOOK_EVENTS,
  CLERK_WEBHOOK_PROVIDER_TIME_ZONE,
  CLERK_WEBHOOK_PREDECESSOR_SECRET_SHA256,
  CLERK_WEBHOOK_URL,
  buildClerkWebhookInventoryEvidence,
  classifyClerkWebhookProviderInventory,
  normalizeClerkWebhookEndpoint,
  normalizeClerkWebhookPredecessorSecret,
  normalizeClerkWebhookProviderInventory,
} from "../scripts/clerk-webhook-provider-inventory.mjs";

const PREDECESSOR_SECRET = "whsec_placeholder_for_digest_test_only";

function endpoint(patch = {}) {
  return {
    id: "ep_12345678abcdefgh",
    url: CLERK_WEBHOOK_URL,
    status: "enabled",
    events: [...CLERK_WEBHOOK_EVENTS],
    createdAtObservation: {
      displayed: "January 1, 2026 at 9:04 PM",
      timeZone: CLERK_WEBHOOK_PROVIDER_TIME_ZONE,
      precision: "minute",
      utcStartInclusive: "2026-01-02T03:04:00.000Z",
      utcEndExclusive: "2026-01-02T03:05:00.000Z",
    },
    description: "Grainline production user lifecycle",
    ...patch,
  };
}

function inventory(patch = {}) {
  return {
    schemaVersion: 2,
    source: "clerk-svix-dashboard",
    capturedAt: "2026-09-04T16:00:00.000Z",
    instanceId: CLERK_PRODUCTION_INSTANCE.id,
    environmentType: "production",
    totalEndpointCount: 1,
    canonicalUrlMatchCount: 1,
    endpoint: endpoint(),
    ...patch,
  };
}

test("normalizes one exact canonical production endpoint without private data", () => {
  assert.deepEqual(normalizeClerkWebhookProviderInventory(inventory()), inventory());
  assert.equal(CLERK_WEBHOOK_PREDECESSOR_SECRET_SHA256.length, 64);
  const testDigest = createHash("sha256").update(PREDECESSOR_SECRET).digest("hex");
  assert.deepEqual(
    normalizeClerkWebhookPredecessorSecret(PREDECESSOR_SECRET, testDigest),
    { sha256: testDigest },
  );
});

test("rejects ambiguous targets, endpoint drift, and malformed portal transcription", () => {
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ canonicalUrlMatchCount: 2 })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ totalEndpointCount: 0 })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ totalEndpointCount: 65 })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ environmentType: "development" })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ instanceId: "ins_other" })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({ endpoint: endpoint({
    url: "https://www.thegrainline.com/api/clerk/webhook",
  }) })));
  assert.throws(() => normalizeClerkWebhookProviderInventory({ ...inventory(), extra: true }));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({ id: "bad" })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({ status: "active" })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      utcStartInclusive: "2026-02-30T03:04:00.000Z",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      timeZone: "UTC",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      precision: "second",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      displayed: "January 1, 2026 at 9:05 PM",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      utcStartInclusive: "2026-01-02T03:04:00.123Z",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      utcEndExclusive: "2026-01-02T03:06:00.000Z",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    createdAtObservation: {
      ...endpoint().createdAtObservation,
      source: "dashboard",
    },
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    events: ["user.created", "user.created"],
  })));
  assert.throws(() => normalizeClerkWebhookEndpoint(endpoint({
    url: `${CLERK_WEBHOOK_URL}?secret=bad`,
  })));
  assert.throws(() => normalizeClerkWebhookProviderInventory(inventory({
    capturedAt: "2026-01-02T03:04:59.999Z",
  })));
});

test("classifies subscription and disabled-state drift without authorizing mutation", () => {
  const accepted = classifyClerkWebhookProviderInventory(inventory());
  assert.equal(accepted.status, "passed");
  assert.equal(accepted.exactHandledSubscriptionSet, true);

  const drift = classifyClerkWebhookProviderInventory(inventory({ endpoint: endpoint({
    status: "disabled",
    events: ["user.created"],
  }) }));
  assert.equal(drift.status, "review-required");
  assert.deepEqual(drift.blockers, [
    "predecessor-endpoint-not-enabled",
    "subscription-set-requires-review",
  ]);
  assert.throws(() => buildClerkWebhookInventoryEvidence(inventory(), PREDECESSOR_SECRET));
  assert.throws(() => normalizeClerkWebhookPredecessorSecret(PREDECESSOR_SECRET));
});

test("retains the observed production subscription gap for explicit review", () => {
  const observed = classifyClerkWebhookProviderInventory(inventory({ endpoint: endpoint({
    events: ["user.created", "user.updated"],
    createdAtObservation: {
      displayed: "March 28, 2026 at 12:40 AM",
      timeZone: CLERK_WEBHOOK_PROVIDER_TIME_ZONE,
      precision: "minute",
      utcStartInclusive: "2026-03-28T05:40:00.000Z",
      utcEndExclusive: "2026-03-28T05:41:00.000Z",
    },
    description: null,
  }) }));
  assert.equal(observed.status, "review-required");
  assert.equal(observed.exactHandledSubscriptionSet, false);
  assert.deepEqual(observed.normalized.endpoint.events, ["user.created", "user.updated"]);
  assert.deepEqual(observed.blockers, ["subscription-set-requires-review"]);
});
