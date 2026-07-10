#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "live-read";
const DEFAULT_APP_URL = "https://thegrainline.com";
const REQUIRED_HOST = "thegrainline.com";
const STRIPE_API_VERSION = "2026-02-25.clover";
const EVIDENCE_MAX_ISSUES = 20;
const CONNECT_V2_ACCOUNT_EVENT_PREFIX = "v2.core.account";

const EXPECTED_SNAPSHOT_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
  "account.updated",
  "account.application.deauthorized",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "payout.failed",
];

const STRIPE_WEBHOOK_PROOF_ENV_PATTERN =
  /["']?\b(?:STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_V2_WEBHOOK_SECRET|STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_[A-Z0-9_]+)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(STRIPE_WEBHOOK_PROOF_ENV_PATTERN, "[redacted-stripe-webhook-proof-env]")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  if (error instanceof Error) return redact(error.message || error.name);
  return redact(String(error));
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBooleanFlag(env, name) {
  return env[name] === "1" || env[name] === "true";
}

function evidencePathFromEnv(env) {
  const raw = required(env, "STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) {
    throw new Error("STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH must not contain null bytes");
  }
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function appUrlFromEnv(env) {
  const raw = env.STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL || DEFAULT_APP_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL must be HTTPS");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function stripeKeyMode(env, secretKey) {
  if (secretKey.startsWith("sk_live_")) return "live";
  if (secretKey.startsWith("sk_test_") && parseBooleanFlag(env, "STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_ALLOW_TEST_MODE")) {
    return "test-dry-run";
  }
  throw new Error("STRIPE_SECRET_KEY must be a live sk_live_ key for launch evidence");
}

export function parseConfig(env = process.env) {
  if (env.STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  const appUrl = appUrlFromEnv(env);
  if (appUrl.hostname !== REQUIRED_HOST) {
    throw new Error(`STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL must target ${REQUIRED_HOST}`);
  }

  const secretKey = required(env, "STRIPE_SECRET_KEY");
  return {
    appUrl,
    evidencePath: evidencePathFromEnv(env),
    mode: stripeKeyMode(env, secretKey),
    secretKey,
  };
}

function expectedUrl(config, pathname) {
  return new URL(pathname, config.appUrl).href;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function diffSets(actualValues, expectedValues) {
  const actual = sortedUnique(actualValues);
  const expected = sortedUnique(expectedValues);
  return {
    actual,
    expected,
    extra: actual.filter((event) => !expected.includes(event)),
    missing: expected.filter((event) => !actual.includes(event)),
  };
}

function assertExactSnapshotEvents(endpoint) {
  const diff = diffSets(endpoint.enabled_events ?? [], EXPECTED_SNAPSHOT_EVENTS);
  if (diff.actual.includes("*")) {
    throw new Error("snapshot webhook endpoint subscribes to wildcard events");
  }
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    throw new Error(
      `snapshot webhook events mismatch: missing=${diff.missing.join(",") || "none"} extra=${diff.extra.join(",") || "none"}`,
    );
  }
  return diff.actual;
}

function isConnectV2AccountEvent(event) {
  return (
    event === CONNECT_V2_ACCOUNT_EVENT_PREFIX ||
    event.startsWith(`${CONNECT_V2_ACCOUNT_EVENT_PREFIX}.`) ||
    event.startsWith(`${CONNECT_V2_ACCOUNT_EVENT_PREFIX}[`)
  );
}

function assertConnectV2AccountEventsOnly(destination) {
  const events = sortedUnique(destination.enabled_events ?? []);
  if (events.length === 0) throw new Error("Connect v2 event destination has no enabled events");
  if (events.includes("*")) {
    throw new Error("Connect v2 event destination subscribes to wildcard events");
  }
  const outOfFamily = events.filter((event) => !isConnectV2AccountEvent(event));
  if (outOfFamily.length > 0) {
    throw new Error(`Connect v2 event destination has non-account events: ${outOfFamily.join(",")}`);
  }
  return events;
}

function assertSingleMatch(matches, label) {
  if (matches.length === 0) throw new Error(`${label} was not found`);
  if (matches.length > 1) throw new Error(`${label} has multiple active matches`);
  return matches[0];
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") {
    return listPromise.autoPagingToArray({ limit: 1000 });
  }

  const rows = [];
  for await (const item of listPromise) rows.push(item);
  return rows;
}

async function checkSnapshotWebhook({ config, stripe }) {
  const url = expectedUrl(config, "/api/stripe/webhook");
  const endpoints = await listAll(stripe.webhookEndpoints.list({ limit: 100 }));
  const matches = endpoints.filter((endpoint) => endpoint.url === url && endpoint.status === "enabled");
  const endpoint = assertSingleMatch(matches, "enabled snapshot webhook endpoint");
  const enabledEvents = assertExactSnapshotEvents(endpoint);

  if (endpoint.livemode !== (config.mode === "live")) {
    throw new Error(`snapshot webhook livemode was ${endpoint.livemode}, expected ${config.mode === "live"}`);
  }

  return {
    apiVersion: endpoint.api_version ?? null,
    applicationPresent: Boolean(endpoint.application),
    enabledEvents,
    endpointId: endpoint.id,
    httpMethod: "POST",
    livemode: endpoint.livemode,
    statusValue: endpoint.status,
    url,
  };
}

async function checkConnectV2EventDestination({ config, stripe }) {
  const url = expectedUrl(config, "/api/stripe/webhook/v2");
  const destinations = await listAll(
    stripe.v2.core.eventDestinations.list({
      include: ["webhook_endpoint.url"],
      limit: 100,
    }),
  );
  const matches = destinations.filter(
    (destination) =>
      destination.type === "webhook_endpoint" &&
      destination.webhook_endpoint?.url === url &&
      destination.status === "enabled",
  );
  const destination = assertSingleMatch(matches, "enabled Connect v2 event destination");
  const enabledEvents = assertConnectV2AccountEventsOnly(destination);

  if (destination.event_payload !== "thin") {
    throw new Error(`Connect v2 event destination payload was ${destination.event_payload}, expected thin`);
  }
  if (destination.livemode !== (config.mode === "live")) {
    throw new Error(`Connect v2 event destination livemode was ${destination.livemode}, expected ${config.mode === "live"}`);
  }

  return {
    destinationId: destination.id,
    enabledEvents,
    eventFamily: CONNECT_V2_ACCOUNT_EVENT_PREFIX,
    eventPayload: destination.event_payload,
    eventsFrom: sortedUnique(destination.events_from ?? []),
    livemode: destination.livemode,
    statusValue: destination.status,
    type: destination.type,
    url,
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    mode: config?.mode ?? null,
    target: {
      appOrigin: config?.appUrl?.origin ?? null,
      snapshotWebhookPath: "/api/stripe/webhook",
      connectV2WebhookPath: "/api/stripe/webhook/v2",
    },
    expected: {
      snapshotEvents: EXPECTED_SNAPSHOT_EVENTS,
      connectV2EventFamily: CONNECT_V2_ACCOUNT_EVENT_PREFIX,
    },
    checks,
    caveats: [
      "Stripe does not return webhook signing secrets after creation; retain dashboard/Vercel evidence that STRIPE_WEBHOOK_SECRET and STRIPE_V2_WEBHOOK_SECRET match the separate provider endpoints.",
    ],
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createStripeClient(config) {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

export async function runStripeWebhookSubscriptionsProof(env = process.env) {
  const startedAt = new Date().toISOString();
  let config;
  const checks = [];
  const issues = [];
  let status = "passed";

  try {
    config = parseConfig(env);
    const stripe = createStripeClient(config);
    checks.push({
      name: "legacy-snapshot-webhook-subscription",
      status: "passed",
      ...(await checkSnapshotWebhook({ config, stripe })),
    });
    checks.push({
      name: "connect-v2-thin-event-destination",
      status: "passed",
      ...(await checkConnectV2EventDestination({ config, stripe })),
    });
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Stripe webhook subscriptions proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStripeWebhookSubscriptionsProof()
    .then((payload) => {
      console.log(`Stripe webhook subscriptions proof passed for ${payload.target.appOrigin}`);
      console.log(`Stripe webhook subscriptions evidence written to ${process.env.STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}
