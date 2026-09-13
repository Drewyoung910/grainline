import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AUTHORITY_PREDECESSOR =
  "20260810190000_prepare_checkout_stock_reservation_authority";
const SOURCE_SUCCESSOR =
  "20260814053000_prepare_checkout_stock_reservation_source_consistency";

function createSealedRoot(sourceRoot, latestMigration, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, "prisma", "migrations"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });

  fs.symlinkSync(path.join(sourceRoot, "docs"), path.join(root, "docs"));
  fs.symlinkSync(
    path.join(sourceRoot, "prisma.config.ts"),
    path.join(root, "prisma.config.ts"),
  );
  fs.symlinkSync(
    path.join(sourceRoot, "src", "middleware.ts"),
    path.join(root, "src", "middleware.ts"),
  );

  const migrationRoot = path.join(sourceRoot, "prisma", "migrations");
  let latestMigrationFound = false;
  for (const entry of fs.readdirSync(migrationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name > latestMigration) continue;
    if (entry.name === latestMigration) latestMigrationFound = true;
    const target = path.join(root, "prisma", "migrations", entry.name);
    fs.mkdirSync(target);
    fs.symlinkSync(
      path.join(migrationRoot, entry.name, "migration.sql"),
      path.join(target, "migration.sql"),
    );
  }
  if (!latestMigrationFound) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`sealed migration prefix is missing ${latestMigration}`);
  }

  return root;
}

export function createSealedCheckoutStockReservationAuthorityRoot(
  sourceRoot = process.cwd(),
) {
  return createSealedRoot(
    sourceRoot,
    AUTHORITY_PREDECESSOR,
    "grainline-sealed-authority-",
  );
}

export function createSealedCheckoutStockReservationSourceConsistencyRoot(
  sourceRoot = process.cwd(),
) {
  return createSealedRoot(
    sourceRoot,
    SOURCE_SUCCESSOR,
    "grainline-sealed-source-consistency-",
  );
}
