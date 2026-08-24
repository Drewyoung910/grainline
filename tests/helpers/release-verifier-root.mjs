import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cachedRoots = new Map();

export function repositoryBeforeRefundReconciliation() {
  const excluded =
    "20260824040000_prepare_order_refund_reconciliation_authority";
  const cached = cachedRoots.get(excluded);
  if (cached) return cached;

  const sourceRoot = process.cwd();
  const root = mkdtempSync(path.join(
    tmpdir(),
    "grainline-pre-refund-reconciliation-",
  ));
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (
      entry.name === "prisma"
      || entry.name === ".git"
      || entry.name === ".next"
      || entry.name === "node_modules"
      || entry.name === "tests"
      || entry.name.startsWith(".env")
    ) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) symlinkSync(source, target);
    else copyFileSync(source, target);
  }

  const sourcePrisma = path.join(sourceRoot, "prisma");
  const targetPrisma = path.join(root, "prisma");
  mkdirSync(targetPrisma);
  for (const entry of readdirSync(sourcePrisma, { withFileTypes: true })) {
    if (entry.name === "migrations") continue;
    const source = path.join(sourcePrisma, entry.name);
    const target = path.join(targetPrisma, entry.name);
    if (entry.isDirectory()) symlinkSync(source, target);
    else copyFileSync(source, target);
  }
  const targetMigrations = path.join(targetPrisma, "migrations");
  mkdirSync(targetMigrations);
  for (const entry of readdirSync(
    path.join(sourcePrisma, "migrations"),
    { withFileTypes: true },
  )) {
    if (entry.name === excluded) continue;
    const sourceMigration = path.join(
      sourcePrisma,
      "migrations",
      entry.name,
    );
    const targetMigration = path.join(targetMigrations, entry.name);
    if (!entry.isDirectory()) {
      symlinkSync(sourceMigration, targetMigration);
      continue;
    }
    mkdirSync(targetMigration);
    for (const migrationEntry of readdirSync(sourceMigration)) {
      copyFileSync(
        path.join(sourceMigration, migrationEntry),
        path.join(targetMigration, migrationEntry),
      );
    }
  }

  cachedRoots.set(excluded, root);
  process.once("exit", () => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
