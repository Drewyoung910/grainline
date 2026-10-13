import path from "node:path";

const migrationRoot =
  process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR
  || "prisma/migrations";

export function sellerProfilePrivateMigrationPath(migration) {
  return path.join(migrationRoot, migration, "migration.sql");
}
