import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DISPOSABLE_PREPARATION_PROOF_SHA256,
  NOTIFICATION_ACTIVATION_MIGRATION_NAME,
  NOTIFICATION_PREPARATION_RELEASE,
  verifyNotificationPreparationRelease,
} from "../scripts/verify-notification-preparation-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "notification-preparation-release-"));
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

describe("Notification preparation release artifact", () => {
  it("pins the committed preparation bytes and requires activation to stay absent", () => {
    const source = readFileSync(
      `prisma/migrations/${NOTIFICATION_PREPARATION_RELEASE.migrationName}/migration.sql`,
      "utf8",
    );
    const { root, migrations } = fixtureRoot();
    const directory = path.join(migrations, NOTIFICATION_PREPARATION_RELEASE.migrationName);
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), source);

    assert.deepEqual(verifyNotificationPreparationRelease(root), {
      status: "passed",
      preparationMigration: "20260722051500_prepare_notification_rls",
      preparationSha256: "9f7eeaf23e0f334dbb52427d27343674a5d11095b0b7f433d3ca177e3914956e",
      executableBodyMatchesDisposableProof: true,
      activationMigrationPresent: false,
    });
    assert.equal(
      NOTIFICATION_PREPARATION_RELEASE.migrationName,
      "20260722051500_prepare_notification_rls",
    );
    assert.equal(
      DISPOSABLE_PREPARATION_PROOF_SHA256,
      "83f49cec2589c359cda5413282a492f68b26cca760f54861cd29a9a3bfb579f9",
    );
    assert.equal(
      NOTIFICATION_ACTIVATION_MIGRATION_NAME,
      "20260722052000_enable_notification_rls",
    );
  });

  it("fails closed on byte drift, symlinks, or an activation artifact", () => {
    const source = readFileSync(
      `prisma/migrations/${NOTIFICATION_PREPARATION_RELEASE.migrationName}/migration.sql`,
      "utf8",
    );

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(migrations, NOTIFICATION_PREPARATION_RELEASE.migrationName);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), `${source}\n-- drift\n`);
      assert.throws(() => verifyNotificationPreparationRelease(root), /bytes drifted/);
    }

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(migrations, NOTIFICATION_PREPARATION_RELEASE.migrationName);
      mkdirSync(directory);
      const target = path.join(root, "target.sql");
      writeFileSync(target, source);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(() => verifyNotificationPreparationRelease(root), /regular non-symlink/);
    }

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(migrations, NOTIFICATION_PREPARATION_RELEASE.migrationName);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "migration.sql"), source);
      const activation = path.join(migrations, NOTIFICATION_ACTIVATION_MIGRATION_NAME);
      mkdirSync(activation);
      writeFileSync(path.join(activation, "migration.sql"), "SELECT 1;\n");
      assert.throws(() => verifyNotificationPreparationRelease(root), /must remain absent/);
    }
  });
});
