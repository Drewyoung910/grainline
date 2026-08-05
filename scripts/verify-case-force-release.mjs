#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CASE_ACTIVATION_MIGRATION,
  CASE_FORCE_MIGRATION,
  CASE_FORCE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  CASE_ACTIVATION_DRAFT_SHA256,
  buildCaseActivationCandidate,
} from "./stage-case-activation-migration.mjs";
import {
  CASE_FORCE_DRAFT_SHA256,
  CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256,
  buildCaseForceCandidate,
} from "./stage-case-force-migration.mjs";

export const CASE_FORCE_RELEASE_PHASE = "case-force-reviewed";
export const CASE_FORCE_ROLLBACK_DRAFT_SHA256 =
  "dc6ead925a61509465925d880f6338d0494ab583b9c38dda012f0eeea6e0a59d";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function verifyCaseForceRelease(rootDirectory = process.cwd()) {
  const activation = buildCaseActivationCandidate(rootDirectory);
  const activationMigration = fs.readFileSync(
    path.join(
      rootDirectory,
      "prisma",
      "migrations",
      CASE_ACTIVATION_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );
  if (activationMigration !== activation.migration) {
    throw new Error("Case FORCE predecessor differs from reviewed activation");
  }

  const candidate = buildCaseForceCandidate(rootDirectory);
  const migrationPath = path.join(
    "prisma",
    "migrations",
    CASE_FORCE_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(
    path.join(rootDirectory, migrationPath),
    "utf8",
  );
  if (migration !== candidate.migration) {
    throw new Error("Case FORCE migration differs from the byte-pinned draft");
  }

  const migrationNames = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    path.join(rootDirectory, "prisma/migrations"),
    migrationNames.filter((name) => name <= CASE_FORCE_MIGRATION),
  );
  if (migrationTreeSha256 !== CASE_FORCE_MIGRATION_TREE_SHA256) {
    throw new Error("Case FORCE migration tree fingerprint drifted");
  }

  const rollbackPath = path.join(
    rootDirectory,
    "docs/rls-drafts/case-case-message-force-rollback.sql",
  );
  if (
    sha256(fs.readFileSync(rollbackPath, "utf8"))
      !== CASE_FORCE_ROLLBACK_DRAFT_SHA256
  ) {
    throw new Error("reviewed Case FORCE rollback bytes drifted");
  }

  return Object.freeze({
    phase: CASE_FORCE_RELEASE_PHASE,
    activationMigration: CASE_ACTIVATION_MIGRATION,
    activationDraftSha256: CASE_ACTIVATION_DRAFT_SHA256,
    activationMigrationSha256: activation.migrationSha256,
    forceMigration: CASE_FORCE_MIGRATION,
    forceDraftSha256: CASE_FORCE_DRAFT_SHA256,
    forceMembershipCorrectionSha256:
      CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256,
    forceMigrationSha256: candidate.migrationSha256,
    forceRollbackDraftSha256: CASE_FORCE_ROLLBACK_DRAFT_SHA256,
    migrationTreeSha256,
    protectedTables: 3,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    sealedPrefix: Object.freeze({
      migrationCutoff: CASE_FORCE_MIGRATION,
      phase: CASE_FORCE_RELEASE_PHASE,
      reviewed: true,
    }),
  });
}

function main() {
  const result = verifyCaseForceRelease();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Case FORCE release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
