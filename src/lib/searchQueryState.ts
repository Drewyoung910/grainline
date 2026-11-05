const NULL_BYTE = "\u0000";

export function searchParamsContainNullByte(searchParams: URLSearchParams): boolean {
  for (const [name, value] of searchParams) {
    if (name.includes(NULL_BYTE) || value.includes(NULL_BYTE)) return true;
  }
  return false;
}

export function normalizeSearchQueryParameter(
  value: string | string[] | null | undefined,
  maxCharacters = Number.MAX_SAFE_INTEGER,
): string {
  const limit = Math.max(0, Math.floor(maxCharacters));
  // Next passes string[] when a query key repeats; the first value wins.
  const normalized = ((Array.isArray(value) ? value[0] : value) ?? "")
    .normalize("NFKC")
    .replaceAll(NULL_BYTE, "")
    .trim();
  return Array.from(normalized).slice(0, limit).join("");
}
