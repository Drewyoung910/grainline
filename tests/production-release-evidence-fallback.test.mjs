import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureProductionReleaseEvidence } from "../scripts/ensure-production-release-evidence.mjs";

function environment(directory, overrides = {}) {
  return {
    RUNNER_TEMP: directory,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "a".repeat(40),
    GITHUB_RUN_ID: "12345",
    RELEASE_JOB_STATUS: "failure",
    ...overrides,
  };
}

test("fallback creates one sanitized mode-0600 artifact after an early stop", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  const result = ensureProductionReleaseEvidence({
    prefix: "email-delivery-ledger-preparation",
    migration: "20261025010000_prepare_email_delivery_ledger",
    env: environment(directory),
  });
  assert.equal(result.created, true);
  assert.equal(statSync(result.path).mode & 0o777, 0o600);
  const evidence = JSON.parse(readFileSync(result.path, "utf8"));
  assert.deepEqual(evidence, {
    status: "stopped_before_release_evidence",
    jobStatus: "failure",
    migration: "20261025010000_prepare_email_delivery_ledger",
    releaseCommit: "a".repeat(40),
    runId: "12345",
    containsRowData: false,
  });
});

test("fallback leaves existing sanitized evidence untouched", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  const existing = path.join(
    directory,
    "email-provider-deletion-fence-preflight.json",
  );
  writeFileSync(existing, "{}", { mode: 0o600 });
  const result = ensureProductionReleaseEvidence({
    prefix: "email-provider-deletion-fence",
    migration: "20261025020000_fence_email_provider_and_account_deletion",
    env: environment(directory),
  });
  assert.deepEqual(result, { created: false, path: null });
  assert.equal(readFileSync(existing, "utf8"), "{}");
});

test("fallback rejects evidence with loose permissions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  writeFileSync(
    path.join(directory, "email-provider-deletion-fence-preflight.json"),
    "{}",
    { mode: 0o644 },
  );
  assert.throws(
    () => ensureProductionReleaseEvidence({
      prefix: "email-provider-deletion-fence",
      migration: "20261025020000_fence_email_provider_and_account_deletion",
      env: environment(directory),
    }),
    /readable outside its owner/u,
  );
});

test("fallback rejects untrusted artifact inputs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  const valid = {
    prefix: "email-delivery-ledger-preparation",
    migration: "20261025010000_prepare_email_delivery_ledger",
    env: environment(directory),
  };
  assert.throws(() => ensureProductionReleaseEvidence({ ...valid, prefix: "../bad" }));
  assert.throws(() => ensureProductionReleaseEvidence({ ...valid, migration: "bad" }));
  assert.throws(() => ensureProductionReleaseEvidence({
    ...valid,
    env: environment(directory, {
      PRODUCTION_MIGRATION_RELEASE_COMMIT: "bad",
    }),
  }));
  assert.throws(() => ensureProductionReleaseEvidence({
    ...valid,
    env: environment(directory, { GITHUB_RUN_ID: "0" }),
  }));
  assert.throws(() => ensureProductionReleaseEvidence({
    ...valid,
    env: environment(directory, { RELEASE_JOB_STATUS: "skipped" }),
  }));
});
