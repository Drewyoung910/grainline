export const commissionDomainPreparationMigrationPath =
  process.env.COMMISSION_DOMAIN_PREPARATION_MIGRATION_PATH?.trim() ||
  "prisma/migrations/20261113010000_prepare_commission_domain_authorities/migration.sql";
