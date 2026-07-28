import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
} from "./direct-upload-authority-catalog.mjs";

export const DIRECT_UPLOAD_CLEANUP_ROLE =
  "grainline_direct_upload_cleanup_v2";

export const DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE = Object.freeze({
  admin_option: true,
  grantor_role: "cloud_admin",
  inherit_option: false,
  member_role: "neondb_owner",
  set_option: false,
});

export function hasReviewedDirectUploadCleanupMemberPosture({
  memberRoleEdges,
  memberRoles,
} = {}) {
  if (!Array.isArray(memberRoleEdges) || !Array.isArray(memberRoles)) {
    return false;
  }
  if (memberRoleEdges.length === 0) return memberRoles.length === 0;
  if (
    memberRoleEdges.length !== 1
    || memberRoles.length !== 1
    || memberRoles[0] !== DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE.member_role
  ) {
    return false;
  }
  const edge = memberRoleEdges[0];
  return Object.entries(DIRECT_UPLOAD_CLEANUP_BOOTSTRAP_ADMIN_EDGE)
    .every(([key, value]) => edge?.[key] === value);
}

export const DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES = Object.freeze([
  "grainline_direct_upload_cleanup_lease",
  "grainline_direct_upload_cleanup_complete",
  "grainline_direct_upload_cleanup_fail",
]);

const functionIdentityArguments = Object.freeze({
  grainline_direct_upload_actor_valid: "text",
  grainline_direct_upload_case_attachment_bind: "",
  grainline_direct_upload_case_attachment_reference_trigger: "",
  grainline_direct_upload_identity_immutable: "",
  grainline_direct_upload_message_url_core: "text, text",
  grainline_direct_upload_record_core:
    "text, text, text, text, text, integer, text, text, text",
  grainline_direct_upload_reference_core: "text, text, text",
  grainline_direct_upload_reference_guard: "",
  grainline_direct_upload_release_core: "text, text, text, text",
  grainline_direct_upload_release_source_core: "text[], text, text",
  grainline_direct_upload_source_delete_trigger: "",
  grainline_direct_upload_status_transition: "",
  grainline_direct_upload_sync_public_core:
    "text, text, text, text[], text[]",
  grainline_direct_upload_utc_now: "",
  grainline_direct_upload_record_processed_public:
    "text, text, text, text, text, integer",
  grainline_direct_upload_record_presigned_public:
    "text, text, text, text, text, integer",
  grainline_direct_upload_record_private_case:
    "text, text, text, text, integer",
  grainline_direct_upload_record_private_message:
    "text, text, text, text, integer",
  grainline_direct_upload_verify_public: "text, text, text",
  grainline_direct_upload_owned_lookup: "text, text",
  grainline_direct_upload_reference_case_attachment: "text, text",
  grainline_direct_upload_case_attachment_read: "text, text, text",
  grainline_direct_upload_cleanup_lease: "integer",
  grainline_direct_upload_cleanup_complete: "text, text",
  grainline_direct_upload_cleanup_fail: "text, text, text",
  grainline_direct_upload_export: "text",
  grainline_direct_upload_account_public_urls: "text",
  grainline_direct_upload_release_for_account: "text",
  grainline_direct_upload_sync_listing: "text, text",
  grainline_direct_upload_sync_seller_profile: "text, text",
  grainline_direct_upload_sync_review: "text, text",
  grainline_direct_upload_sync_blog_post: "text, text",
  grainline_direct_upload_sync_commission_request: "text, text",
  grainline_direct_upload_sync_seller_broadcast: "text, text",
  grainline_direct_upload_sync_legacy_message: "text, text",
});

export const DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES = Object.freeze([
  "grainline_direct_upload_identity_immutable",
  "grainline_direct_upload_message_url_core",
  "grainline_direct_upload_status_transition",
  "grainline_direct_upload_utc_now",
]);

const securityInvokerFunctions = new Set(
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
);

const cleanupFunctionNames = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);

export const DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES = Object.freeze(
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS
    .filter(
      (entry) =>
        entry.runtimeExecute
        && entry.name !== "grainline_direct_upload_record_private_message"
        && !cleanupFunctionNames.has(entry.name),
    )
    .map((entry) => entry.name),
);

export const DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES = Object.freeze(
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS
    .filter(
      (entry) =>
        !DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.includes(entry.name)
        && !cleanupFunctionNames.has(entry.name),
    )
    .map((entry) => entry.name),
);

export const DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES = Object.freeze(
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.map((entry) => entry.name),
);

const missingFunctionIdentities = DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES
  .filter((name) => !(name in functionIdentityArguments));
const extraFunctionIdentities = Object.keys(functionIdentityArguments)
  .filter((name) => !DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES.includes(name));
if (missingFunctionIdentities.length > 0 || extraFunctionIdentities.length > 0) {
  throw new Error(
    `DirectUpload activation function identity catalog drifted: missing=${missingFunctionIdentities.join(",") || "none"} extra=${extraFunctionIdentities.join(",") || "none"}`,
  );
}

export const DIRECT_UPLOAD_ACTIVATION_FUNCTIONS = Object.freeze(
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES.map((name) => Object.freeze({
    name,
    identityArguments: functionIdentityArguments[name],
    securityDefiner: !securityInvokerFunctions.has(name),
    runtimeExecute:
      DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.includes(name),
    cleanupExecute: cleanupFunctionNames.has(name),
  })),
);
