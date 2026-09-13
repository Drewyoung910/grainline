export const UPLOAD_SERVICE_RETRY_AFTER_SECONDS = 60;

export type UploadServiceFailureKind = "presign" | "object-write";

export function uploadServiceFailure(kind: UploadServiceFailureKind) {
  return {
    body: {
      error:
        kind === "presign"
          ? "Upload signing is temporarily unavailable. Please try again."
          : "Upload storage is temporarily unavailable. Please try again.",
    },
    init: {
      status: 503,
      headers: {
        "Retry-After": String(UPLOAD_SERVICE_RETRY_AFTER_SECONDS),
      },
    },
  } as const;
}
