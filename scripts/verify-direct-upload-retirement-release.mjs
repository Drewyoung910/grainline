#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildDirectUploadRetirementCandidate,
  DIRECT_UPLOAD_RETIREMENT_MIGRATION,
} from "./stage-direct-upload-retirement-migration.mjs";

const REVIEWED_PRODUCTION_PREDECESSOR =
  "20260730020000_converge_case_read_modes";
export const DIRECT_UPLOAD_RETIREMENT_RELEASE_MIGRATION =
  "20260801175000_retire_direct_upload_compatibility_key";
export const DIRECT_UPLOAD_RETIREMENT_RELEASE = Object.freeze({
  migrationName: DIRECT_UPLOAD_RETIREMENT_RELEASE_MIGRATION,
  sha256: "42622759fdf9fcfda418e674ab43c9d013c0f0c536eda93c0aaa9495da826754",
});
export const DISPOSABLE_DIRECT_UPLOAD_RETIREMENT_SHA256 =
  "63e8db0888e7ba5fb805707bb0ba855d6050c8e6ac573b37eafe4a2678e2dcce";

const promotedHeader = `-- Promoted reviewed DirectUpload compatibility-key retirement migration.
-- Apply only through the guarded main-only production migration workflow.
-- DirectUpload RLS activation, table-grant narrowing and cleanup scheduling
-- remain separate later releases.`;
const disposableHeader = `-- Generated disposable DirectUpload compatibility-key retirement candidate.
-- Do not apply outside the loopback grainline_ci proof workflow.
-- Production promotion requires compatible-app drain plus separately approved
-- aggregate legacy inspection, repair, backup and residue evidence.`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyDirectUploadRetirementRelease(root = process.cwd()) {
  if (
    DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName.localeCompare(
      REVIEWED_PRODUCTION_PREDECESSOR,
    ) <= 0
  ) {
    throw new Error(
      "reviewed DirectUpload retirement migration must follow the production Case read-mode migration",
    );
  }
  if (
    existsSync(
      `${root}/prisma/migrations/${DIRECT_UPLOAD_RETIREMENT_MIGRATION}`,
    )
  ) {
    throw new Error(
      "disposable DirectUpload retirement migration must not enter production history",
    );
  }
  const migrationPath =
    `${root}/prisma/migrations/${DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error("reviewed DirectUpload retirement migration is missing");
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      "reviewed DirectUpload retirement migration must be a regular non-symlink file",
    );
  }

  const contents = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(contents);
  if (migrationSha256 !== DIRECT_UPLOAD_RETIREMENT_RELEASE.sha256) {
    throw new Error("reviewed DirectUpload retirement migration bytes drifted");
  }
  if (!contents.startsWith(`${promotedHeader}\n\n`)) {
    throw new Error("reviewed DirectUpload retirement promotion header drifted");
  }

  const disposableProofEquivalent = contents.replace(
    promotedHeader,
    disposableHeader,
  );
  const disposableSha256 = sha256(disposableProofEquivalent);
  if (disposableSha256 !== DISPOSABLE_DIRECT_UPLOAD_RETIREMENT_SHA256) {
    throw new Error(
      "DirectUpload retirement body drifted from disposable proof",
    );
  }
  if (
    buildDirectUploadRetirementCandidate().migration
      !== disposableProofEquivalent
  ) {
    throw new Error(
      "DirectUpload retirement release no longer matches the byte-pinned generator",
    );
  }

  const validatedConstraints =
    contents.match(/VALIDATE CONSTRAINT\s+"DirectUpload_[^"]+"/g) ?? [];
  if (
    validatedConstraints.length !== 6
    || (contents.match(/DROP COLUMN "objectKey"/g) ?? []).length !== 1
    || (contents.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 0
    || /(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/i.test(
      contents,
    )
    || /(?:GRANT|REVOKE)\s+[^;]*\s+ON\s+(?:TABLE\s+)?public\."DirectUpload"/i.test(
      contents,
    )
  ) {
    throw new Error(
      "reviewed DirectUpload retirement crossed its compatibility-only boundary",
    );
  }

  return Object.freeze({
    status: "passed",
    migrationName: DIRECT_UPLOAD_RETIREMENT_RELEASE.migrationName,
    migrationSha256,
    disposableProofSha256: disposableSha256,
    executableBodyMatchesDisposableProof: true,
    followsReviewedProductionHistory: true,
    validatedConstraintCount: 6,
    dropsCompatibilityObjectKey: true,
    rlsChanged: false,
    tableGrantsChanged: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyDirectUploadRetirementRelease())}\n`,
    );
  } catch {
    process.stderr.write(
      "DirectUpload retirement release verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}
