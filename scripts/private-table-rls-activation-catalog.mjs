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

export const PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION =
  "activate-reviewed-private-table-rls";

export const PRIVATE_TABLE_RLS_ACTIVATIONS = Object.freeze({
  maker_verification_v1: Object.freeze({
    preparationReleaseId: "maker_verification_v1",
    migration: "20261028050000_activate_maker_verification_rls",
    migrationSha256:
      "7868277f03b599768784c0f3a44a3c7bb28c8b64772a24f6183c538ec6f3401c",
    rollbackPath: "docs/rls-drafts/maker-verification-activation-rollback.sql",
    rollbackSha256:
      "510bdc3b31a07c9cf2c6bd02bf01d3964448a3a4e68091d2efc579712d7ed251",
    table: "MakerVerification",
    mode: "policyless_combined_enable_force",
    expectedPolicyCount: 0,
    predecessorRuntimePrivileges: Object.freeze([
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
    ]),
    activatedRuntimePrivileges: Object.freeze([]),
    activatedStaffPrivileges: Object.freeze([]),
    activatedPublicPrivileges: Object.freeze([]),
  }),
});

function stopped(message) {
  return new Error(`private-table RLS activation stopped: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function artifact(rootDir, relativePath, expectedDigest, label) {
  const absolutePath = path.join(rootDir, relativePath);
  const bytes = readFileSync(absolutePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw stopped(`${label} digest drifted`);
  return Object.freeze({
    path: absolutePath,
    digest,
    sql: bytes.toString("utf8"),
  });
}

function signatureLiteral(entry) {
  return `public.${entry.name}(${entry.arguments.replace(/,\s+/gu, ",")})`;
}

export function privateTableRlsActivation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_RLS_ACTIVATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  const preparation = privateTablePreparation(release.preparationReleaseId);
  if (preparation.table !== release.table) {
    throw stopped("preparation table drifted");
  }
  return Object.freeze({ ...release, preparation });
}

export function privateTableRlsActivationMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

export function verifyPrivateTableRlsActivationSource(
  releaseId,
  rootDir = process.cwd(),
) {
  const release = privateTableRlsActivation(releaseId);
  const preparation = verifyPrivateTablePreparationSource(
    release.preparationReleaseId,
    rootDir,
  );
  const activation = artifact(
    rootDir,
    privateTableRlsActivationMigrationPath(release),
    release.migrationSha256,
    "activation migration",
  );
  const rollback = artifact(
    rootDir,
    release.rollbackPath,
    release.rollbackSha256,
    "rollback",
  );
  const quotedTable = escapeRegExp(release.table);
  const tablePattern = `public\\."${quotedTable}"`;
  const activationTableStatements = [
    ...activation.sql.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  if (
    release.mode !== "policyless_combined_enable_force"
    || release.expectedPolicyCount !== 0
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+TABLE\\s+${tablePattern}[\\s\\S]*?FROM\\s+PUBLIC,\\s*grainline_app_runtime,\\s*grainline_staff_read_runtime`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `LOCK\\s+TABLE\\s+${tablePattern}\\s+IN\\s+ACCESS\\s+EXCLUSIVE\\s+MODE`,
      "iu",
    ).test(activation.sql)
    || activationTableStatements.length !== 3
    || activationTableStatements.some((table) => table !== release.table)
    || /\b(?:NO\s+FORCE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(activation.sql)
    || /\bCREATE\s+POLICY\b/iu.test(activation.sql)
    || /^\s*GRANT\b/imu.test(activation.sql)
    || /\bDROP\s+(?:TABLE|COLUMN|POLICY|FUNCTION|TRIGGER)\b/iu.test(activation.sql)
  ) {
    throw stopped("migration is not the reviewed combined policyless activation shape");
  }
  for (const entry of preparation.release.functions) {
    const literal = signatureLiteral(entry).replaceAll("'", "''");
    if (!activation.sql.includes(`'${literal}'::pg_catalog.regprocedure`)) {
      throw stopped(`reviewed operation ${literal} is absent from activation preflight`);
    }
  }
  const rollbackTableStatements = [
    ...rollback.sql.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  if (
    !new RegExp(
      `GRANT\\s+SELECT,\\s*INSERT,\\s*UPDATE,\\s*DELETE\\s+ON\\s+TABLE\\s+${tablePattern}\\s+TO\\s+grainline_app_runtime`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+NO\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `LOCK\\s+TABLE\\s+${tablePattern}\\s+IN\\s+ACCESS\\s+EXCLUSIVE\\s+MODE`,
      "iu",
    ).test(rollback.sql)
    || rollbackTableStatements.length !== 3
    || rollbackTableStatements.some((table) => table !== release.table)
    || /\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(
      rollback.sql.replace(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/giu, ""),
    )
    || /\bCREATE\s+POLICY\b/iu.test(rollback.sql)
    || /^\s*REVOKE\b/imu.test(rollback.sql)
    || /\bDROP\s+(?:TABLE|COLUMN|POLICY|FUNCTION|TRIGGER)\b/iu.test(rollback.sql)
  ) {
    throw stopped("rollback is not the reviewed predecessor-restoration shape");
  }
  return Object.freeze({
    releaseId,
    release,
    preparation,
    migrationPath: activation.path,
    migrationDigest: activation.digest,
    rollbackPath: rollback.path,
    rollbackDigest: rollback.digest,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const verified = verifyPrivateTableRlsActivationSource(
      process.env.PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID ?? "",
    );
    process.stdout.write(`${verified.release.migration}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
