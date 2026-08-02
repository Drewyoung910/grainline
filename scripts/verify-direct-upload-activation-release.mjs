#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildDirectUploadActivationCandidate,
  DIRECT_UPLOAD_ACTIVATION_MIGRATION,
} from "./stage-direct-upload-activation-migration.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
} from "./direct-upload-activation-catalog.mjs";

const REVIEWED_PRODUCTION_PREDECESSOR =
  "20260801175000_retire_direct_upload_compatibility_key";
export const DIRECT_UPLOAD_ACTIVATION_RELEASE_MIGRATION =
  "20260801194000_enable_direct_upload_rls";
export const DIRECT_UPLOAD_ACTIVATION_RELEASE = Object.freeze({
  migrationName: DIRECT_UPLOAD_ACTIVATION_RELEASE_MIGRATION,
  sha256: "41c2099157737e7457997d5ad71932671f5813dcbb436b699671b8af29458ffb",
});
export const DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256 =
  "b017fd8898b3aa901457977a5aa4f8fb2ac495546c59c348788722a6569d370d";

const promotedHeader = `-- Promoted reviewed DirectUpload service-only RLS activation migration.
-- Apply only through the guarded main-only production migration workflow after
-- the rejected v3 Cloudflare token is independently confirmed revoked.
-- Case-evidence enablement and cleanup scheduling remain separate releases.`;
const disposableHeader = `-- Generated disposable DirectUpload RLS activation candidate.
-- Do not apply outside the loopback grainline_ci proof workflow.
-- Production promotion requires the separately approved retirement migration,
-- cleanup-worker/provider proof, legacy repair residue proof and app drain.`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyDirectUploadActivationRelease(root = process.cwd()) {
  if (
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName.localeCompare(
      REVIEWED_PRODUCTION_PREDECESSOR,
    ) <= 0
  ) {
    throw new Error(
      "reviewed DirectUpload activation must follow production retirement",
    );
  }
  if (
    existsSync(
      `${root}/prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_MIGRATION}`,
    )
  ) {
    throw new Error(
      "disposable DirectUpload activation must not enter production history",
    );
  }

  const migrationPath =
    `${root}/prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error("reviewed DirectUpload activation migration is missing");
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      "reviewed DirectUpload activation migration must be a regular non-symlink file",
    );
  }

  const contents = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(contents);
  if (migrationSha256 !== DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256) {
    throw new Error("reviewed DirectUpload activation migration bytes drifted");
  }
  if (!contents.startsWith(`${promotedHeader}\n\n`)) {
    throw new Error("reviewed DirectUpload activation promotion header drifted");
  }

  const disposableProofEquivalent = contents.replace(
    promotedHeader,
    disposableHeader,
  );
  const disposableSha256 = sha256(disposableProofEquivalent);
  if (disposableSha256 !== DISPOSABLE_DIRECT_UPLOAD_ACTIVATION_SHA256) {
    throw new Error(
      "DirectUpload activation body drifted from disposable proof",
    );
  }
  if (
    buildDirectUploadActivationCandidate().migration
      !== disposableProofEquivalent
  ) {
    throw new Error(
      "DirectUpload activation release no longer matches the byte-pinned generator",
    );
  }

  const expectedFunctionGrants = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) => entry.runtimeExecute || entry.cleanupExecute).length;
  if (
    (contents.match(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (contents.match(/FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (contents.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 0
    || (contents.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) ?? []).length
      !== expectedFunctionGrants
    || /GRANT\s+[^;]*\s+ON\s+(?:TABLE\s+)?public\."DirectUpload(?:Reference)?"/i
      .test(contents)
  ) {
    throw new Error(
      "reviewed DirectUpload activation crossed its service-only boundary",
    );
  }

  return Object.freeze({
    status: "passed",
    migrationName: DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    migrationSha256,
    disposableProofSha256: disposableSha256,
    executableBodyMatchesDisposableProof: true,
    followsReviewedProductionHistory: true,
    functionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length,
    runtimeFunctionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
      .filter((entry) => entry.runtimeExecute).length,
    cleanupFunctionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
      .filter((entry) => entry.cleanupExecute).length,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: [],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyDirectUploadActivationRelease())}\n`,
    );
  } catch {
    process.stderr.write(
      "DirectUpload activation release verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}
