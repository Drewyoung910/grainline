import { codePointLength } from "./textLength.ts";

export const MAX_PUBLIC_CATALOG_TAG_CODE_POINTS = 24;

export function isPublicCatalogTagCandidate(value: unknown): value is string {
  return typeof value === "string"
    && codePointLength(value) >= 1
    && codePointLength(value) <= MAX_PUBLIC_CATALOG_TAG_CODE_POINTS;
}

export function hasInvalidPublicCatalogPriceRange(
  minimumCents: number | undefined,
  maximumCents: number | undefined,
) {
  return minimumCents !== undefined
    && maximumCents !== undefined
    && minimumCents > maximumCents;
}
