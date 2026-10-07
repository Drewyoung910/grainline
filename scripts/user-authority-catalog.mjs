// Explicit reviewed source catalog. Availability is tied to each migration,
// rather than inferred from whatever functions happen to be installed.
const groups = [
  ["20261003100000_prepare_user_clerk_identity_authority", [
    ["grainline_user_clerk_account(text)", true],
    ["grainline_user_clerk_gate(text)", true],
    ["grainline_user_clerk_identity_ensure(text, text, text, boolean, text, boolean, text, boolean)", true],
  ]],
  ["20261003230000_prepare_user_current_clerk_authorities", [
    ["grainline_user_clerk_actor(text)", true],
    ["grainline_user_clerk_commission_context(text)", true],
  ]],
  ["20261004000000_prepare_user_clerk_provider_lifecycle", [
    ["grainline_user_clerk_lifecycle_state(text)", true],
    ["grainline_user_clerk_welcome_reserve(text, text)", true],
  ]],
  ["20261004010000_prepare_user_owner_private_authorities", [
    ["grainline_user_owner_shipping_address_update(text, text, text, text, text, text, text, text)", true],
    ["grainline_user_owner_legal_acceptance(text, text)", true],
    ["grainline_user_owner_notification_preference_update(text, text, boolean)", true],
  ]],
  ["20261004020000_prepare_user_signed_unsubscribe_authorities", [
    ["grainline_user_unsubscribe_token_superseded(text[], timestamp without time zone)", true],
    ["grainline_user_unsubscribe_preferences_disable(text[])", true],
  ]],
  ["20261004030000_prepare_user_email_delivery_authorities", [
    ["grainline_user_email_recipient(text, text)", true],
    ["grainline_user_email_recipient_batch(text[], text)", true],
    ["grainline_user_email_account_state_by_id(text, text)", true],
    ["grainline_user_email_account_state_by_email(text)", true],
  ]],
  ["20261004040000_prepare_user_public_member_aggregate", [
    ["grainline_user_public_active_member_count()", true],
  ]],
  ["20261004050000_prepare_user_public_seller_state", [
    ["grainline_seller_owner_public_state_bind()", false],
    ["grainline_user_public_seller_state_sync()", false],
  ]],
  ["20261006010000_prepare_user_staff_ban_authorities", [
    ["grainline_user_staff_directory_count(text, text)", false],
    ["grainline_user_staff_directory_page(text, text, integer)", false],
    ["grainline_user_staff_exact_email_target(text, text)", false],
    ["grainline_user_staff_report_labels(text, text[])", false],
    ["grainline_user_staff_email_recipient(text, text, text)", false],
    ["grainline_user_staff_ban_target(text, text)", false],
    ["grainline_user_staff_capability_mint(text, text, text, timestamp without time zone)", false],
    ["grainline_user_ban_repair_target(text, text)", false],
    ["grainline_user_staff_ban_apply(text, text, timestamp without time zone, text)", true],
    ["grainline_user_staff_unban_apply(text, text, timestamp without time zone)", true],
  ]],
  ["20261006020000_prepare_user_account_deletion_authorities", [
    ["grainline_user_provider_deleted_defer(text)", true],
    ["grainline_user_account_deletion_preflight(text)", true],
    ["grainline_user_account_deletion_snapshot(text)", true],
    ["grainline_user_account_deletion_finalize(text)", true],
  ]],
  ["20261006030000_prepare_user_relationship_authorities", [
    ["grainline_user_relationship_target_state(text, text)", true],
    ["grainline_user_conversation_participants(text, text)", true],
    ["grainline_user_custom_order_seller_state(text, text)", true],
    ["grainline_user_owner_notification_preferences(text)", true],
  ]],
  ["20261007030000_prepare_user_block_email_authorities", [
    ["grainline_user_block_targets()", true],
    ["grainline_user_blocked_account_page()", true],
    ["grainline_user_block_pair_lock(text)", true],
    ["grainline_user_email_fallback_addresses()", true],
  ]],
];

export const USER_AUTHORITY_GROUPS = Object.freeze(groups.map(([migration, entries]) => Object.freeze({
  migration,
  functions: Object.freeze(entries.map(([identity, runtimeExecute]) => Object.freeze({ identity, name: identity.slice(0, identity.indexOf("(")), runtimeExecute }))),
})));

export const USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES = Object.freeze(
  USER_AUTHORITY_GROUPS.find(({ migration }) => migration === "20261006010000_prepare_user_staff_ban_authorities")
    .functions.filter(({ runtimeExecute }) => !runtimeExecute).map(({ name }) => name),
);
