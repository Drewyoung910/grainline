#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NOTIFICATION_FORCE_RELEASE = Object.freeze({
  activation: Object.freeze({
    migrationName: "20260722052000_enable_notification_rls",
    sha256: "f4b475d5f7c071011e35425b68bc26738bae8696c658457d8ed55ebffc8ddc92",
  }),
  force: Object.freeze({
    migrationName: "20260722053000_force_notification_rls",
    sha256: "f5e0f906671d21ec7d249e05be681753a81700cfe82a265f37bb4754e315f774",
  }),
});

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

export function verifyNotificationForceRelease(root = process.cwd()) {
  const activation = readPinnedRegularFile(root, NOTIFICATION_FORCE_RELEASE.activation);
  const force = readPinnedRegularFile(root, NOTIFICATION_FORCE_RELEASE.force);
  if (
    !force.contents.startsWith("-- Reviewed Notification FORCE hardening migration.\n")
    || !force.contents.includes(
      "-- Apply only through the guarded main-only production migration workflow.\n",
    )
    || !force.contents.includes(
      "ALTER TABLE public.\"Notification\" FORCE ROW LEVEL SECURITY;",
    )
    || force.contents.includes(
      "ALTER TABLE public.\"Notification\" NO FORCE ROW LEVEL SECURITY;",
    )
  ) {
    throw new Error("reviewed Notification FORCE release shape drifted");
  }
  return Object.freeze({
    status: "passed",
    activationMigration: NOTIFICATION_FORCE_RELEASE.activation.migrationName,
    activationSha256: activation.sha256,
    forceMigration: NOTIFICATION_FORCE_RELEASE.force.migrationName,
    forceSha256: force.sha256,
    forceOnlyHardening: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(verifyNotificationForceRelease())}\n`);
  } catch {
    process.stderr.write("Notification FORCE release verification failed closed.\n");
    process.exitCode = 1;
  }
}
