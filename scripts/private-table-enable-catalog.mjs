#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;
const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/u;

export const PRIVATE_TABLE_ENABLE_CONFIRMATION = "enable-reviewed-private-table-rls";

export const PRIVATE_TABLE_ENABLES = Object.freeze({
  support_request_v1: Object.freeze({
    preparationReleaseId: "support_request_v1",
    migration: "20261023020000_enable_support_request_rls",
    migrationSha256: "370698b0617fbb5eb2d4d04d7acef43141628f8a8d3a6e672d4b1ef973493b61",
    table: "SupportRequest",
  }),
});

function stopped(message) {
  return new Error(`private-table ENABLE stopped: ${message}`);
}

export function privateTableEnable(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_ENABLES[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  const preparation = privateTablePreparation(release.preparationReleaseId);
  if (preparation.table !== release.table) throw stopped("preparation table drifted");
  return Object.freeze({ ...release, preparation });
}

export function privateTableEnableMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function verifyPrivateTableEnableSqlShape(sql, release) {
  if (typeof sql !== "string" || !release || typeof release !== "object") {
    throw stopped("migration is not the reviewed policyless ENABLE shape");
  }
  const table = release.table;
  if (typeof table !== "string" || !TABLE_NAME_PATTERN.test(table)) {
    throw stopped("reviewed table name is invalid");
  }
  const tableReference = `public\\s*\\.\\s*"${escapeRegExp(table)}"`;
  const enablesTable = new RegExp(
    `ALTER\\s+TABLE\\s+${tableReference}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "iu",
  );
  const leavesForceDisabled = new RegExp(
    `ALTER\\s+TABLE\\s+${tableReference}\\s+NO\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "iu",
  );
  const revokesTable = new RegExp(
    `REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tableReference}`,
    "iu",
  );
  if (
    !enablesTable.test(sql)
    || !leavesForceDisabled.test(sql)
    || !revokesTable.test(sql)
    || /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu.test(sql.replace(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/giu, ""))
    || /CREATE\s+POLICY/iu.test(sql)
    || /DROP\s+(?:TABLE|COLUMN|FUNCTION)/iu.test(sql)
  ) {
    throw stopped("migration is not the reviewed policyless ENABLE shape");
  }
}

export function verifyPrivateTableEnableSource(releaseId, rootDir = process.cwd()) {
  const release = privateTableEnable(releaseId);
  const preparation = verifyPrivateTablePreparationSource(
    release.preparationReleaseId,
    rootDir,
  );
  const migrationPath = path.join(rootDir, privateTableEnableMigrationPath(release));
  const bytes = readFileSync(migrationPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.migrationSha256) throw stopped("migration digest drifted");
  const sql = bytes.toString("utf8");
  verifyPrivateTableEnableSqlShape(sql, release);
  return Object.freeze({
    releaseId,
    release,
    preparation,
    migrationPath,
    digest,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const verified = verifyPrivateTableEnableSource(
      process.env.PRIVATE_TABLE_ENABLE_RELEASE_ID ?? "",
    );
    process.stdout.write(`${verified.release.migration}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
