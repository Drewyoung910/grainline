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
  DISPOSABLE_ACTIVATION_PROOF_SHA256,
  NOTIFICATION_ACTIVATION_RELEASE,
  verifyNotificationActivationRelease,
} from "../scripts/verify-notification-activation-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "notification-activation-release-"));
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function writeReleaseFile(migrations, release, contents) {
  const directory = path.join(migrations, release.migrationName);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "migration.sql"), contents);
}

describe("Notification activation release artifact", () => {
  const preparation = readFileSync(
    `prisma/migrations/${NOTIFICATION_ACTIVATION_RELEASE.preparation.migrationName}/migration.sql`,
    "utf8",
  );
  const activation = readFileSync(
    `prisma/migrations/${NOTIFICATION_ACTIVATION_RELEASE.activation.migrationName}/migration.sql`,
    "utf8",
  );

  it("pins both release migrations and the disposable-proof-equivalent activation body", () => {
    assert.deepEqual(verifyNotificationActivationRelease(), {
      status: "passed",
      preparationMigration: "20260722051500_prepare_notification_rls",
      preparationSha256: "9f7eeaf23e0f334dbb52427d27343674a5d11095b0b7f433d3ca177e3914956e",
      activationMigration: "20260722052000_enable_notification_rls",
      activationSha256: "f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92",
      executableBodyMatchesDisposableProof: true,
    });
    assert.equal(
      DISPOSABLE_ACTIVATION_PROOF_SHA256,
      "e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329",
    );
  });

  it("fails closed on a missing, drifting, or symlinked activation migration", () => {
    {
      const { root, migrations } = fixtureRoot();
      writeReleaseFile(migrations, NOTIFICATION_ACTIVATION_RELEASE.preparation, preparation);
      assert.throws(
        () => verifyNotificationActivationRelease(root),
        /reviewed Notification migration is missing/,
      );
    }

    {
      const { root, migrations } = fixtureRoot();
      writeReleaseFile(migrations, NOTIFICATION_ACTIVATION_RELEASE.preparation, preparation);
      writeReleaseFile(
        migrations,
        NOTIFICATION_ACTIVATION_RELEASE.activation,
        `${activation}\n-- drift\n`,
      );
      assert.throws(
        () => verifyNotificationActivationRelease(root),
        /migration bytes drifted/,
      );
    }

    {
      const { root, migrations } = fixtureRoot();
      writeReleaseFile(migrations, NOTIFICATION_ACTIVATION_RELEASE.preparation, preparation);
      const directory = path.join(
        migrations,
        NOTIFICATION_ACTIVATION_RELEASE.activation.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "activation.sql");
      writeFileSync(target, activation);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyNotificationActivationRelease(root),
        /regular non-symlink/,
      );
    }
  });
});
