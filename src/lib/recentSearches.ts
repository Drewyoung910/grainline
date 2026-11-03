// Searches the visitor ran on this device, shown when the search box opens.
// Stored in the browser only and cleared on sign-out or a user switch through
// clearSignedOutLocalAccountState(), because a search can be personal.
const STORAGE_KEY = "grainline:recent-searches";
export const MAX_RECENT_SEARCHES = 5;
const MAX_RECENT_SEARCH_LENGTH = 80;

export type RecentSearchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(storage?: RecentSearchStorage | null): RecentSearchStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizeEntry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const entry = value.replace(/\s+/g, " ").trim();
  if (!entry) return null;
  return Array.from(entry).slice(0, MAX_RECENT_SEARCH_LENGTH).join("");
}

function normalizeList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    const entry = normalizeEntry(value);
    if (!entry || seen.has(entry.toLowerCase())) continue;
    seen.add(entry.toLowerCase());
    list.push(entry);
    if (list.length === MAX_RECENT_SEARCHES) break;
  }
  return list;
}

export function loadRecentSearches(storage?: RecentSearchStorage | null): string[] {
  try {
    const raw = resolveStorage(storage)?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeList(parsed) : [];
  } catch {
    return [];
  }
}

// Newest first. Searching for something already listed moves it to the front.
export function rememberRecentSearch(term: string, storage?: RecentSearchStorage | null): string[] {
  const next = normalizeList([term, ...loadRecentSearches(storage)]);
  try {
    resolveStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private windows and full storage: search still works without history.
  }
  return next;
}

export function clearRecentSearches(storage?: RecentSearchStorage | null): void {
  try {
    resolveStorage(storage)?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
