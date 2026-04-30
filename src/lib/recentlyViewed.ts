// src/lib/recentlyViewed.ts
const COOKIE_KEY = "rv";
export const RECENTLY_VIEWED_USER_STORAGE_KEY = "grainline:recently-viewed:user";
const MAX_ITEMS = 10;
const EXPIRY_DAYS = 30;

export function normalizeRecentlyViewedIds(listingIds: unknown[]): string[] {
  return Array.from(new Set(
    listingIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  )).slice(0, MAX_ITEMS);
}

export function getRecentlyViewed(): string[] {
  if (typeof document === "undefined") return [];
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_KEY}=`));
  if (!match) return [];
  try {
    const raw = decodeURIComponent(match.slice(COOKIE_KEY.length + 1));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeRecentlyViewedIds(parsed) : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(listingId: string): void {
  if (typeof document === "undefined") return;
  const current = getRecentlyViewed().filter((id) => id !== listingId);
  const next = [listingId, ...current].slice(0, MAX_ITEMS);
  setRecentlyViewed(next);
}

export function setRecentlyViewed(listingIds: string[]): void {
  if (typeof document === "undefined") return;
  const next = normalizeRecentlyViewedIds(listingIds);
  const expires = new Date();
  expires.setDate(expires.getDate() + EXPIRY_DAYS);
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(JSON.stringify(next))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

export function clearRecentlyViewed(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

export function recentlyViewedAuthTransition({
  previousUserId,
  currentUserId,
}: {
  previousUserId: string | null;
  currentUserId: string | null;
}) {
  if (currentUserId) {
    return {
      shouldClear: Boolean(previousUserId && previousUserId !== currentUserId),
      nextUserId: currentUserId,
    };
  }

  return {
    shouldClear: Boolean(previousUserId),
    nextUserId: null,
  };
}
