import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
} from "./direct-upload-authority-catalog.mjs";

export const DIRECT_UPLOAD_CLEANUP_ROLE =
  "grainline_direct_upload_cleanup";

export const DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES = Object.freeze([
  "grainline_direct_upload_cleanup_lease",
  "grainline_direct_upload_cleanup_complete",
  "grainline_direct_upload_cleanup_fail",
]);

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

