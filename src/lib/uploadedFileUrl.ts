export type UploadedFileUrlLike = {
  url?: string | null;
  ufsUrl?: string | null;
  serverData?: {
    url?: string | null;
    ufsUrl?: string | null;
  } | null;
} | null | undefined;

export function uploadedFileUrl(file: unknown): string {
  const uploaded = file as UploadedFileUrlLike;
  return uploaded?.url ?? uploaded?.ufsUrl ?? uploaded?.serverData?.url ?? uploaded?.serverData?.ufsUrl ?? "";
}

export function uploadedFileUrls(files: unknown[] | null | undefined): string[] {
  return (files ?? []).map(uploadedFileUrl).filter(Boolean);
}
