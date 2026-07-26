export const DIRECT_UPLOAD_AUTHORITY_FUNCTIONS = Object.freeze([
  { name: "grainline_direct_upload_actor_valid", runtimeExecute: false },
  { name: "grainline_direct_upload_identity_immutable", runtimeExecute: false },
  { name: "grainline_direct_upload_message_url_core", runtimeExecute: false },
  { name: "grainline_direct_upload_record_core", runtimeExecute: false },
  { name: "grainline_direct_upload_reference_core", runtimeExecute: false },
  { name: "grainline_direct_upload_reference_guard", runtimeExecute: false },
  { name: "grainline_direct_upload_release_core", runtimeExecute: false },
  { name: "grainline_direct_upload_release_source_core", runtimeExecute: false },
  { name: "grainline_direct_upload_source_delete_trigger", runtimeExecute: false },
  { name: "grainline_direct_upload_status_transition", runtimeExecute: false },
  { name: "grainline_direct_upload_sync_public_core", runtimeExecute: false },
  { name: "grainline_direct_upload_utc_now", runtimeExecute: false },
  {
    name: "grainline_direct_upload_record_processed_public",
    runtimeExecute: true,
  },
  {
    name: "grainline_direct_upload_record_presigned_public",
    runtimeExecute: true,
  },
  { name: "grainline_direct_upload_record_private_case", runtimeExecute: true },
  {
    name: "grainline_direct_upload_record_private_message",
    runtimeExecute: true,
  },
  { name: "grainline_direct_upload_verify_public", runtimeExecute: true },
  { name: "grainline_direct_upload_owned_lookup", runtimeExecute: true },
  {
    name: "grainline_direct_upload_reference_case_attachment",
    runtimeExecute: true,
  },
  {
    name: "grainline_direct_upload_case_attachment_read",
    runtimeExecute: true,
  },
  { name: "grainline_direct_upload_cleanup_lease", runtimeExecute: true },
  { name: "grainline_direct_upload_cleanup_complete", runtimeExecute: true },
  { name: "grainline_direct_upload_cleanup_fail", runtimeExecute: true },
  { name: "grainline_direct_upload_export", runtimeExecute: true },
  {
    name: "grainline_direct_upload_account_public_urls",
    runtimeExecute: true,
  },
  {
    name: "grainline_direct_upload_release_for_account",
    runtimeExecute: true,
  },
  { name: "grainline_direct_upload_sync_listing", runtimeExecute: true },
  {
    name: "grainline_direct_upload_sync_seller_profile",
    runtimeExecute: true,
  },
  { name: "grainline_direct_upload_sync_review", runtimeExecute: true },
  { name: "grainline_direct_upload_sync_blog_post", runtimeExecute: true },
  {
    name: "grainline_direct_upload_sync_commission_request",
    runtimeExecute: true,
  },
  {
    name: "grainline_direct_upload_sync_seller_broadcast",
    runtimeExecute: true,
  },
  {
    name: "grainline_direct_upload_sync_legacy_message",
    runtimeExecute: true,
  },
]);

export const DIRECT_UPLOAD_RUNTIME_FUNCTION_NAMES = Object.freeze(
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.filter((entry) => entry.runtimeExecute).map(
    (entry) => entry.name,
  ),
);

export const DIRECT_UPLOAD_PRIVATE_FUNCTION_NAMES = Object.freeze(
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.filter(
    (entry) => !entry.runtimeExecute,
  ).map((entry) => entry.name),
);
