import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  NOTIFICATION_FORCE_RELEASE,
  verifyNotificationForceRelease,
} from "../scripts/verify-notification-force-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "notification-force-release-"));
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function writeRelease(migrations, release, contents) {
  const directory = path.join(migrations, release.migrationName);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "migration.sql"), contents);
}

describe("Notification FORCE release artifact", () => {
  const activation = readFileSync(
    `prisma/migrations/${NOTIFICATION_FORCE_RELEASE.activation.migrationName}/migration.sql`,
    "utf8",
  );
  const force = readFileSync(
    `prisma/migrations/${NOTIFICATION_FORCE_RELEASE.force.migrationName}/migration.sql`,
    "utf8",
  );

  it("pins the activation baseline and exact FORCE-only hardening bytes", () => {
    assert.deepEqual(verifyNotificationForceRelease(), {
      status: "passed",
      activationMigration: "20260722052000_enable_notification_rls",
      activationSha256: "f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92",
      forceMigration: "20260722053000_force_notification_rls",
      forceSha256: "f5e0f906671d21ec7d249e05be681753a81700cfe82a265f37bb4754e315f774",
      forceOnlyHardening: true,
    });
    assert.equal(
      (force.match(/^ALTER TABLE public\."Notification" FORCE ROW LEVEL SECURITY;$/gm) ?? []).length,
      1,
    );
    assert.equal((force.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((force.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(force, /^(?:CREATE|DROP)\s+POLICY\b|^(?:GRANT|REVOKE)\s|^(?:INSERT|UPDATE|DELETE)\s/mi);
    assert.match(force, /current_user = 'neondb_owner'/);
    assert.match(force, /current_user = 'ci'[\s\S]{0,100}current_database\(\) = 'grainline_ci'/);
    assert.match(force, /notification_state\.owner_name <> current_user/);
  });

  it("fails closed on missing, drifting, or symlinked FORCE bytes", () => {
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(migrations, NOTIFICATION_FORCE_RELEASE.activation, activation);
      assert.throws(() => verifyNotificationForceRelease(root), /migration is missing/);
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(migrations, NOTIFICATION_FORCE_RELEASE.activation, activation);
      writeRelease(migrations, NOTIFICATION_FORCE_RELEASE.force, `${force}\n-- drift\n`);
      assert.throws(() => verifyNotificationForceRelease(root), /migration bytes drifted/);
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(migrations, NOTIFICATION_FORCE_RELEASE.activation, activation);
      const directory = path.join(migrations, NOTIFICATION_FORCE_RELEASE.force.migrationName);
      mkdirSync(directory);
      const target = path.join(root, "force.sql");
      writeFileSync(target, force);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(() => verifyNotificationForceRelease(root), /regular non-symlink/);
    }
  });
});
