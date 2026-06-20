export const DIRECT_UPLOAD_STATUS = {
  PRESIGNED: "PRESIGNED",
  VERIFIED: "VERIFIED",
  CLAIMED: "CLAIMED",
  DELETING: "DELETING",
  DELETED: "DELETED",
  DELETE_FAILED: "DELETE_FAILED",
} as const;

export type DirectUploadStatus =
  (typeof DIRECT_UPLOAD_STATUS)[keyof typeof DIRECT_UPLOAD_STATUS];

export const DIRECT_UPLOAD_PRESIGNED_CLEANUP_MS = 2 * 60 * 60 * 1000;
export const DIRECT_UPLOAD_VERIFIED_CLEANUP_MS = 24 * 60 * 60 * 1000;
export const DIRECT_UPLOAD_CLEANUP_RETRY_MS = 30 * 60 * 1000;
export const DIRECT_UPLOAD_CLEANUP_BATCH_SIZE = 20;

export const DIRECT_UPLOAD_CLEANUP_STATUSES = [
  DIRECT_UPLOAD_STATUS.PRESIGNED,
  DIRECT_UPLOAD_STATUS.VERIFIED,
  DIRECT_UPLOAD_STATUS.DELETING,
  DIRECT_UPLOAD_STATUS.DELETE_FAILED,
] as const;

export function directUploadPresignedCleanupAfter(now = new Date()) {
  return new Date(now.getTime() + DIRECT_UPLOAD_PRESIGNED_CLEANUP_MS);
}

export function directUploadVerifiedCleanupAfter(now = new Date()) {
  return new Date(now.getTime() + DIRECT_UPLOAD_VERIFIED_CLEANUP_MS);
}

export function directUploadRetryCleanupAfter(now = new Date()) {
  return new Date(now.getTime() + DIRECT_UPLOAD_CLEANUP_RETRY_MS);
}

export function directUploadStatusIsClaimable(status: string) {
  return status === DIRECT_UPLOAD_STATUS.PRESIGNED || status === DIRECT_UPLOAD_STATUS.VERIFIED;
}

export function directUploadErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 1000);
}
