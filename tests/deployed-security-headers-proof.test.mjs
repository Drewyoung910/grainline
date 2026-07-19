import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEvidencePayload,
  parseConfig,
} from "../scripts/deployed-security-headers-proof.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

function source(path) {
  return readFileSync(path, "utf8");
}

describe("deployed security headers proof harness", () => {
  it("is wired as a confirm-gated launch evidence command", () => {
    const pkg = JSON.parse(source("package.json"));
    const script = source("scripts/deployed-security-headers-proof.mjs");

    assert.equal(pkg.scripts["audit:deployed-headers"], "node scripts/deployed-security-headers-proof.mjs");
    assert.match(script, /DEPLOYED_HEADERS_PROOF_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /const CONFIRMATION_VALUE = "production-read"/);
    assert.match(script, /DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH/);
    assert.match(script, /DEPLOYED_HEADERS_PROOF_URL must be HTTPS/);
    assert.match(script, /REQUIRED_HOST = "thegrainline\.com"/);
    assert.match(script, /DEPLOYED_HEADERS_PROOF_ALLOW_CUSTOM_HOST=1/);
  });

  it("requires production confirmation, HTTPS, the production host, and in-repo evidence paths", () => {
    assert.throws(
      () => parseConfig({ DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH: "headers.json" }),
      /DEPLOYED_HEADERS_PROOF_CONFIRM=production-read is required/,
    );
    assert.throws(
      () =>
        parseConfig({
          DEPLOYED_HEADERS_PROOF_CONFIRM: "production-read",
          DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH: "headers.json",
          DEPLOYED_HEADERS_PROOF_URL: "http://thegrainline.com",
        }),
      /must be HTTPS/,
    );
    assert.throws(
      () =>
        parseConfig({
          DEPLOYED_HEADERS_PROOF_CONFIRM: "production-read",
          DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH: "headers.json",
          DEPLOYED_HEADERS_PROOF_URL: "https://example.com",
        }),
      /must target thegrainline\.com/,
    );
    assert.throws(
      () =>
        parseConfig({
          DEPLOYED_HEADERS_PROOF_CONFIRM: "production-read",
          DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH: "../headers.json",
        }),
      /must stay inside the repository/,
    );

    const config = parseConfig({
      DEPLOYED_HEADERS_PROOF_CONFIRM: "production-read",
      DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH: "headers.json",
    });

    assert.equal(config.url.origin, "https://thegrainline.com");
    assert.equal(config.url.pathname, "/");
    assert.equal(config.evidencePath, resolve(REPOSITORY_ROOT, "headers.json"));
  });

  it("checks the deployed root headers and health-cache headers that launch evidence depends on", () => {
    const script = source("scripts/deployed-security-headers-proof.mjs");

    for (const required of [
      "x-dns-prefetch-control",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "permissions-policy",
      "reporting-endpoints",
      "strict-transport-security",
      "content-security-policy",
      "content-security-policy-report-only",
      "x-powered-by",
      "includeSubDomains",
      "preload directive",
      "unsafe-eval",
      "/api/health",
      "cache-control",
      "private",
      "no-store",
      "max-age=0",
      "authorization",
      "x-health-check-token",
      "httpStatus",
    ]) {
      assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }

    assert.match(script, /root responded with HTTP/);
    assert.match(script, /\/api\/health responded with HTTP/);
    assert.match(script, /body\?\.ok !== true/);
  });

  it("keeps external scanners and HSTS preload status separate from the local proof", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:deployed-headers/);
    assert.match(launch, /securityheaders\.com/);
    assert.match(launch, /SSL Labs/);
    assert.match(launch, /hstspreload\.org/);
    assert.match(runbook, /does not replace securityheaders\.com, SSL Labs, or\s+hstspreload\.org evidence/);
    assert.match(backlog, /`npm run audit:deployed-headers`/);
    assert.match(backlog, /securityheaders\.com, SSL Labs, and hstspreload\.org/);
    assert.match(claude, /Do not close deployed-header or HSTS-preload items from source review alone/);
  });

  it("redacts sensitive proof inputs from retained evidence issues", () => {
    const payload = buildEvidencePayload({
      checks: [],
      config: { url: new URL("https://thegrainline.com") },
      issues: [
        'DEPLOYED_HEADERS_PROOF_URL="https://user:secret@thegrainline.com"',
        "Authorization: Bearer secret-token-value",
      ],
      startedAt: "2026-07-10T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:01.000Z",
      status: "failed",
    });
    const serialized = JSON.stringify(payload);

    assert.match(serialized, /\[redacted-header-proof-env\]/);
    assert.match(serialized, /Bearer \[redacted-token\]/);
    assert.doesNotMatch(serialized, /secret-token-value/);
    assert.doesNotMatch(serialized, /user:secret/);
  });
});
