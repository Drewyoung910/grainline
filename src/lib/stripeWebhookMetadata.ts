import type { SelectedVariantSnapshot } from "@/lib/listingVariants";

function truncateText(input: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = Array.from(input);
  return chars.length <= limit ? input : chars.slice(0, limit).join("");
}

export type SelectedVariantsMetadataResult =
  | { ok: true; selectedVariants: SelectedVariantSnapshot[] | undefined }
  | { ok: false; error: "invalid_json" | "not_array" | "invalid_shape"; metadataLength: number };

export function parseSelectedVariantsMetadata(raw: string | undefined): SelectedVariantsMetadataResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: true, selectedVariants: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_json", metadataLength: raw.length };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "not_array", metadataLength: raw.length };
  }

  const selectedVariants: SelectedVariantSnapshot[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "invalid_shape", metadataLength: raw.length };
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.groupName !== "string" ||
      typeof candidate.optionLabel !== "string" ||
      typeof candidate.priceAdjustCents !== "number" ||
      !Number.isFinite(candidate.priceAdjustCents)
    ) {
      return { ok: false, error: "invalid_shape", metadataLength: raw.length };
    }
    selectedVariants.push({
      groupName: truncateText(candidate.groupName, 50),
      optionLabel: truncateText(candidate.optionLabel, 50),
      priceAdjustCents: Math.round(candidate.priceAdjustCents),
    });
  }

  return { ok: true, selectedVariants: selectedVariants.length > 0 ? selectedVariants : undefined };
}
