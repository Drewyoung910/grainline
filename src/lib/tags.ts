export const MAX_TAG_LENGTH = 24;
export const DEFAULT_MAX_TAGS = 10;

const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function normalizeTag(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s_-]+/gu, " ")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/g, "");
}

export function normalizeTags(values: Iterable<string>, max = DEFAULT_MAX_TAGS): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    tags.add(tag);
    if (tags.size >= max) break;
  }
  return [...tags];
}
