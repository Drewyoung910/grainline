#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  privateTableRlsActivation,
} from "./private-table-rls-activation-catalog.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function readEvidence(directory, name) {
  const filePath = path.join(directory, name);
  const state = lstatSync(filePath);
  assert.equal(state.isFile(), true, `${name} is not a regular file`);
  assert.equal(state.isSymbolicLink(), false, `${name} is a symbolic link`);
  assert.ok(state.size > 0 && state.size <= MAX_EVIDENCE_BYTES, `${name} size drifted`);
  const bytes = readFileSync(filePath);
  return Object.freeze({
    value: JSON.parse(bytes.toString("utf8")),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function verifyEvidence(value, {
  phase,
  releaseId,
  releaseCommit,
  migration,
  migrationSha256,
  table,
}) {
  assert.equal(value.releaseId, releaseId, `${phase} release id drifted`);
  assert.equal(value.releaseCommit, releaseCommit, `${phase} release commit drifted`);
  assert.equal(value.phase, phase, `${phase} phase drifted`);
  assert.equal(value.migration, migration, `${phase} migration drifted`);
  assert.equal(value.migrationSha256, migrationSha256, `${phase} checksum drifted`);
  assert.equal(value.table, table, `${phase} table drifted`);
  assert.equal(value.productionChanged, false, `${phase} evidence claims a mutation`);
  assert.equal(value.containsRowData, false, `${phase} evidence contains row data`);
  assert.equal(typeof value.databaseName, "string", `${phase} database name is absent`);
  assert.equal(typeof value.migrationRole, "string", `${phase} migration role is absent`);
  assert.equal(typeof value.posture, "object", `${phase} posture is absent`);
  assert.notEqual(value.posture, null, `${phase} posture is null`);
}

export function verifyAcceptedPrivateTablePreparationEvidence({
  directory,
  releaseId,
  preparationCommit,
}) {
  assert.equal(path.isAbsolute(directory), true, "evidence directory must be absolute");
  assert.match(preparationCommit, COMMIT, "preparation commit is invalid");
  const activation = privateTableRlsActivation(releaseId);
  const expectedNames = ["preflight", "postflight"].map(
    (phase) => `private-table-preparation-${preparationCommit}-${phase}.json`,
  );
  const actualNames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualNames, [...expectedNames].sort(), "preparation evidence files drifted");
  const preflight = readEvidence(directory, expectedNames[0]);
  const postflight = readEvidence(directory, expectedNames[1]);
  const expectation = {
    releaseId: activation.preparationReleaseId,
    releaseCommit: preparationCommit,
    migration: activation.preparation.migration,
    migrationSha256: activation.preparation.migrationSha256,
    table: activation.table,
  };
  verifyEvidence(preflight.value, { ...expectation, phase: "preflight" });
  verifyEvidence(postflight.value, { ...expectation, phase: "postflight" });
  assert.ok(
    ["pending", "applied"].includes(preflight.value.state),
    "preflight preparation state drifted",
  );
  assert.equal(postflight.value.state, "applied", "preparation was not applied");
  assert.equal(
    preflight.value.databaseName,
    postflight.value.databaseName,
    "preparation database changed",
  );
  assert.equal(
    preflight.value.migrationRole,
    postflight.value.migrationRole,
    "preparation migration role changed",
  );
  assert.deepEqual(
    preflight.value.posture,
    postflight.value.posture,
    "preparation changed predecessor table posture",
  );
  return Object.freeze({
    releaseId,
    preparationReleaseId: activation.preparationReleaseId,
    preparationCommit,
    migration: activation.preparation.migration,
    migrationSha256: activation.preparation.migrationSha256,
    table: activation.table,
    preflightState: preflight.value.state,
    postflightState: postflight.value.state,
    preflightEvidenceSha256: preflight.sha256,
    postflightEvidenceSha256: postflight.sha256,
    productionChanged: false,
    containsRowData: false,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = verifyAcceptedPrivateTablePreparationEvidence({
      directory: required(process.env, "PRIVATE_TABLE_PREPARATION_ACCEPTED_EVIDENCE_DIRECTORY"),
      releaseId: required(process.env, "PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID"),
      preparationCommit: required(process.env, "PRIVATE_TABLE_PREPARATION_ACCEPTED_COMMIT"),
    });
    const outputPath = required(
      process.env,
      "PRIVATE_TABLE_PREPARATION_BINDING_EVIDENCE_PATH",
    );
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    process.stdout.write(`${result.preparationReleaseId}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
