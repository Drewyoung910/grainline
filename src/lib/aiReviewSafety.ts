const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;
const NULL_BYTES = /\u0000/g;
const CYRILLIC_CONFUSABLES: Record<string, string> = {
  А: "A",
  а: "a",
  В: "B",
  Е: "E",
  е: "e",
  І: "I",
  і: "i",
  К: "K",
  к: "k",
  М: "M",
  Н: "H",
  О: "O",
  о: "o",
  Р: "P",
  р: "p",
  С: "C",
  с: "c",
  Т: "T",
  т: "t",
  У: "Y",
  у: "y",
  Х: "X",
  х: "x",
  Ј: "J",
  ј: "j",
};
const CYRILLIC_CONFUSABLE_CHARS = /[АаВЕеІіКкМНОоРрСсТтУуХхЈј]/g;

function normalizeAIReviewUserText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(NULL_BYTES, "")
    .replace(CYRILLIC_CONFUSABLE_CHARS, (char) => CYRILLIC_CONFUSABLES[char] ?? char);
}

function truncateText(input: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = Array.from(input);
  return chars.length <= limit ? input : chars.slice(0, limit).join("");
}

export function redactPromptInjection(value: string): string {
  const redacted = normalizeAIReviewUserText(value)
    .replace(/\b(ignore|disregard|forget|override|bypass|skip)\b/gi, "[redacted-command]")
    .replace(/\b(system|assistant|developer|user)\s*:/gi, "[redacted-role]:")
    .replace(/\b(approved|confidence|flags)\s*[:=]/gi, "[redacted-field]=")
    .replace(/```/g, "`\u200b``");
  return truncateText(redacted, 4000);
}

export function filterAIReviewImageUrls(
  urls: string[] | undefined,
  isAllowedUrl: (url: string) => boolean,
): string[] {
  // Cap matches the per-listing photo limit in `uploadRules.ts`
  // (`listingImage` UPLOAD_MAX_COUNTS = 10). Bumped 8 → 10 when the
  // photo cap was raised so AI review sees every photo and generates
  // alt text for the full set.
  return (urls ?? []).filter((url) => isAllowedUrl(url)).slice(0, 10);
}

export function normalizeDuplicateListingTitle(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "").trim();
}

export function sanitizeAIAltText(value: string): string {
  const sanitized = normalizeAIReviewUserText(value)
    .replace(/<[^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\bdata\s*:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(sanitized, 200);
}
