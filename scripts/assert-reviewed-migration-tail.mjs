#!/usr/bin/env node

import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATION_NAME = /^[0-9]{14}_[a-z0-9_]+$/u;

const stopped = () => new Error(
  "reviewed migration tail check stopped; release source or ordering drifted",
);

function migrationList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function collectReviewedMigrationTailIssues({
  directoryNames,
  releaseMigrations,
  laterPendingMigrations,
}) {
  const issues = [];
  const directories = [...(directoryNames ?? [])]
    .filter((name) => MIGRATION_NAME.test(name))
    .sort((left, right) => left.localeCompare(right));
  const release = [...(releaseMigrations ?? [])];
  const later = [...(laterPendingMigrations ?? [])];
  const expected = [...release, ...later];

  if (
    release.length === 0
    || expected.some((name) => !MIGRATION_NAME.test(name))
    || new Set(expected).size !== expected.length
    || expected.join("|") !== [...expected].sort(
      (left, right) => left.localeCompare(right),
    ).join("|")
  ) {
    issues.push("reviewed migration tail catalog is invalid");
    return issues;
  }

  const firstIndex = directories.indexOf(release[0]);
  const actual = firstIndex < 0 ? [] : directories.slice(firstIndex);
  if (actual.join("|") !== expected.join("|")) {
    issues.push(`migration tail drifted: ${actual.join(",") || "none"}`);
  }
  return issues;
}

export function assertReviewedMigrationTail({
  env = process.env,
  rootDir = process.cwd(),
} = {}) {
  const releaseMigrations = migrationList(env.REVIEWED_RELEASE_MIGRATIONS);
  const laterPendingMigrations = migrationList(
    env.REVIEWED_LATER_PENDING_MIGRATIONS,
  );
  const directoryNames = readdirSync(
    path.join(rootDir, "prisma", "migrations"),
    { withFileTypes: true },
  ).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const issues = collectReviewedMigrationTailIssues({
    directoryNames,
    releaseMigrations,
    laterPendingMigrations,
  });
  if (issues.length > 0) throw stopped();
  return Object.freeze({
    releaseMigrationCount: releaseMigrations.length,
    laterPendingMigrationCount: laterPendingMigrations.length,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = assertReviewedMigrationTail();
    process.stdout.write(
      `Reviewed migration tail accepted: ${result.releaseMigrationCount} release, ${result.laterPendingMigrationCount} later pending.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
