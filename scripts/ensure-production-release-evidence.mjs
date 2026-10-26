#!/usr/bin/env node

import assert from "node:assert/strict";
import { lstatSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PREFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MIGRATION = /^[0-9]{14}_[a-z0-9_]+$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;

export function ensureProductionReleaseEvidence({
  prefix,
  migration,
  env = process.env,
} = {}) {
  assert.match(prefix ?? "", PREFIX, "evidence prefix is invalid");
  assert.match(migration ?? "", MIGRATION, "evidence migration is invalid");
  assert.ok(env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  assert.match(
    env.PRODUCTION_MIGRATION_RELEASE_COMMIT ?? "",
    COMMIT,
    "release commit is invalid",
  );
  assert.match(env.GITHUB_RUN_ID ?? "", RUN_ID, "run id is invalid");
  assert.ok(
    ["success", "failure", "cancelled"].includes(env.RELEASE_JOB_STATUS),
    "job status is invalid",
  );

  const existing = readdirSync(env.RUNNER_TEMP).filter(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith(".json"),
  );
  if (existing.length > 0) {
    for (const name of existing) {
      const metadata = lstatSync(path.join(env.RUNNER_TEMP, name));
      assert.equal(metadata.isFile(), true, "existing evidence is not a regular file");
      assert.equal(
        metadata.mode & 0o077,
        0,
        "existing evidence is readable outside its owner",
      );
    }
    return Object.freeze({ created: false, path: null });
  }

  const evidencePath = path.join(
    env.RUNNER_TEMP,
    `${prefix}-early-failure-${env.GITHUB_RUN_ID}.json`,
  );
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        status: "stopped_before_release_evidence",
        jobStatus: env.RELEASE_JOB_STATUS,
        migration,
        releaseCommit: env.PRODUCTION_MIGRATION_RELEASE_COMMIT,
        runId: env.GITHUB_RUN_ID,
        containsRowData: false,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  return Object.freeze({ created: true, path: evidencePath });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  ensureProductionReleaseEvidence({
    prefix: process.argv[2],
    migration: process.argv[3],
  });
}
