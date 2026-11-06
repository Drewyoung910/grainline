type ListingVariantSelectionGroup = {
  options: ReadonlyArray<{
    id: string;
    inStock: boolean;
  }>;
};

export function isListingVariantSelectionComplete(
  groups: ReadonlyArray<ListingVariantSelectionGroup>,
  selectedOptionIds: ReadonlyArray<string>,
): boolean {
  if (groups.length === 0) return true;
  const selected = new Set(selectedOptionIds);
  return groups.every((group) =>
    group.options.some((option) => option.inStock && selected.has(option.id)),
  );
}

// Every group is required, so one with nothing in stock means nobody can buy.
export function hasSoldOutRequiredOption(
  groups: ReadonlyArray<ListingVariantSelectionGroup>,
): boolean {
  return groups.some((group) => group.options.every((option) => !option.inStock));
}
