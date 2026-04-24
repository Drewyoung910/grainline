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
