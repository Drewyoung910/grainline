// Prisma's documented `migrate resolve --applied` path records a migration as
// finished without executing migration steps. Prisma treats
// `applied_steps_count` as deprecated, so an exact manually applied migration
// can legitimately have a zero step count. Keep this allowlist byte-pinned and
// narrow: arbitrary zero-step rows remain incomplete.

export const REVIEWED_MANUALLY_APPLIED_MIGRATIONS = new Map([
  [
    "20261023010000_prepare_support_request_authorities",
    "c65e259df2bd476e2d265c8973fabbcf018b5f989b4b01a2ca923bb1013dc384",
  ],
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
    "20261026010000_prepare_stock_notification_authorities",
    "3c77aed31571f7e4adb942bea15611ee97d75e8183f76899cc634749ab2955ce",
  ],
  [
    "20261027010000_restore_resend_webhook_receipts",
    "a765482bfdeca66a82aaa912c5bfc2c6f7bc44b033fea4ace2e5bc40243ad2ba",
  ],
  [
    "20261027020000_correct_email_outbox_contracts",
    "b4b036b2a405be02706bf3506efdd29798851abe02a87d72ff3e78d1e4cc24d1",
  ],
  [
    "20261027030000_correct_email_eligibility_lock_order",
    "1c813a247b869b69f02b234e61c4177a4c15a18c941b123a94cf75324e3881aa",
  ],
  [
    "20261027040000_activate_stock_notification_rls",
    "c771b5c6caed905ce00515969e461a5f9de7c65b626d1eaa6c80916d4b6d7942",
  ],
  [
    "20261028010000_prepare_favorite_authorities",
    "d35ae9c5b2d90758d0f665bd246b60fe8fa8753cb10d5f8d72a6d573712b11e9",
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
