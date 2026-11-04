import { sanitizeText } from "./sanitize.ts";
import { codePointLength } from "./textLength.ts";

export const MAX_LISTING_MATERIALS = 20;
export const MAX_LISTING_MATERIAL_CODE_POINTS = 100;

export type ListingMaterialsResult =
  | Readonly<{ ok: true; value: string[] }>
  | Readonly<{ ok: false; error: string }>;

export function parseListingMaterials(raw: string): ListingMaterialsResult {
  const materials = raw
    .split(",")
    .map((value) => sanitizeText(value).trim())
    .filter(Boolean);

  if (materials.length > MAX_LISTING_MATERIALS) {
    return {
      ok: false,
      error: `Add no more than ${MAX_LISTING_MATERIALS} materials.`,
    };
  }
  if (materials.some((value) => codePointLength(value) > MAX_LISTING_MATERIAL_CODE_POINTS)) {
    return {
      ok: false,
      error: `Each material must be ${MAX_LISTING_MATERIAL_CODE_POINTS} characters or fewer.`,
    };
  }
  return { ok: true, value: materials };
}
