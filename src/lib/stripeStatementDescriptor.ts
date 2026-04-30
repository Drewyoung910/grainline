const DEFAULT_STATEMENT_DESCRIPTOR_SUFFIX = "GRAINLINE";
const MAX_STATEMENT_DESCRIPTOR_SUFFIX_LENGTH = 22;

export function stripeStatementDescriptorSuffix(displayName: string | null | undefined) {
  const normalized = (displayName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STATEMENT_DESCRIPTOR_SUFFIX_LENGTH)
    .trim();

  return normalized || DEFAULT_STATEMENT_DESCRIPTOR_SUFFIX;
}
