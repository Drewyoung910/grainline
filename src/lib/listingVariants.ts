type VariantOption = {
  id: string;
  label: string;
  priceAdjustCents: number;
  inStock: boolean;
};

type VariantGroup = {
  id: string;
  name: string;
  options: VariantOption[];
};

export const MIN_VARIANT_PRICE_ADJUST_CENTS = -10_000_000;
export const MAX_VARIANT_PRICE_ADJUST_CENTS = 10_000_000;
export const MIN_VARIANT_UNIT_PRICE_CENTS = 1;
export const MAX_VARIANT_UNIT_PRICE_CENTS = 10_000_000;

export type SelectedVariantSnapshot = {
  groupName: string;
  optionLabel: string;
  priceAdjustCents: number;
};

export type VariantResolution =
  | {
      ok: true;
      variantAdjustCents: number;
      variantKey: string;
      selectedVariantLabels: string[];
      selectedVariantsSnapshot: SelectedVariantSnapshot[];
    }
  | { ok: false; error: string };

export function resolveListingVariantSelection(
  variantGroups: VariantGroup[],
  selectedOptionIds: string[],
): VariantResolution {
  if (variantGroups.length === 0) {
    if (selectedOptionIds.length > 0) {
      return { ok: false, error: "This listing has no variants." };
    }
    return {
      ok: true,
      variantAdjustCents: 0,
      variantKey: "",
      selectedVariantLabels: [],
      selectedVariantsSnapshot: [],
    };
  }

  if (selectedOptionIds.length !== variantGroups.length) {
    return { ok: false, error: "Please select exactly one option from each variant group." };
  }

  const uniqueIds = new Set(selectedOptionIds);
  if (uniqueIds.size !== selectedOptionIds.length) {
    return { ok: false, error: "Please select each variant option only once." };
  }

  const selectedGroupIds = new Set<string>();
  let variantAdjustCents = 0;
  const selectedVariantLabels: string[] = [];
  const selectedVariantsSnapshot: SelectedVariantSnapshot[] = [];

  for (const optId of selectedOptionIds) {
    let selectedGroup: VariantGroup | null = null;
    let selectedOption: VariantOption | null = null;

    for (const group of variantGroups) {
      const option = group.options.find((o) => o.id === optId);
      if (option) {
        selectedGroup = group;
        selectedOption = option;
        break;
      }
    }

    if (!selectedGroup || !selectedOption) {
      return { ok: false, error: "Invalid variant option selected." };
    }

    if (selectedGroupIds.has(selectedGroup.id)) {
      return { ok: false, error: "Please select only one option from each variant group." };
    }

    if (!selectedOption.inStock) {
      return { ok: false, error: `Option "${selectedOption.label}" is out of stock.` };
    }

    selectedGroupIds.add(selectedGroup.id);
    variantAdjustCents += selectedOption.priceAdjustCents;
    selectedVariantLabels.push(selectedOption.label);
    selectedVariantsSnapshot.push({
      groupName: selectedGroup.name,
      optionLabel: selectedOption.label,
      priceAdjustCents: selectedOption.priceAdjustCents,
    });
  }

  if (selectedGroupIds.size !== variantGroups.length) {
    return { ok: false, error: "Please select exactly one option from each variant group." };
  }

  return {
    ok: true,
    variantAdjustCents,
    variantKey: [...selectedOptionIds].sort().join(","),
    selectedVariantLabels,
    selectedVariantsSnapshot,
  };
}

export function normalizeVariantPriceAdjustCents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed);
}

export function validateVariantPriceAdjustCents(value: number): string | null {
  if (!Number.isSafeInteger(value)) {
    return "Variant price adjustments must be whole cents.";
  }
  if (value < MIN_VARIANT_PRICE_ADJUST_CENTS || value > MAX_VARIANT_PRICE_ADJUST_CENTS) {
    return "Variant price adjustments cannot exceed $100,000.";
  }
  return null;
}

export function validateVariantGroupsForBasePrice(
  variantGroups: Array<{ options: Array<{ label: string; priceAdjustCents: number }> }>,
  basePriceCents: number,
): string | null {
  for (const group of variantGroups) {
    for (const option of group.options) {
      if (!option.label) continue;
      const priceAdjustError = validateVariantPriceAdjustCents(option.priceAdjustCents);
      if (priceAdjustError) return priceAdjustError;
    }
  }

  const groupsWithOptions = variantGroups
    .map((group) => group.options.filter((option) => option.label))
    .filter((options) => options.length > 0);
  if (groupsWithOptions.length === 0) return null;

  const minAdjustCents = groupsWithOptions.reduce(
    (sum, options) => sum + Math.min(...options.map((option) => option.priceAdjustCents)),
    0,
  );
  const maxAdjustCents = groupsWithOptions.reduce(
    (sum, options) => sum + Math.max(...options.map((option) => option.priceAdjustCents)),
    0,
  );
  if (basePriceCents + minAdjustCents < MIN_VARIANT_UNIT_PRICE_CENTS) {
    return "Variant price adjustments cannot reduce the final price below $0.01.";
  }
  if (basePriceCents + maxAdjustCents > MAX_VARIANT_UNIT_PRICE_CENTS) {
    return "Variant price adjustments cannot raise the final price above $100,000.";
  }
  return null;
}
