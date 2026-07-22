#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NOTIFICATION_PREPARATION_RELEASE = Object.freeze({
  migrationName: "20260722051500_prepare_notification_rls",
  sha256: "9f7eeaf23e0f334dbb52427d27343674a5d11095b0b7f433d3ca177e3914956e",
});
export const DISPOSABLE_PREPARATION_PROOF_SHA256 =
  "83f49cec2589c359cda5413282a492f68b26cca760f54861cd29a9a3bfb579f9";
export const NOTIFICATION_ACTIVATION_MIGRATION_NAME =
  "20260722052000_enable_notification_rls";

export function verifyNotificationPreparationRelease(root = process.cwd()) {
  const preparationPath = `${root}/prisma/migrations/${NOTIFICATION_PREPARATION_RELEASE.migrationName}/migration.sql`;
  const activationPath = `${root}/prisma/migrations/${NOTIFICATION_ACTIVATION_MIGRATION_NAME}/migration.sql`;
  if (!existsSync(preparationPath)) {
    throw new Error("reviewed Notification preparation migration is missing");
  }
  const stat = lstatSync(preparationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("reviewed Notification preparation migration must be a regular non-symlink file");
  }
  const contents = readFileSync(preparationPath, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== NOTIFICATION_PREPARATION_RELEASE.sha256) {
    throw new Error("reviewed Notification preparation migration bytes drifted");
  }
  if (
    !contents.startsWith("-- Promoted reviewed Notification preparation migration.\n")
    || !contents.includes("-- Apply only through the guarded main-only production migration workflow.\n")
  ) {
    throw new Error("reviewed Notification preparation promotion header drifted");
  }
  const disposableProofEquivalent = `${contents
    .replace(
      "-- Promoted reviewed Notification preparation migration.",
      "-- Generated disposable Notification preparation candidate.",
    )
    .replace(
      "-- Apply only through the guarded main-only production migration workflow.",
      "-- Do not apply outside the loopback grainline_ci proof workflow.",
    )}\n`;
  if (
    createHash("sha256").update(disposableProofEquivalent).digest("hex")
      !== DISPOSABLE_PREPARATION_PROOF_SHA256
  ) {
    throw new Error("Notification preparation executable body drifted from disposable proof");
  }
  if (existsSync(activationPath)) {
    throw new Error("Notification activation migration must remain absent from the preparation release");
  }
  return Object.freeze({
    status: "passed",
    preparationMigration: NOTIFICATION_PREPARATION_RELEASE.migrationName,
    preparationSha256: sha256,
    executableBodyMatchesDisposableProof: true,
    activationMigrationPresent: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(verifyNotificationPreparationRelease())}\n`);
  } catch {
    process.stderr.write("Notification preparation release verification failed closed.\n");
    process.exitCode = 1;
  }
}
