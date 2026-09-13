export const MAX_REVIEW_PHOTOS = 6;

export type AppendReviewPhotoStatus = "added" | "duplicate" | "limit" | "empty";

export function normalizeReviewPhotoUrls(urls: string[], maxPhotos = MAX_REVIEW_PHOTOS): string[] {
  const normalized: string[] = [];
  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url || normalized.includes(url)) continue;
    normalized.push(url);
    if (normalized.length >= maxPhotos) break;
  }
  return normalized;
}

export function appendReviewPhotoUrl(
  currentUrls: string[],
  nextUrl: string | null | undefined,
  maxPhotos = MAX_REVIEW_PHOTOS,
): { urls: string[]; status: AppendReviewPhotoStatus } {
  const current = normalizeReviewPhotoUrls(currentUrls, maxPhotos);
  const url = nextUrl?.trim() ?? "";
  if (!url) return { urls: current, status: "empty" };
  if (current.includes(url)) return { urls: current, status: "duplicate" };
  if (current.length >= maxPhotos) return { urls: current, status: "limit" };
  return { urls: [...current, url], status: "added" };
}
