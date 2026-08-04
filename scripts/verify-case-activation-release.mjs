#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CASE_ACTIVATION_MIGRATION,
  CASE_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CASE_ACTIVATION_DRAFT_SHA256,
  buildCaseActivationCandidate,
} from "./stage-case-activation-migration.mjs";

export const CASE_ACTIVATION_RELEASE_PHASE = "case-activation-reviewed";
export const CASE_ACTIVATION_ROLLBACK_SHA256 =
  "3aa35aaaa3e02583965fc1ae5fd7301b2caeba797deb9b8e807309a51b2db8b0";
export const CASE_FORCE_DRAFT_SHA256 =
  "2620be10dba8e1c9074742f925e7f146ce2a8f4acaea4b6a6dd88e0a0b92b4d9";
export const CASE_FORCE_ROLLBACK_DRAFT_SHA256 =
  "dc6ead925a61509465925d880f6338d0494ab583b9c38dda012f0eeea6e0a59d";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyCaseActivationRelease(rootDirectory = process.cwd()) {
  const candidate = buildCaseActivationCandidate(rootDirectory);
  const migrationPath = path.join(
    "prisma",
    "migrations",
    CASE_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(
    path.join(rootDirectory, migrationPath),
    "utf8",
  );
  if (migration !== candidate.migration) {
    throw new Error("Case activation migration differs from the byte-pinned draft");
  }

  const migrationNames = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    {
      withFileTypes: true,
    },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    path.join(rootDirectory, "prisma/migrations"),
    migrationNames,
  );
  if (migrationTreeSha256 !== CASE_ACTIVATION_MIGRATION_TREE_SHA256) {
    throw new Error("Case activation migration tree fingerprint drifted");
  }

  const reviewedFiles = [
    [
      "docs/rls-drafts/case-case-message-activation-rollback.sql",
      CASE_ACTIVATION_ROLLBACK_SHA256,
    ],
    [
      "docs/rls-drafts/case-case-message-force.sql",
      CASE_FORCE_DRAFT_SHA256,
    ],
    [
      "docs/rls-drafts/case-case-message-force-rollback.sql",
      CASE_FORCE_ROLLBACK_DRAFT_SHA256,
    ],
  ];
  for (const [relativePath, expected] of reviewedFiles) {
    if (
      sha256(fs.readFileSync(path.join(rootDirectory, relativePath), "utf8"))
        !== expected
    ) {
      throw new Error(`reviewed Case release file drifted: ${relativePath}`);
    }
  }

  const guard = validateCurrentSavedSearchRlsDeployShape({
    phase: CASE_ACTIVATION_RELEASE_PHASE,
    rootDirectory,
  });
  return Object.freeze({
    phase: CASE_ACTIVATION_RELEASE_PHASE,
    migration: CASE_ACTIVATION_MIGRATION,
    draftSha256: CASE_ACTIVATION_DRAFT_SHA256,
    migrationSha256: candidate.migrationSha256,
    migrationTreeSha256,
    protectedTables: 3,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    guard,
  });
}

function main() {
  const result = verifyCaseActivationRelease();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Case activation release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
