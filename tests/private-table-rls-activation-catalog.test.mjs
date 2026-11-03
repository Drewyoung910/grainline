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
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  PRIVATE_TABLE_RLS_ACTIVATIONS,
  PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
  privateTablePreparationMigrationOverride,
  privateTableRlsActivation,
  privateTableRlsActivationMigrationOverride,
  privateTableRlsActivationReleaseIds,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "maker_verification_v1";
const release = privateTableRlsActivation(releaseId);
const verified = verifyPrivateTableRlsActivationSource(releaseId);

test("every compatible app pin resolves and is an ancestor of this release head", () => {
  for (const [id, entry] of Object.entries(PRIVATE_TABLE_RLS_ACTIVATIONS)) {
    const resolved = spawnSync(
      "git",
      ["cat-file", "-e", `${entry.minimumCompatibleAppCommit}^{commit}`],
      { encoding: "utf8" },
    );
    assert.equal(
      resolved.status,
      0,
      `${id} minimum compatible app commit does not resolve: ${resolved.stderr}`,
    );

    const ancestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", entry.minimumCompatibleAppCommit, "HEAD"],
      { encoding: "utf8" },
    );
    assert.equal(
      ancestor.status,
      0,
      `${id} minimum compatible app commit is not an ancestor of HEAD: ${ancestor.stderr}`,
    );
  }
});

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
  assert.deepEqual(releases[1]?.functionChanges.retained, [
    {
      name: "grainline_user_follower_notification_page",
      arguments: "text, text, integer",
      sourceMd5: "471b1caf9907d6d370ec1cb8ea5aa718",
      securityDefiner: true,
      predecessorExecuteRole: "runtime",
      activatedExecuteRole: "none",
    },
  ]);
  for (const id of releaseIds) {
    const entry = verifyPrivateTableRlsActivationSource(id);
    assert.equal(entry.migrationDigest, entry.release.migrationSha256);
    assert.equal(entry.rollbackDigest, entry.release.rollbackSha256);
  }
});

test("catalog byte-seals the policyless SellerBroadcast activation", () => {
  const broadcast = privateTableRlsActivation("seller_broadcast_v1");
  const source = verifyPrivateTableRlsActivationSource("seller_broadcast_v1");
  assert.equal(broadcast.table, "SellerBroadcast");
  assert.equal(broadcast.mode, "policyless_combined_enable_force");
  assert.equal(broadcast.preparation.functions.length, 15);
  assert.deepEqual(broadcast.policies, []);
  assert.deepEqual(broadcast.activatedRuntimePrivileges, []);
  assert.equal(source.migrationDigest, broadcast.migrationSha256);
  assert.equal(source.rollbackDigest, broadcast.rollbackSha256);
});

test("batch source verification prefers each release's staged paths", () => {
  const sourceByRelease = Object.fromEntries(
    privateTableRlsActivationReleaseIds("owner_social_verification_v1")
      .map((id) => [id, verifyPrivateTableRlsActivationSource(id)]),
  );
  const previous = new Map();
  const staged = {
    FAVORITE_PREPARATION_MIGRATION_PATH:
      sourceByRelease.favorite_v1.preparation.migrationPath,
    FAVORITE_RLS_ACTIVATION_MIGRATION_PATH:
      sourceByRelease.favorite_v1.migrationPath,
    FOLLOW_PREPARATION_MIGRATION_PATH:
      sourceByRelease.follow_v1.preparation.migrationPath,
    FOLLOW_RLS_ACTIVATION_MIGRATION_PATH:
      sourceByRelease.follow_v1.migrationPath,
    REVIEW_VOTE_PREPARATION_MIGRATION_PATH:
      sourceByRelease.review_vote_v1.preparation.migrationPath,
    REVIEW_VOTE_RLS_ACTIVATION_MIGRATION_PATH:
      sourceByRelease.review_vote_v1.migrationPath,
    MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH:
      sourceByRelease.maker_verification_v1.preparation.migrationPath,
    MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH:
      sourceByRelease.maker_verification_v1.migrationPath,
    PRIVATE_TABLE_PREPARATION_MIGRATION_PATH:
      sourceByRelease.maker_verification_v1.preparation.migrationPath,
    PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH:
      sourceByRelease.maker_verification_v1.migrationPath,
  };

  try {
    for (const [name, value] of Object.entries(staged)) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    for (const id of privateTableRlsActivationReleaseIds(
      "owner_social_verification_v1",
    )) {
      const entry = verifyPrivateTableRlsActivationSource(id);
      assert.equal(entry.migrationDigest, entry.release.migrationSha256);
      assert.equal(
        entry.preparation.digest,
        entry.preparation.release.migrationSha256,
      );
    }
    assert.equal(
      privateTablePreparationMigrationOverride("favorite_v1"),
      staged.FAVORITE_PREPARATION_MIGRATION_PATH,
    );
    assert.equal(
      privateTableRlsActivationMigrationOverride("review_vote_v1"),
      staged.REVIEW_VOTE_RLS_ACTIVATION_MIGRATION_PATH,
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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
  const previousMakerPreparationPath =
    process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH;
  const previousMakerActivationPath =
    process.env.MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH;

  try {
    mkdirSync(path.dirname(rollbackPath), { recursive: true });
    copyFileSync(verified.rollbackPath, rollbackPath);
    delete process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH;
    delete process.env.MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH;
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
    if (previousMakerPreparationPath === undefined) {
      delete process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH;
    } else {
      process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH =
        previousMakerPreparationPath;
    }
    if (previousMakerActivationPath === undefined) {
      delete process.env.MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH;
    } else {
      process.env.MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH =
        previousMakerActivationPath;
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
});
