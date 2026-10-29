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
  [
    "20261023050000_correct_support_request_email_reuse_privacy",
    "9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1",
  ],
  [
    "20261025010000_prepare_email_delivery_ledger",
    "4d30e75337b9713bca643b4b4c5db1a247e913995448ea89e09929e4fba0405d",
  ],
  [
    "20261025020000_fence_email_provider_and_account_deletion",
    "4d30904d8cb094b403ef9adc4d4268f979d408137aeb228b59a95bca7858cace",
  ],
  [
    "20261025030000_fence_email_provider_and_eligibility_changes",
    "969aff03c7d720067d8a2d39057fed5048c12b60d521666aff7bce12ffd762e4",
  ],
  [
    "20261027010000_restore_resend_webhook_receipts",
    "a765482bfdeca66a82aaa912c5bfc2c6f7bc44b033fea4ace2e5bc40243ad2ba",
  ],
  [
    "20261028080000_activate_maker_verification_rls",
    "7868277f03b599768784c0f3a44a3c7bb28c8b64772a24f6183c538ec6f3401c",
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
