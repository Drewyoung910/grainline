import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildEvidencePayload,
  cronInventoryFromVercel,
  parseConfig,
} from "../scripts/sentry-cron-alert-proof.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Sentry cron alert proof harness", () => {
  it("is wired as an explicit read-only provider evidence command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/sentry-cron-alert-proof.mjs");

    assert.equal(pkg.scripts["audit:sentry-crons"], "node scripts/sentry-cron-alert-proof.mjs");
    assert.match(script, /const CONFIRMATION_VALUE = "live-read"/);
    assert.match(script, /SENTRY_CRON_PROOF_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /SENTRY_AUTH_TOKEN/);
    assert.match(script, /SENTRY_ORG_SLUG/);
    assert.match(script, /SENTRY_PROJECT_SLUG/);
    assert.match(script, /SENTRY_CRON_PROOF_EVIDENCE_PATH/);
  });

  it("requires live confirmation, HTTPS Sentry base URL, and in-repo evidence paths", () => {
    assert.throws(
      () => parseConfig({ SENTRY_CRON_PROOF_EVIDENCE_PATH: "sentry.json" }),
      /SENTRY_CRON_PROOF_CONFIRM=live-read is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          SENTRY_AUTH_TOKEN: "token",
          SENTRY_CRON_PROOF_BASE_URL: "http://sentry.example.com",
          SENTRY_CRON_PROOF_CONFIRM: "live-read",
          SENTRY_CRON_PROOF_EVIDENCE_PATH: "sentry.json",
          SENTRY_ORG_SLUG: "grainline",
          SENTRY_PROJECT_SLUG: "grainline",
        }),
      /must be HTTPS/,
    );
    assert.throws(
      () =>
        parseConfig({
          SENTRY_AUTH_TOKEN: "token",
          SENTRY_CRON_PROOF_CONFIRM: "live-read",
          SENTRY_CRON_PROOF_EVIDENCE_PATH: "../sentry.json",
          SENTRY_ORG_SLUG: "grainline",
          SENTRY_PROJECT_SLUG: "grainline",
        }),
      /must stay inside the repository/,
    );

    const config = parseConfig({
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_CRON_PROOF_CONFIRM: "live-read",
      SENTRY_CRON_PROOF_EVIDENCE_PATH: "sentry.json",
      SENTRY_ORG_SLUG: "grainline",
      SENTRY_PROJECT_SLUG: "grainline",
    });

    assert.equal(config.baseUrl.origin, "https://sentry.io");
    assert.deepEqual(config.requiredAlertTerms, [
      "cron_ops_health",
      "AccountDeletionSideEffect",
      "direct-upload",
      "webhook failure spike",
      "CSP",
    ]);
    assert.ok(config.evidencePath.endsWith("/grainline/sentry.json"));
  });

  it("derives the expected Sentry monitor inventory from every Vercel cron", () => {
    const vercel = JSON.parse(source("vercel.json"));
    const inventory = cronInventoryFromVercel();

    assert.equal(inventory.length, vercel.crons.length);
    for (const { path, schedule } of vercel.crons) {
      const expectedSlug = path.split("/").at(-1);
      assert.ok(
        inventory.some((cron) => cron.path === path && cron.schedule === schedule && cron.monitorSlug === expectedSlug),
        `${path} should be represented in the proof inventory`,
      );
    }
  });

  it("queries current Sentry monitor and alert-routing provider APIs", () => {
    const script = source("scripts/sentry-cron-alert-proof.mjs");

    assert.match(script, /\/api\/0\/organizations\/\$\{encodeURIComponent\(config\.orgSlug\)\}\/monitors\//);
    assert.match(script, /\/api\/0\/organizations\/\$\{encodeURIComponent\(config\.orgSlug\)\}\/workflows\//);
    assert.match(script, /\/api\/0\/organizations\/\$\{encodeURIComponent\(config\.orgSlug\)\}\/detectors\//);
    assert.match(script, /\/api\/0\/projects\/\$\{encodeURIComponent\(config\.orgSlug\)\}\/\$\{encodeURIComponent\(config\.projectSlug\)\}\/rules\//);
    assert.match(script, /Authorization: `Bearer \$\{config\.authToken\}`/);
    assert.match(script, /parseNextLink/);
    assert.match(script, /MAX_SENTRY_PAGES/);
  });

  it("fails when monitor schedules, alert actions, or launch alert terms are missing", () => {
    const script = source("scripts/sentry-cron-alert-proof.mjs");

    assert.match(script, /Missing enabled Sentry cron monitor/);
    assert.match(script, /Multiple enabled Sentry cron monitors match/);
    assert.match(script, /did not expose a crontab schedule/);
    assert.match(script, /schedule was \$\{schedule\}, expected \$\{expected\.schedule\}/);
    assert.match(script, /No enabled Sentry workflow, detector, or issue alert rule exposes notification routing/);
    assert.match(script, /Sentry alert routing evidence missing launch terms/);
    assert.match(script, /DEFAULT_REQUIRED_ALERT_TERMS/);
  });

  it("keeps provider proof caveats and docs aligned", () => {
    const script = source("scripts/sentry-cron-alert-proof.mjs");
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(script, /does not replace dashboard screenshots or exported evidence for actual notification delivery tests/);
    assert.match(launch, /npm run audit:sentry-crons/);
    assert.match(runbook, /npm run audit:sentry-crons/);
    assert.match(backlog, /`npm run audit:sentry-crons`/);
    assert.match(claude, /Sentry cron alert proof behavior/);
  });

  it("redacts retained evidence issues", () => {
    const payload = buildEvidencePayload({
      checks: [],
      config: { baseUrl: new URL("https://sentry.io"), orgSlug: "grainline", projectSlug: "grainline" },
      issues: [
        'SENTRY_AUTH_TOKEN="sntrys_secret"',
        "Authorization: Bearer secret-token-value",
        "https://public@o123.ingest.sentry.io/456",
        "https://user:secret@sentry.io/api/0/projects",
      ],
      startedAt: "2026-07-10T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:01.000Z",
      status: "failed",
    });
    const serialized = JSON.stringify(payload);

    assert.match(serialized, /\[redacted-sentry-proof-env\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.match(serialized, /https:\/\/\[redacted-sentry-dsn\]/);
    assert.doesNotMatch(serialized, /secret-token-value/);
    assert.doesNotMatch(serialized, /user:secret/);
  });
});
