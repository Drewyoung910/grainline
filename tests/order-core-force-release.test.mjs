import assert from "node:assert/strict";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_CORE_ENABLE_MIGRATION,
  ORDER_CORE_FORCE_MIGRATION,
  ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
  verifyOrderCoreForceRelease,
} from "../scripts/verify-order-core-force-release.mjs";

test("Core Order FORCE is exact and follows the staged runtime lock", () => {
  assert.deepEqual(verifyOrderCoreForceRelease(), {
    migration: ORDER_CORE_FORCE_MIGRATION,
    predecessor: ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
    sha256: "1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139",
    forceIncluded: true,
  });
});

test("Core Order FORCE verifier rejects missing predecessors, drift, and extra posture changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "order-core-force-release-"));
  const drafts = path.join(root, "docs/rls-drafts");
  const migrations = path.join(root, "prisma/migrations");
  mkdirSync(drafts, { recursive: true });
  for (const file of [
    "order-core-activation.sql",
    "order-core-force.sql",
    "order-core-activation-rollback.sql",
    "order-core-force-rollback.sql",
  ]) cpSync(path.join("docs/rls-drafts", file), path.join(drafts, file));
  for (const migration of [
    ORDER_CORE_ENABLE_MIGRATION,
    ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
    ORDER_CORE_FORCE_MIGRATION,
  ]) {
    cpSync(path.join("prisma/migrations", migration), path.join(migrations, migration), {
      recursive: true,
    });
  }
  const force = path.join(migrations, ORDER_CORE_FORCE_MIGRATION, "migration.sql");
  writeFileSync(force, `${readFileSync(force, "utf8")}\n-- drift\n`);
  assert.throws(() => verifyOrderCoreForceRelease(root), /byte-pinned candidate/);
  writeFileSync(force, readFileSync(
    path.join("prisma/migrations", ORDER_CORE_FORCE_MIGRATION, "migration.sql"), "utf8",
  ));
  rmSync(path.join(migrations, ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION), {
    recursive: true, force: true,
  });
  assert.throws(() => verifyOrderCoreForceRelease(root), /requires the staged/);
  cpSync(
    path.join("prisma/migrations", ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION),
    path.join(migrations, ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION),
    { recursive: true },
  );
  cpSync(
    path.join(migrations, ORDER_CORE_FORCE_MIGRATION),
    path.join(migrations, "20260929170000_force_order_rls"),
    { recursive: true },
  );
  assert.throws(() => verifyOrderCoreForceRelease(root), /sole posture successor/);
  rmSync(root, { recursive: true, force: true });
});
