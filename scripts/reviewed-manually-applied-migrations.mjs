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
    "b3b55a349b2bcdfb0059c5a661926714f7314e92b2d39ea5de94f3c07d385a27",
  ],
  [
    "20261028020000_prepare_follow_authorities",
    "3404910d8445d521df668b670c5fa2c57929c1df79bc4046383136454fc0fcc2",
  ],
  [
    "20261028030000_prepare_review_vote_authorities",
    "cf81df5bacf0f2ca8a87eaf043f4e0b5baf70ae39815b346b3402e17adf6557a",
  ],
  [
    "20261028040000_prepare_maker_verification_authorities",
    "7ea3956395dfb57b51110d93332c71f5251aaf49cc5292c6282f6c013a892fab",
  ],
  [
    "20261028050000_activate_favorite_rls",
    "e338d85fd1e2a124ce0a32cb755836f35c565ce4fabc374d0df4cdc07f9fb358",
  ],
  [
    "20261028060000_activate_follow_rls",
    "a2b8de8d2e6ad171b4eee951b32cbecdcf40999fcad85b1f1a72e8bab71007e2",
  ],
  [
    "20261028070000_activate_review_vote_rls",
    "0d9a9081354a199f0ead4744ca2b8782a5e370c5fe95013c796ffde6ced6ff6a",
  ],
  [
    "20261028080000_activate_maker_verification_rls",
    "7868277f03b599768784c0f3a44a3c7bb28c8b64772a24f6183c538ec6f3401c",
  ],
  [
    "20261030010000_prepare_block_authorities",
    "3bc49fc721e4bf8067f2222c9d47bc2e01c91d6ed93d7ed70fc25d5dd14251cb",
  ],
  [
    "20261030020000_prepare_user_report_authorities",
    "23a39d693ac959d3f1ca81dbb598752ee75d9f9adef90874082ec23693ca105a",
  ],
  [
    "20261030030000_prepare_seller_faq_authorities",
    "45cf9935bd9c6492a26ebc167dab20962395e1834f2191d293f0776597803e99",
  ],
  [
    "20261030040000_activate_block_rls",
    "cec9c1c6345225304fcae3b2d433ade6c73e1d6d98f0d461126390f7f0c29e73",
  ],
  [
    "20261030050000_activate_user_report_rls",
    "0c488a187a0f2389d32c2860f03e39d6a93dede288a9caf43483fe87c1f626fc",
  ],
  [
    "20261030060000_activate_seller_faq_rls",
    "d79661da61c150e893e927ea389afcaede307ad3c8b45b95977ce38e26634154",
  ],
  [
    "20261101010000_prepare_seller_broadcast_authorities",
    "2fd1b027f87e640b254d6be065a376777c5bf4eecb32fda6962d24126dbf7617",
  ],
  [
    "20261101080000_prepare_email_service_least_privilege",
    "1d231bf5df2652765a2f0c48509bc232d9976dc2a2a775a93900fe606616537a",
  ],
  [
    "20261101020000_narrow_service_reference_runtime_privileges",
    "5ae6d88826690ae5f0a653c02c87ae28fc76bb9f3609119402b2590594edbc6c",
  ],
  [
    "20261101030000_prepare_seller_analytics_daily_authorities",
    "f0f7c974d84e8132eb2271874f266db8ee94c9b80a7be421cba39ec70e95247d",
  ],
  [
    "20261101040000_activate_seller_analytics_daily_rls",
    "460aa8dacd516918af35f42fa041c533396b363a6384f9bf156400fa0d69206d",
  ],
  [
    "20261101050000_activate_seller_broadcast_rls",
    "9e71df11bc80f2acebc56b0148031943be07db45244c52e6236d4a2c88bf6990",
  ],
  [
    "20261101090000_activate_email_service_least_privilege",
    "380bb991461b9ff11d9b721615baafbc3d0d0d0dcc51f913381ab6d85cd3b564",
  ],
  [
    "20261102010000_prepare_admin_audit_log_authorities",
    "1895bb203781aabaf3c3efebc9419925415f6db639b5c9780d4865504b48ccc8",
  ],
  [
    "20261102020000_activate_admin_audit_log_rls",
    "5c56b89f5261ec9ed250a9ea1d93769a3350bb76a34af0e011aec9f08e948bd2",
  ],
  [
    "20261102030000_prepare_seller_metrics_authorities",
    "caad02ef9a93ae9d51e09c50ca7036b0f9ef5a047279dc082f6c72072652cae0",
  ],
  [
    "20261102040000_activate_seller_metrics_rls",
    "03cccab5eee60dbbe73f3e9204988409f8811b46a9dca1c50c4c8d7adc151772",
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
