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

// The browser check for the price box. It accepts what parseVariantPrice
// reads: an optional sign, an optional "$", and "1,250.00" style commas.
// The hyphen is escaped because Chrome compiles patterns with the v flag.
export const VARIANT_PRICE_INPUT_PATTERN =
  String.raw`[+\-]?\$?((\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?|\.\d{1,2})`;

const THOUSANDS_GROUPED = /^\d{1,3}(,\d{3})+(\.\d*)?$/;

function parseVariantPrice(text: string): number | null {
  let value = text.trim();
  const sign = value.startsWith("+") || value.startsWith("-") ? value[0] : "";
  value = value.slice(sign.length);
  if (value.startsWith("$")) value = value.slice(1);
  if (value.startsWith("+") || value.startsWith("-")) return null;
  if (THOUSANDS_GROUPED.test(value)) value = value.replaceAll(",", "");
  return parseMoneyInputToCents(sign + value, { allowNegative: true });
}

export function isVariantPriceDraftInvalid(option: VariantOptionData): boolean {
  const draft = option.priceDraft;
  return draft !== undefined && draft.trim() !== "" && parseVariantPrice(draft) === null;
}

export function optionPriceCents(option: VariantOptionData): number {
  if (option.priceDraft === undefined) return option.priceAdjustCents || 0;
  if (option.priceDraft.trim() === "") return 0;
  return parseVariantPrice(option.priceDraft) ?? 0;
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
