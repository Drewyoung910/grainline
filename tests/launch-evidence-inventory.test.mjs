import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  MACHINE_ARTIFACTS,
  MANUAL_EVIDENCE_ITEMS,
  evaluateMachineArtifact,
  evaluateManualEvidence,
  parseConfig,
  redact,
} from "../scripts/launch-evidence-inventory.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("launch evidence inventory", () => {
  it("exposes a final launch evidence inventory command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/launch-evidence-inventory.mjs");

    assert.equal(pkg.scripts["audit:launch-evidence"], "node scripts/launch-evidence-inventory.mjs");
    assert.match(script, /const CONFIRMATION_VALUE = "local-read"/);
    assert.match(script, /LAUNCH_EVIDENCE_INVENTORY_CONFIRM/);
    assert.match(script, /LAUNCH_EVIDENCE_INVENTORY_PATH/);
    assert.match(script, /LAUNCH_EVIDENCE_MANIFEST_PATH/);
    assert.match(script, /LAUNCH_EVIDENCE_REQUIRE_CONDITIONAL/);
    assert.match(script, /writeInventory\(config, inventory\)/);
  });

  it("requires confirmation and keeps inventory paths inside the repository", () => {
    assert.throws(
      () => parseConfig({ LAUNCH_EVIDENCE_INVENTORY_PATH: "launch-evidence-inventory.json" }),
      /LAUNCH_EVIDENCE_INVENTORY_CONFIRM=local-read is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          LAUNCH_EVIDENCE_INVENTORY_CONFIRM: "local-read",
          LAUNCH_EVIDENCE_INVENTORY_PATH: "../launch-evidence-inventory.json",
        }),
      /LAUNCH_EVIDENCE_INVENTORY_PATH must stay inside the repository/,
    );
    assert.throws(
      () =>
        parseConfig({
          LAUNCH_EVIDENCE_DIR: "../evidence",
          LAUNCH_EVIDENCE_INVENTORY_CONFIRM: "local-read",
          LAUNCH_EVIDENCE_INVENTORY_PATH: "launch-evidence-inventory.json",
        }),
      /LAUNCH_EVIDENCE_DIR must stay inside the repository/,
    );

    const config = parseConfig({
      LAUNCH_EVIDENCE_DIR: ".codex/launch-evidence",
      LAUNCH_EVIDENCE_INVENTORY_CONFIRM: "local-read",
      LAUNCH_EVIDENCE_INVENTORY_PATH: ".codex/launch-evidence/inventory.json",
    });

    assert.ok(config.evidenceDir.endsWith("/grainline/.codex/launch-evidence"));
    assert.ok(config.inventoryPath.endsWith("/grainline/.codex/launch-evidence/inventory.json"));
    assert.ok(config.manifestPath.endsWith("/grainline/.codex/launch-evidence/launch-evidence-manifest.json"));
    assert.equal(config.requireConditional, false);
  });

  it("tracks the required machine artifacts for near-finished launch blockers", () => {
    const requiredIds = MACHINE_ARTIFACTS
      .filter((artifact) => artifact.requiredFor === "launch")
      .map((artifact) => artifact.id);
    const conditionalIds = MACHINE_ARTIFACTS
      .filter((artifact) => artifact.requiredFor === "conditional")
      .map((artifact) => artifact.id);

    for (const id of [
      "stripe-webhook-subscriptions",
      "stripe-money-movement",
      "buyer-deletion-replay",
      "r2-upload-smoke",
      "deployed-security-headers",
      "sentry-cron-alerts",
      "shipping-currency-drift",
    ]) {
      assert.ok(requiredIds.includes(id), `${id} should be a launch-required machine artifact`);
    }

    assert.deepEqual(conditionalIds.sort(), ["founding-maker-concurrency", "rls-context-gate"].sort());
  });

  it("validates machine artifact status, checks, scenarios, and proof-specific fields", () => {
    const stripeMoney = MACHINE_ARTIFACTS.find((artifact) => artifact.id === "stripe-money-movement");
    const buyerReplay = MACHINE_ARTIFACTS.find((artifact) => artifact.id === "buyer-deletion-replay");
    const r2 = MACHINE_ARTIFACTS.find((artifact) => artifact.id === "r2-upload-smoke");

    assert.deepEqual(
      evaluateMachineArtifact(stripeMoney, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        stripe: { mode: "test" },
        scenarios: stripeMoney.requiredScenarios.map((scenario) => ({ scenario })),
      }),
      [],
    );
    assert.match(
      evaluateMachineArtifact(stripeMoney, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        stripe: { mode: "live" },
        scenarios: [],
      }).join("; "),
      /missing scenario full_reverse_transfer_refund/,
    );
    assert.match(
      evaluateMachineArtifact(stripeMoney, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        stripe: { mode: "live" },
        scenarios: [],
      }).join("; "),
      /stripe\.mode must be test/,
    );

    assert.deepEqual(
      evaluateMachineArtifact(buyerReplay, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        stripe: { mode: "test" },
        proof: {
          evidence: { webhookEventProcessed: true },
          order: { buyerDataPurged: true, buyerDetached: true, refundRecorded: true },
        },
      }),
      [],
    );
    assert.match(
      evaluateMachineArtifact(buyerReplay, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        stripe: { mode: "test" },
        proof: { evidence: {}, order: {} },
      }).join("; "),
      /buyerDetached must be true/,
    );

    assert.deepEqual(
      evaluateMachineArtifact(r2, {
        status: "passed",
        generatedAt: "2026-07-11T00:00:00.000Z",
        commitSha: "abc123",
        issues: [],
        checks: r2.requiredCheckNames.map((name) => ({ name })),
      }),
      [],
    );
  });

  it("tracks manual dashboard, provider, and legal launch evidence separately from source checks", () => {
    const requiredIds = MANUAL_EVIDENCE_ITEMS
      .filter((item) => item.requiredFor === "launch")
      .map((item) => item.id);

    for (const id of [
      "securityheaders-scan",
      "ssl-labs-scan",
      "hsts-preload-status",
      "clerk-security-controls",
      "stripe-signing-secret-matching",
      "stripe-pci-saq-a",
      "cloudflare-r2-dashboard-posture",
      "sentry-notification-delivery",
      "google-search-console",
      "attorney-terms-privacy",
      "money-transmitter-analysis",
    ]) {
      assert.ok(requiredIds.includes(id), `${id} should be a launch-required manual evidence item`);
    }

    const item = MANUAL_EVIDENCE_ITEMS.find((candidate) => candidate.id === "clerk-security-controls");
    assert.deepEqual(
      evaluateManualEvidence(item, {
        capturedAt: "2026-07-11",
        reference: "Clerk dashboard screenshot retained in launch folder",
        status: "retained",
      }),
      [],
    );
    assert.match(evaluateManualEvidence(item, null).join("; "), /manual evidence missing/);
    assert.match(evaluateManualEvidence(item, { status: "retained" }).join("; "), /reference is required/);
    assert.deepEqual(
      evaluateManualEvidence(item, {
        reason: "Control unavailable on current provider plan; exception retained with legal sign-off.",
        status: "not_applicable",
      }),
      [],
    );
  });

  it("redacts accidental credential-shaped manual evidence text", () => {
    const serialized = redact(
      'STRIPE_SECRET_KEY="sk_live_secret" Bearer token-value https://user:pass@example.test whsec_secret',
    );

    assert.match(serialized, /\[redacted-secret-assignment\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.match(serialized, /https:\/\/\[redacted-credentials\]@example\.test/);
    assert.match(serialized, /\[redacted-stripe-secret\]/);
    assert.doesNotMatch(serialized, /sk_live_secret|token-value|user:pass|whsec_secret/);
  });

  it("documents the inventory without claiming launch evidence is complete", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:launch-evidence/);
    assert.match(runbook, /Pre-launch launch evidence inventory/);
    assert.match(backlog, /launch evidence inventory/);
    assert.match(claude, /Do not claim launch evidence is complete/);
  });
});
