#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID = /^[a-z0-9_]+$/u;

export const PRIVILEGE_RELEASES = Object.freeze({
  service_reference_v1: Object.freeze({
    minimumCompatibleAppCommit:
      "b56e226d327347fe155aa07ded0bde999ca929be",
    migration: "20261101020000_narrow_service_reference_runtime_privileges",
    migrationSha256:
      "5ae6d88826690ae5f0a653c02c87ae28fc76bb9f3609119402b2590594edbc6c",
    sourceTests: Object.freeze([
      "tests/service-reference-least-privilege.test.mjs",
    ]),
    tables: Object.freeze({
      FoundingMakerGrant: Object.freeze(["SELECT"]),
      Metro: Object.freeze(["INSERT", "SELECT", "UPDATE"]),
      SiteConfig: Object.freeze(["SELECT"]),
      SiteMetricsSnapshot: Object.freeze(["INSERT", "SELECT", "UPDATE"]),
      SystemAuditLog: Object.freeze(["INSERT", "SELECT"]),
    }),
  }),
});

function stopped(message) {
  return new Error(`privilege release stopped: ${message}`);
}

export function privilegeRelease(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVILEGE_RELEASES[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  return release;
}

export function privilegeReleaseMigrationPath(release, rootDir = process.cwd()) {
  return join(rootDir, "prisma", "migrations", release.migration, "migration.sql");
}

export function verifyPrivilegeReleaseSource(
  releaseId,
  rootDir = process.cwd(),
  migrationPath,
) {
  const release = privilegeRelease(releaseId);
  const path = migrationPath ?? privilegeReleaseMigrationPath(release, rootDir);
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, release.migrationSha256, "migration bytes drifted");
  return Object.freeze({ release, migrationPath: path, digest });
}

function requiredReleaseId(env = process.env) {
  const releaseId = env.PRIVILEGE_RELEASE_ID;
  if (typeof releaseId !== "string" || releaseId !== releaseId.trim()) {
    throw stopped("PRIVILEGE_RELEASE_ID is required");
  }
  return releaseId;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const releaseId = requiredReleaseId();
    const verified = verifyPrivilegeReleaseSource(releaseId);
    const option = process.argv[2];
    if (option === "--tests") {
      process.stdout.write(`${verified.release.sourceTests.join("\n")}\n`);
    } else if (option === "--minimum-compatible-app-commit") {
      process.stdout.write(`${verified.release.minimumCompatibleAppCommit}\n`);
    } else if (option === undefined) {
      process.stdout.write(`${verified.release.migration}\n`);
    } else {
      throw stopped("CLI option is invalid");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
