#!/usr/bin/env node

import crypto from "node:crypto";

export const CLERK_PRODUCTION_INSTANCE = Object.freeze({
  id: "ins_3BYdVgH643MVFsiKPloUw9GUYQK",
  environmentType: "production",
});
export const CLERK_WEBHOOK_URL = "https://thegrainline.com/api/clerk/webhook";
export const CLERK_WEBHOOK_EVENTS = Object.freeze([
  "user.created",
  "user.deleted",
  "user.updated",
]);
export const CLERK_WEBHOOK_PROVIDER_TIME_ZONE = "America/Chicago";
export const CLERK_WEBHOOK_PREDECESSOR_SECRET_SHA256 =
  "3240b004c89c5b3853d08e4a4d004368f29e093253f71e95047e508ad0561ced";

const ENDPOINT_ID = /^ep_[A-Za-z0-9_-]{8,128}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_+/=-]{20,256}$/;
const MINUTE_MS = 60_000;

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  const canonical = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  const canonicalInput = typeof value === "string" && value.includes(".")
    ? value
    : value?.replace?.(/Z$/, ".000Z");
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || canonical === null
    || canonicalInput !== canonical
  ) throw new Error(`${label} is not an exact UTC timestamp`);
  return canonical;
}

function normalizeCreatedAtObservation(value) {
  if (!exactKeys(value, [
    "displayed",
    "timeZone",
    "precision",
    "utcStartInclusive",
    "utcEndExclusive",
  ])) throw new Error("Clerk webhook endpoint creation observation shape drifted");
  if (
    typeof value.displayed !== "string"
    || value.displayed !== value.displayed.trim()
    || value.displayed.length < 1
    || value.displayed.length > 100
    || /[\u0000-\u001f\u007f]/.test(value.displayed)
    || value.timeZone !== CLERK_WEBHOOK_PROVIDER_TIME_ZONE
    || value.precision !== "minute"
  ) throw new Error("Clerk webhook endpoint creation observation source drifted");
  const utcStartInclusive = normalizeTimestamp(
    value.utcStartInclusive,
    "Clerk webhook endpoint creation interval start",
  );
  const utcEndExclusive = normalizeTimestamp(
    value.utcEndExclusive,
    "Clerk webhook endpoint creation interval end",
  );
  const startMs = Date.parse(utcStartInclusive);
  const endMs = Date.parse(utcEndExclusive);
  if (startMs % MINUTE_MS !== 0 || endMs - startMs !== MINUTE_MS) {
    throw new Error("Clerk webhook endpoint creation interval is not one exact minute");
  }
  const expectedDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: value.timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(startMs));
  if (expectedDisplay !== value.displayed) {
    throw new Error("Clerk webhook endpoint creation display does not match its UTC interval");
  }
  return Object.freeze({
    displayed: value.displayed,
    timeZone: value.timeZone,
    precision: value.precision,
    utcStartInclusive,
    utcEndExclusive,
  });
}

function normalizeEvents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new Error("Clerk webhook event inventory is not bounded");
  }
  const events = value.map((event) => {
    if (typeof event !== "string" || event !== event.trim() || !EVENT_NAME.test(event)) {
      throw new Error("Clerk webhook event inventory contains an invalid event");
    }
    return event;
  });
  const normalized = [...new Set(events)].sort();
  if (normalized.length !== events.length) {
    throw new Error("Clerk webhook event inventory contains a duplicate event");
  }
  return Object.freeze(normalized);
}

function normalizeDescription(value) {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < 1
    || value.length > 200
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new Error("Clerk webhook endpoint description is invalid");
  return value;
}

export function normalizeClerkWebhookEndpoint(value) {
  if (!exactKeys(value, [
    "id",
    "url",
    "status",
    "events",
    "createdAtObservation",
    "description",
  ])) {
    throw new Error("Clerk webhook endpoint inventory shape drifted");
  }
  if (!ENDPOINT_ID.test(value.id ?? "")) {
    throw new Error("Clerk webhook endpoint id is invalid");
  }
  let url;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error("Clerk webhook endpoint URL is invalid");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.href !== value.url
  ) throw new Error("Clerk webhook endpoint URL is not canonical HTTPS");
  if (!["enabled", "disabled"].includes(value.status)) {
    throw new Error("Clerk webhook endpoint status is invalid");
  }
  return Object.freeze({
    id: value.id,
    url: value.url,
    status: value.status,
    events: normalizeEvents(value.events),
    createdAtObservation: normalizeCreatedAtObservation(value.createdAtObservation),
    description: normalizeDescription(value.description),
  });
}

export function normalizeClerkWebhookProviderInventory(value) {
  if (!exactKeys(value, [
    "schemaVersion",
    "source",
    "capturedAt",
    "instanceId",
    "environmentType",
    "totalEndpointCount",
    "canonicalUrlMatchCount",
    "endpoint",
  ])) throw new Error("Clerk webhook provider inventory shape drifted");
  if (
    value.schemaVersion !== 2
    || value.source !== "clerk-svix-dashboard"
    || value.instanceId !== CLERK_PRODUCTION_INSTANCE.id
    || value.environmentType !== CLERK_PRODUCTION_INSTANCE.environmentType
    || !Number.isSafeInteger(value.totalEndpointCount)
    || value.totalEndpointCount < 1
    || value.totalEndpointCount > 64
    || value.canonicalUrlMatchCount !== 1
    || value.canonicalUrlMatchCount > value.totalEndpointCount
  ) throw new Error("Clerk webhook provider inventory target drifted");
  const endpoint = normalizeClerkWebhookEndpoint(value.endpoint);
  const capturedAt = normalizeTimestamp(
    value.capturedAt,
    "Clerk webhook inventory capturedAt",
  );
  if (endpoint.url !== CLERK_WEBHOOK_URL) {
    throw new Error("Clerk webhook provider inventory does not identify the canonical route");
  }
  if (
    Date.parse(endpoint.createdAtObservation.utcEndExclusive)
      > Date.parse(capturedAt)
  ) {
    throw new Error("Clerk webhook endpoint cannot postdate its provider inventory");
  }
  return Object.freeze({
    schemaVersion: 2,
    source: value.source,
    capturedAt,
    instanceId: value.instanceId,
    environmentType: value.environmentType,
    totalEndpointCount: value.totalEndpointCount,
    canonicalUrlMatchCount: value.canonicalUrlMatchCount,
    endpoint,
  });
}

export function normalizeClerkWebhookPredecessorSecret(
  value,
  expectedSha256 = CLERK_WEBHOOK_PREDECESSOR_SECRET_SHA256,
) {
  if (!SHA256.test(expectedSha256 ?? "")) {
    throw new Error("Clerk webhook expected predecessor digest is invalid");
  }
  if (typeof value !== "string" || value !== value.trim() || !WEBHOOK_SECRET.test(value)) {
    throw new Error("Clerk webhook predecessor secret shape drifted");
  }
  const digest = sha256(value);
  if (digest !== expectedSha256) {
    throw new Error("Clerk webhook predecessor secret digest drifted");
  }
  return Object.freeze({ sha256: digest });
}

export function classifyClerkWebhookProviderInventory(inventory) {
  const normalized = normalizeClerkWebhookProviderInventory(inventory);
  const eventsMatch = JSON.stringify(normalized.endpoint.events)
    === JSON.stringify(CLERK_WEBHOOK_EVENTS);
  const blockers = [];
  if (normalized.endpoint.status !== "enabled") blockers.push("predecessor-endpoint-not-enabled");
  if (!eventsMatch) blockers.push("subscription-set-requires-review");
  return Object.freeze({
    normalized,
    status: blockers.length === 0 ? "passed" : "review-required",
    exactHandledSubscriptionSet: eventsMatch,
    blockers: Object.freeze(blockers),
  });
}

export function buildClerkWebhookInventoryEvidence(inventory, predecessorSecret) {
  const classification = classifyClerkWebhookProviderInventory(inventory);
  const { normalized } = classification;
  const predecessor = normalizeClerkWebhookPredecessorSecret(predecessorSecret);
  const evidence = Object.freeze({
    schemaVersion: 2,
    operation: "clerk-webhook-provider-inventory",
    status: classification.status,
    mutationAuthorized: false,
    capturedAt: normalized.capturedAt,
    instanceId: normalized.instanceId,
    environmentType: normalized.environmentType,
    totalEndpointCount: normalized.totalEndpointCount,
    canonicalUrlMatchCount: normalized.canonicalUrlMatchCount,
    predecessorEndpoint: Object.freeze({
      id: normalized.endpoint.id,
      url: normalized.endpoint.url,
      status: normalized.endpoint.status,
      events: normalized.endpoint.events,
      createdAtObservation: normalized.endpoint.createdAtObservation,
    }),
    predecessorSecretSha256: predecessor.sha256,
    exactHandledSubscriptionSet: classification.exactHandledSubscriptionSet,
    blockers: classification.blockers,
  });
  const serialized = JSON.stringify(evidence);
  if (
    /whsec_|svix_url|https:\/\/app\.svix\.com/i.test(serialized)
    || !SHA256.test(evidence.predecessorSecretSha256)
  ) throw new Error("sanitized Clerk webhook inventory evidence retained private data");
  return evidence;
}
