// Prisma's documented `migrate resolve --applied` path records a migration as
// finished without executing migration steps. Prisma treats
// `applied_steps_count` as deprecated, so an exact manually applied migration
// can legitimately have a zero step count. Keep this allowlist byte-pinned and
// narrow: arbitrary zero-step rows remain incomplete.

export const REVIEWED_MANUALLY_APPLIED_MIGRATIONS = new Map([
  [
    "20261023040000_repair_resend_failed_event_suppressions",
    "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8",
  ],
]);

export function isReviewedManuallyAppliedMigration(row) {
  const migrationName = String(row?.migration_name ?? "");
  const reviewedChecksum = REVIEWED_MANUALLY_APPLIED_MIGRATIONS.get(
    migrationName,
  );
  return reviewedChecksum !== undefined
    && row?.checksum === reviewedChecksum
    && row?.finished_at !== null
    && row?.finished_at !== undefined
    && row?.rolled_back_at === null
    && Number(row?.applied_steps_count) === 0;
}

export function isReviewedSuccessfulMigration(row) {
  return row?.finished_at !== null
    && row?.finished_at !== undefined
    && row?.rolled_back_at === null
    && (
      Number(row?.applied_steps_count) === 1
      || isReviewedManuallyAppliedMigration(row)
    );
}
