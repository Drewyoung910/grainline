const MAX_SLUG_LENGTH = 80;
const ROUTE_ID_DELIMITER = "--";

function stableHash(input: string): string {
  let hash = 2166136261;
  for (const char of input.trim()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
  return segment.split(ROUTE_ID_DELIMITER, 1)[0] || segment;
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
