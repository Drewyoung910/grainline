#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  privateTableEnable,
  verifyPrivateTableEnableSource,
} from "./private-table-enable-catalog.mjs";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export const PRIVATE_TABLE_FORCE_CONFIRMATION = "force-reviewed-private-table-rls";

export const PRIVATE_TABLE_FORCES = Object.freeze({
  support_request_v1: Object.freeze({
    enableReleaseId: "support_request_v1",
    migration: "20261023060000_force_support_request_rls",
    migrationSha256: "b9f4c0e5026faa02d2d811aee8de601f4919354fac0ef43ad85b41b6060b6d43",
    table: "SupportRequest",
    prerequisites: Object.freeze([
      Object.freeze({
        migration: "20261023050000_correct_support_request_email_reuse_privacy",
        migrationSha256: "9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1",
      }),
    ]),
  }),
});

function stopped(message) {
  return new Error(`private-table FORCE stopped: ${message}`);
}

export function privateTableForce(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_FORCES[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  const enable = privateTableEnable(release.enableReleaseId);
  if (enable.table !== release.table) throw stopped("ENABLE table drifted");
  return Object.freeze({ ...release, enable });
}

export function privateTableForceMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

function verifyDigest(rootDir, migration, expectedDigest) {
  const migrationPath = path.join(
    rootDir,
    `prisma/migrations/${migration}/migration.sql`,
  );
  const bytes = readFileSync(migrationPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw stopped(`${migration} digest drifted`);
  return Object.freeze({ migration, migrationPath, digest, sql: bytes.toString("utf8") });
}

export function verifyPrivateTableForceSource(releaseId, rootDir = process.cwd()) {
  const release = privateTableForce(releaseId);
  const enable = verifyPrivateTableEnableSource(release.enableReleaseId, rootDir);
  const prerequisites = release.prerequisites.map((entry) =>
    verifyDigest(rootDir, entry.migration, entry.migrationSha256));
  const force = verifyDigest(
    rootDir,
    release.migration,
    release.migrationSha256,
  );
  const quotedTable = release.table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const forcePattern = new RegExp(
    `ALTER\\s+TABLE\\s+public\\."${quotedTable}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "iu",
  );
  if (
    !forcePattern.test(force.sql)
    || /\b(?:ENABLE|DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(force.sql)
    || /\bCREATE\s+(?:POLICY|FUNCTION|TRIGGER)\b/iu.test(force.sql)
    || /\bDROP\s+(?:TABLE|COLUMN|POLICY|FUNCTION|TRIGGER)\b/iu.test(force.sql)
    || /\b(?:GRANT|REVOKE)\b/iu.test(force.sql)
  ) {
    throw stopped("migration is not the reviewed posture-only FORCE shape");
  }
  return Object.freeze({
    releaseId,
    release,
    enable,
    prerequisites,
    migrationPath: force.migrationPath,
    digest: force.digest,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const verified = verifyPrivateTableForceSource(
      process.env.PRIVATE_TABLE_FORCE_RELEASE_ID ?? "",
    );
    process.stdout.write(`${verified.release.migration}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
