import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEvidencePayload,
  parseConfig,
} from "../scripts/stripe-webhook-subscriptions-proof.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Stripe webhook subscriptions proof harness", () => {
  it("is wired as an explicit confirm-gated launch evidence command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/stripe-webhook-subscriptions-proof.mjs");

    assert.equal(pkg.scripts["audit:stripe-webhooks"], "node scripts/stripe-webhook-subscriptions-proof.mjs");
    assert.match(script, /const CONFIRMATION_VALUE = "live-read"/);
    assert.match(script, /STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH/);
    assert.match(script, /STRIPE_SECRET_KEY must be a live sk_live_ key for launch evidence/);
    assert.match(script, /REQUIRED_HOST = "thegrainline\.com"/);
  });

  it("requires live confirmation, HTTPS production URL, live key, and in-repo evidence path", () => {
    assert.throws(
      () => parseConfig({ STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json" }),
      /STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM=live-read is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL: "http://thegrainline.com",
          STRIPE_SECRET_KEY: "sk_live_test",
        }),
      /must be HTTPS/,
    );
    assert.throws(
      () =>
        parseConfig({
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_APP_URL: "https://example.com",
          STRIPE_SECRET_KEY: "sk_live_test",
        }),
      /must target thegrainline\.com/,
    );
    assert.throws(
      () =>
        parseConfig({
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "../stripe-webhooks.json",
          STRIPE_SECRET_KEY: "sk_live_test",
        }),
      /must stay inside the repository/,
    );
    assert.throws(
      () =>
        parseConfig({
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
          STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json",
          STRIPE_SECRET_KEY: "sk_test_test",
        }),
      /must be a live sk_live_/,
    );

    const config = parseConfig({
      STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
      STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json",
      STRIPE_SECRET_KEY: "sk_live_test",
    });

    assert.equal(config.appUrl.origin, "https://thegrainline.com");
    assert.equal(config.mode, "live");
    assert.equal(
      config.evidencePath,
      resolve(REPOSITORY_ROOT, "stripe-webhooks.json"),
    );

    const dryRun = parseConfig({
      STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_CONFIRM: "live-read",
      STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_EVIDENCE_PATH: "stripe-webhooks.json",
      STRIPE_SECRET_KEY: "sk_test_test",
      STRIPE_WEBHOOK_SUBSCRIPTIONS_PROOF_ALLOW_TEST_MODE: "1",
    });
    assert.equal(dryRun.mode, "test-dry-run");
  });

  it("checks the exact snapshot event set and fails on over-subscription", () => {
    const script = source("scripts/stripe-webhook-subscriptions-proof.mjs");

    for (const eventType of [
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
    ]) {
      assert.match(script, new RegExp(eventType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.match(script, /assertExactSnapshotEvents/);
    assert.match(script, /snapshot webhook endpoint subscribes to wildcard events/);
    assert.match(script, /snapshot webhook events mismatch/);
    assert.match(script, /missing=\$\{diff\.missing\.join/);
    assert.match(script, /extra=\$\{diff\.extra\.join/);
    assert.doesNotMatch(script, /payment_intent\.\*/);
  });

  it("uses the v2 event destination API for Connect thin account notifications", () => {
    const script = source("scripts/stripe-webhook-subscriptions-proof.mjs");

    assert.match(script, /stripe\.webhookEndpoints\.list/);
    assert.match(script, /stripe\.v2\.core\.eventDestinations\.list/);
    assert.match(script, /include: \["webhook_endpoint\.url"\]/);
    assert.match(script, /destination\.event_payload !== "thin"/);
    assert.match(script, /CONNECT_V2_ACCOUNT_EVENT_PREFIX = "v2\.core\.account"/);
    assert.ok(script.includes('event.startsWith(`${CONNECT_V2_ACCOUNT_EVENT_PREFIX}.`)'));
    assert.ok(script.includes('event.startsWith(`${CONNECT_V2_ACCOUNT_EVENT_PREFIX}[`)'));
    assert.match(script, /Connect v2 event destination has non-account events/);
    assert.match(script, /Connect v2 event destination subscribes to wildcard events/);
  });

  it("keeps signing-secret matching as separate provider/deploy evidence", () => {
    const script = source("scripts/stripe-webhook-subscriptions-proof.mjs");
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");

    assert.match(script, /Stripe does not return webhook signing secrets after creation/);
    assert.match(launch, /npm run audit:stripe-webhooks/);
    assert.match(launch, /separate signing-secret matching evidence/);
    assert.match(runbook, /does not prove deployed `STRIPE_WEBHOOK_SECRET` or\s+`STRIPE_V2_WEBHOOK_SECRET` values/);
    assert.match(backlog, /`npm run audit:stripe-webhooks`/);
  });

  it("redacts retained evidence issues", () => {
    const payload = buildEvidencePayload({
      checks: [],
      config: { appUrl: new URL("https://thegrainline.com"), mode: "live" },
      issues: [
        'STRIPE_SECRET_KEY="sk_live_secret"',
        "STRIPE_WEBHOOK_SECRET=whsec_secret",
        "Authorization: Bearer secret-token-value",
        "https://user:secret@api.stripe.com/v1/webhook_endpoints",
      ],
      startedAt: "2026-07-10T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:01.000Z",
      status: "failed",
    });
    const serialized = JSON.stringify(payload);

    assert.match(serialized, /\[redacted-stripe-webhook-proof-env\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.doesNotMatch(serialized, /sk_live_secret/);
    assert.doesNotMatch(serialized, /whsec_secret/);
    assert.doesNotMatch(serialized, /secret-token-value/);
    assert.doesNotMatch(serialized, /user:secret/);
  });
});
