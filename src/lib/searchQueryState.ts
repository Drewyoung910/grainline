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

// Search matches by substring, so "table" already finds "tables" but "tables"
// does not find "table". Add the likely other forms of a word: a small stand-in
// for real word stemming.
export function searchWordForms(word: string): string[] {
  const lower = word.toLowerCase();
  const forms = new Set([lower]);
  if (lower.endsWith("f")) forms.add(`${lower.slice(0, -1)}ves`);
  if (lower.endsWith("fe")) forms.add(`${lower.slice(0, -2)}ves`);
  if (lower.length < 4 || !lower.endsWith("s") || /(ss|us|is)$/.test(lower)) return [...forms];

  forms.add(lower.slice(0, -1));
  if (/(ch|sh|x|z|ss)es$/.test(lower)) forms.add(lower.slice(0, -2));
  if (lower.endsWith("ies")) forms.add(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ves")) {
    forms.add(`${lower.slice(0, -3)}f`);
    forms.add(`${lower.slice(0, -3)}fe`);
  }
  return [...forms];
}
