export function listingPhotoReviewImageUrls(
  newUrls: readonly string[],
  existingUrls: readonly string[],
  limit = 4,
): string[] {
  const max = Math.max(0, Math.floor(limit));
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const url of [...newUrls, ...existingUrls]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= max) break;
  }

  return urls;
}
