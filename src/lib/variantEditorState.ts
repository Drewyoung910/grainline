import { parseMoneyInputToCents } from "./money.ts";

export type VariantOptionData = {
  id?: string;
  label: string;
  priceAdjustCents: number;
  inStock: boolean;
  // What the maker typed. It lives on the option so it moves with the option
  // when another row is removed, and never lands on a different one.
  priceDraft?: string;
};

export type VariantGroupData = {
  id?: string;
  name: string;
  options: VariantOptionData[];
};

export function optionPriceCents(option: VariantOptionData): number {
  if (option.priceDraft === undefined) return option.priceAdjustCents || 0;
  if (option.priceDraft.trim() === "") return 0;
  return parseMoneyInputToCents(option.priceDraft, { allowNegative: true }) ?? 0;
}

export function serializeVariantGroups(groups: VariantGroupData[], isMadeToOrder: boolean) {
  return groups
    .filter((group) => group.name.trim() && group.options.some((option) => option.label.trim()))
    .map((group) => ({
      name: group.name.trim(),
      options: group.options
        .map((option) => ({
          label: option.label.trim(),
          priceAdjustCents: optionPriceCents(option),
          inStock: isMadeToOrder ? true : option.inStock,
        }))
        .filter((option) => option.label),
    }));
}
