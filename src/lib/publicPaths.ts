const MAX_SLUG_LENGTH = 80;
const ROUTE_ID_DELIMITER = "--";
const ROUTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;
const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

function stableHash(input: string): string {
  let hash = FNV_64_OFFSET;
  for (const char of input.trim()) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
  }
  return hash.toString(36);
}

export function slugifyPathSegment(input: string | null | undefined, fallbackPrefix = "item"): string {
  const raw = (input ?? "").trim();
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  if (slug) return slug;
  return `${fallbackPrefix}-${stableHash(raw || fallbackPrefix)}`;
}

export function routeSegmentWithSlug(id: string, label: string | null | undefined, fallbackPrefix: string): string {
  return `${id}${ROUTE_ID_DELIMITER}${slugifyPathSegment(label, fallbackPrefix)}`;
}

export function extractRouteId(segment: string): string {
  const delimiterIndex = segment.indexOf(ROUTE_ID_DELIMITER);
  const candidate = delimiterIndex >= 0 ? segment.slice(0, delimiterIndex) : segment;
  return ROUTE_ID_PATTERN.test(candidate) ? candidate : "";
}

export function publicListingPath(id: string, title?: string | null): string {
  return `/listing/${routeSegmentWithSlug(id, title, "listing")}`;
}

export function publicSellerPath(id: string, displayName?: string | null): string {
  return `/seller/${routeSegmentWithSlug(id, displayName, "maker")}`;
}

export function publicSellerShopPath(id: string, displayName?: string | null): string {
  return `${publicSellerPath(id, displayName)}/shop`;
}
