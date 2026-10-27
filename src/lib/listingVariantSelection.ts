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
