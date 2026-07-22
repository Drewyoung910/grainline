#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NOTIFICATION_ACTIVATION_RELEASE = Object.freeze({
  preparation: Object.freeze({
    migrationName: "20260722051500_prepare_notification_rls",
    sha256: "9f7eeaf23e0f334dbb52427d27343674a5d11095b0b7f433d3ca177e3914956e",
  }),
  activation: Object.freeze({
    migrationName: "20260722052000_enable_notification_rls",
    sha256: "f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92",
  }),
});

export const DISPOSABLE_ACTIVATION_PROOF_SHA256 =
  "e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329";

function readPinnedRegularFile(root, release) {
  const migrationPath = `${root}/prisma/migrations/${release.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error(`reviewed Notification migration is missing: ${release.migrationName}`);
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`reviewed Notification migration must be a regular non-symlink file: ${release.migrationName}`);
  }
  const contents = readFileSync(migrationPath, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== release.sha256) {
    throw new Error(`reviewed Notification migration bytes drifted: ${release.migrationName}`);
  }
  return { contents, sha256 };
}

export function verifyNotificationActivationRelease(root = process.cwd()) {
  const preparation = readPinnedRegularFile(
    root,
    NOTIFICATION_ACTIVATION_RELEASE.preparation,
  );
  const activation = readPinnedRegularFile(
    root,
    NOTIFICATION_ACTIVATION_RELEASE.activation,
  );

  if (
    !activation.contents.startsWith("-- Promoted reviewed Notification activation migration.\n")
    || !activation.contents.includes(
      "-- Apply only through the guarded main-only production migration workflow.\n",
    )
  ) {
    throw new Error("reviewed Notification activation promotion header drifted");
  }

  const disposableProofEquivalent = `${activation.contents
    .replace(
      "-- Promoted reviewed Notification activation migration.",
      "-- Generated disposable Notification activation candidate.",
    )
    .replace(
      "-- Apply only through the guarded main-only production migration workflow.",
      "-- Do not apply outside the loopback grainline_ci proof workflow.",
    )}\n`;
  if (
    createHash("sha256").update(disposableProofEquivalent).digest("hex")
      !== DISPOSABLE_ACTIVATION_PROOF_SHA256
  ) {
    throw new Error("Notification activation executable body drifted from disposable proof");
  }

  return Object.freeze({
    status: "passed",
    preparationMigration: NOTIFICATION_ACTIVATION_RELEASE.preparation.migrationName,
    preparationSha256: preparation.sha256,
    activationMigration: NOTIFICATION_ACTIVATION_RELEASE.activation.migrationName,
    activationSha256: activation.sha256,
    executableBodyMatchesDisposableProof: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(verifyNotificationActivationRelease())}\n`);
  } catch {
    process.stderr.write("Notification activation release verification failed closed.\n");
    process.exitCode = 1;
  }
}
