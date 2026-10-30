import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
} from "../scripts/private-table-rls-activation-catalog.mjs";
import {
  verifyAcceptedPrivateTablePreparationEvidence,
} from "../scripts/private-table-preparation-evidence-verify.mjs";

const releaseId = "maker_verification_v1";
const release = privateTableRlsActivation(releaseId);
const commit = "a".repeat(40);

function posture() {
  return {
    rlsEnabled: false,
    rlsForced: false,
    policyCount: 0,
    runtimeSelect: true,
    runtimeInsert: true,
    runtimeUpdate: true,
    runtimeDelete: true,
    staffSelect: false,
    publicSelect: false,
  };
}

function evidence(phase, state, overrides = {}) {
  return {
    releaseId: release.preparationReleaseId,
    releaseCommit: commit,
    phase,
    state,
    migration: release.preparation.migration,
    migrationSha256: release.preparation.migrationSha256,
    databaseName: "grainline",
    migrationRole: "neondb_owner",
    table: release.table,
    posture: posture(),
    productionChanged: false,
    containsRowData: false,
    ...overrides,
  };
}

function writePair(directory, preflight = evidence("preflight", "pending"), postflight = evidence("postflight", "applied")) {
  for (const [phase, value] of [["preflight", preflight], ["postflight", postflight]]) {
    writeFileSync(
      join(
        directory,
        `private-table-preparation-${commit}-${release.preparationReleaseId}-${phase}.json`,
      ),
      `${JSON.stringify(value)}\n`,
    );
  }
}

test("verifier binds exact preparation evidence to the activation", () => {
  const directory = mkdtempSync(join(tmpdir(), "private-preparation-evidence-"));
  try {
    writePair(directory);
    const result = verifyAcceptedPrivateTablePreparationEvidence({
      directory,
      releaseId,
      preparationCommit: commit,
    });
    assert.equal(result.preparationReleaseId, release.preparationReleaseId);
    assert.equal(result.migration, release.preparation.migration);
    assert.equal(result.preflightState, "pending");
    assert.equal(result.postflightState, "applied");
    assert.match(result.preflightEvidenceSha256, /^[0-9a-f]{64}$/u);
    assert.equal(result.containsRowData, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("verifier rejects wrong releases, commits, and posture changes", () => {
  for (const mutate of [
    (directory) => writePair(
      directory,
      evidence("preflight", "pending", { releaseId: "support_request_v1" }),
    ),
    (directory) => writePair(
      directory,
      evidence("preflight", "pending"),
      evidence("postflight", "applied", {
        posture: { ...posture(), runtimeSelect: false },
      }),
    ),
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "private-preparation-reject-"));
    try {
      mutate(directory);
      assert.throws(() => verifyAcceptedPrivateTablePreparationEvidence({
        directory,
        releaseId,
        preparationCommit: commit,
      }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  assert.throws(() => verifyAcceptedPrivateTablePreparationEvidence({
    directory: join(tmpdir(), "absent-private-preparation-evidence"),
    releaseId,
    preparationCommit: "not-a-commit",
  }), /preparation commit is invalid/u);
});
