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
// does not find "table". Add the likely singular of a plural: a small stand-in
// for real word stemming. Forms are at least 3 letters ("ties" never gives "ty").
export function searchWordForms(word: string): string[] {
  const lower = word.toLowerCase();
  const forms = new Set([lower]);
  if (lower.length < 4 || !lower.endsWith("s") || /(ss|us|is)$/.test(lower)) return [...forms];

  forms.add(lower.slice(0, -1));
  if (/(ch|sh|x|z|ss)es$/.test(lower)) forms.add(lower.slice(0, -2));
  if (lower.length >= 5 && lower.endsWith("ies")) forms.add(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ves")) {
    forms.add(`${lower.slice(0, -3)}f`);
    forms.add(`${lower.slice(0, -3)}fe`);
  }
  return [...forms].filter((form) => form.length >= 3);
}

// Derived forms match titles and tags. Descriptions only match the typed word:
// they are long, so a short form like "sign" would match "design" there.
export function listingSearchWordConditions(words: string[]) {
  return words.flatMap((word) => {
    const forms = searchWordForms(word);
    return [
      ...forms.map((form) => ({ title: { contains: form, mode: "insensitive" as const } })),
      { description: { contains: word, mode: "insensitive" as const } },
      ...forms.map((form) => ({ tags: { has: form } })),
    ];
  });
}
