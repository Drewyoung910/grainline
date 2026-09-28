#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildOrderCoreRlsCandidates } from "./build-order-core-rls-candidates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORDER_CORE_ENABLE_MIGRATION = "20260927090000_enable_order_rls";

export function verifyOrderCoreEnableRelease(root = ROOT) {
  const migrations = path.join(root, "prisma/migrations");
  const directories = readdirSync(migrations, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const coreOrderPostureMigrations = directories.filter(name =>
    /_(?:enable|force)_order_rls$/u.test(name));
  assert.deepEqual(
    coreOrderPostureMigrations,
    [ORDER_CORE_ENABLE_MIGRATION],
    "Core Order ENABLE must remain the sole staged Core Order posture migration",
  );
  const candidate = buildOrderCoreRlsCandidates(root);
  const actual = readFileSync(
    path.join(migrations, ORDER_CORE_ENABLE_MIGRATION, "migration.sql"),
    "utf8",
  );
  assert.equal(actual, candidate.enableMigration,
    "Core Order ENABLE migration differs from byte-pinned candidate");
  return Object.freeze({
    migration: ORDER_CORE_ENABLE_MIGRATION,
    sha256: candidate.enableMigrationSha256,
    forceIncluded: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Core Order ENABLE verifier takes no arguments");
    process.stdout.write(`${JSON.stringify(verifyOrderCoreEnableRelease())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Core Order ENABLE verification failed"}\n`);
    process.exitCode = 1;
  }
}
