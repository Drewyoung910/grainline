import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SOURCE_SUCCESSOR =
  "20260814053000_prepare_checkout_stock_reservation_source_consistency";

export function createSealedCheckoutStockReservationAuthorityRoot(
  sourceRoot = process.cwd(),
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-sealed-authority-"));
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
  for (const entry of fs.readdirSync(migrationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === SOURCE_SUCCESSOR) continue;
    const target = path.join(root, "prisma", "migrations", entry.name);
    fs.mkdirSync(target);
    fs.symlinkSync(
      path.join(migrationRoot, entry.name, "migration.sql"),
      path.join(target, "migration.sql"),
    );
  }

  return root;
}
