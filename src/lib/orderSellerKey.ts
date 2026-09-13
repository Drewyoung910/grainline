export function requireSingleOrderSellerProfileId(
  sellerProfileIds: readonly (string | null | undefined)[],
): string {
  if (
    sellerProfileIds.length === 0
    || sellerProfileIds.some(
      (value) => typeof value !== "string" || value.trim().length === 0,
    )
  ) {
    throw new Error("Order seller authority requires one complete seller id");
  }
  const unique = [...new Set(sellerProfileIds)];
  if (unique.length !== 1) {
    throw new Error("Order seller authority requires exactly one seller");
  }
  return unique[0] as string;
}
