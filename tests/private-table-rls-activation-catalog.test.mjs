import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
  privateTableRlsActivation,
  privateTableRlsActivationReleaseIds,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "maker_verification_v1";
const release = privateTableRlsActivation(releaseId);
const verified = verifyPrivateTableRlsActivationSource(releaseId);

test("catalog byte-seals the combined policyless activation and rollback", () => {
  assert.equal(
    PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
    "activate-reviewed-private-table-rls",
  );
  assert.equal(release.table, "MakerVerification");
  assert.equal(
    release.minimumCompatibleAppCommit,
    "0c0e9e67081c2ad7b27d97bc3f5956ecd2090549",
  );
  assert.equal(release.preparation.table, release.table);
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.throws(
    () => verifyPrivateTableRlsActivationSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
});

test("catalog orders and byte-seals the owner social verification activation batch", () => {
  const releaseIds = privateTableRlsActivationReleaseIds(
    "owner_social_verification_v1",
  );
  assert.deepEqual(releaseIds, [
    "favorite_v1",
    "follow_v1",
    "review_vote_v1",
    "maker_verification_v1",
  ]);
  const releases = releaseIds.map((id) => privateTableRlsActivation(id));
  assert.deepEqual(releases.map((entry) => entry.table), [
    "Favorite",
    "Follow",
    "ReviewVote",
    "MakerVerification",
  ]);
  assert.deepEqual(releases.map((entry) => entry.policies.length), [2, 0, 1, 0]);
  assert.deepEqual(releases.map((entry) => entry.activatedRuntimePrivileges), [
    ["SELECT", "DELETE"],
    [],
    ["SELECT"],
    [],
  ]);
  for (const id of releaseIds) {
    const entry = verifyPrivateTableRlsActivationSource(id);
    assert.equal(entry.migrationDigest, entry.release.migrationSha256);
    assert.equal(entry.rollbackDigest, entry.release.rollbackSha256);
  }
});

test("catalog binds all prepared operations into the activation preflight", () => {
  const activation = readFileSync(verified.migrationPath, "utf8");
  assert.equal(release.preparation.functions.length, 13);
  for (const entry of release.preparation.functions) {
    const argumentsLiteral = entry.arguments.replace(/,\s+/gu, ",");
    assert.match(
      activation,
      new RegExp(
        `'public\\.${entry.name}\\(${argumentsLiteral.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\)'::pg_catalog\\.regprocedure`,
        "u",
      ),
    );
  }
  assert.match(activation, /current_user <> session_user/u);
  assert.match(activation, /role_state\.rolinherit/u);
  assert.match(activation, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
});

test("activation and rollback retain one-table, no-policy boundaries", () => {
  const activation = readFileSync(verified.migrationPath, "utf8");
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  assert.deepEqual(
    [...activation.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/gu)]
      .map((match) => match[1]),
    ["MakerVerification", "MakerVerification", "MakerVerification"],
  );
  assert.deepEqual(
    [...rollback.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/gu)]
      .map((match) => match[1]),
    ["MakerVerification", "MakerVerification", "MakerVerification"],
  );
  assert.doesNotMatch(activation, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(rollback, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(activation, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("catalog verifies isolated migration candidates through generic path overrides", () => {
  const isolatedRoot = mkdtempSync(
    path.join(tmpdir(), "grainline-private-table-activation-"),
  );
  const rollbackPath = path.join(isolatedRoot, release.rollbackPath);
  const previousPreparationPath =
    process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH;
  const previousActivationPath =
    process.env.PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH;

  try {
    mkdirSync(path.dirname(rollbackPath), { recursive: true });
    copyFileSync(verified.rollbackPath, rollbackPath);
    process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH =
      verified.preparation.migrationPath;
    process.env.PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH =
      verified.migrationPath;

    const isolated = verifyPrivateTableRlsActivationSource(
      releaseId,
      isolatedRoot,
    );
    assert.equal(
      isolated.preparation.migrationPath,
      verified.preparation.migrationPath,
    );
    assert.equal(isolated.migrationPath, verified.migrationPath);
  } finally {
    if (previousPreparationPath === undefined) {
      delete process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH;
    } else {
      process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH =
        previousPreparationPath;
    }
    if (previousActivationPath === undefined) {
      delete process.env.PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH;
    } else {
      process.env.PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH =
        previousActivationPath;
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
