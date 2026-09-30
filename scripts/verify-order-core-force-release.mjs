#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildOrderCoreRlsCandidates } from "./build-order-core-rls-candidates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORDER_CORE_ENABLE_MIGRATION = "20260927090000_enable_order_rls";
export const ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION =
  "20260929130000_revoke_order_item_shipping_quote_runtime_access";
export const ORDER_CORE_FORCE_MIGRATION = "20260929160000_force_order_rls";

export function verifyOrderCoreForceRelease(root = ROOT) {
  const migrations = path.join(root, "prisma/migrations");
  const directories = readdirSync(migrations, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const coreOrderPostureMigrations = directories.filter(name =>
    /_(?:enable|force)_order_rls$/u.test(name));
  assert.deepEqual(
    coreOrderPostureMigrations,
    [ORDER_CORE_ENABLE_MIGRATION, ORDER_CORE_FORCE_MIGRATION],
    "Core Order FORCE must be the sole posture successor to accepted ENABLE",
  );
  assert.ok(
    directories.includes(ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION),
    "Core Order FORCE requires the staged Order item/quote runtime lock",
  );
  const candidate = buildOrderCoreRlsCandidates(root);
  const actual = readFileSync(
    path.join(migrations, ORDER_CORE_FORCE_MIGRATION, "migration.sql"),
    "utf8",
  );
  assert.equal(actual, candidate.forceMigration,
    "Core Order FORCE migration differs from byte-pinned candidate");
  return Object.freeze({
    migration: ORDER_CORE_FORCE_MIGRATION,
    predecessor: ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
    sha256: candidate.forceMigrationSha256,
    forceIncluded: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Core Order FORCE verifier takes no arguments");
    process.stdout.write(`${JSON.stringify(verifyOrderCoreForceRelease())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Core Order FORCE verification failed"}\n`);
    process.exitCode = 1;
  }
}
