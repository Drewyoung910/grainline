import assert from "node:assert/strict";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_CORE_ENABLE_MIGRATION,
  verifyOrderCoreEnableRelease,
} from "../scripts/verify-order-core-enable-release.mjs";

test("Core Order ENABLE is exact, terminal, and excludes FORCE", () => {
  assert.deepEqual(verifyOrderCoreEnableRelease(), {
    migration: ORDER_CORE_ENABLE_MIGRATION,
    sha256: "350567d0141601fd858dcc2df99f59b085d1f66573560b027148e66278a1eec8",
    forceIncluded: false,
  });
});

test("Core Order ENABLE verifier rejects changed bytes and a FORCE successor", () => {
  const root = mkdtempSync(path.join(tmpdir(), "order-core-enable-release-"));
  const drafts = path.join(root, "docs/rls-drafts");
  const migrations = path.join(root, "prisma/migrations");
  mkdirSync(drafts, { recursive: true });
  mkdirSync(path.join(migrations, ORDER_CORE_ENABLE_MIGRATION), { recursive: true });
  for (const file of [
    "order-core-activation.sql",
    "order-core-force.sql",
    "order-core-activation-rollback.sql",
    "order-core-force-rollback.sql",
  ]) cpSync(path.join("docs/rls-drafts", file), path.join(drafts, file));
  cpSync(
    path.join("prisma/migrations", ORDER_CORE_ENABLE_MIGRATION, "migration.sql"),
    path.join(migrations, ORDER_CORE_ENABLE_MIGRATION, "migration.sql"),
  );
  const migration = path.join(
    root, "prisma/migrations", ORDER_CORE_ENABLE_MIGRATION, "migration.sql",
  );
  writeFileSync(migration, `${readFileSync(migration, "utf8")}\n-- drift\n`);
  assert.throws(() => verifyOrderCoreEnableRelease(root), /byte-pinned candidate/);
  writeFileSync(migration, readFileSync(
    path.join("prisma/migrations", ORDER_CORE_ENABLE_MIGRATION, "migration.sql"),
    "utf8",
  ));
  const force = path.join(root, "prisma/migrations/20260927091000_force_order_rls");
  cpSync(path.join(root, "prisma/migrations", ORDER_CORE_ENABLE_MIGRATION), force, { recursive: true });
  assert.throws(() => verifyOrderCoreEnableRelease(root), /FORCE must remain outside/);
  rmSync(root, { recursive: true, force: true });
});
