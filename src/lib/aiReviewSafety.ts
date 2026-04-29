const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;
const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
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

export function redactPromptInjection(value: string): string {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(/[АаВЕеІіКкМНОоРрСсТтУуХхЈј]/g, (char) => CYRILLIC_CONFUSABLES[char] ?? char)
    .replace(/\b(ignore|disregard|forget|override|bypass|skip)\b/gi, "[redacted-command]")
    .replace(/\b(system|assistant|developer|user)\s*:/gi, "[redacted-role]:")
    .replace(/\b(approved|confidence|flags)\s*[:=]/gi, "[redacted-field]=")
    .replace(/```/g, "`\u200b``")
    .slice(0, 4000);
}

export function filterAIReviewImageUrls(
  urls: string[] | undefined,
  isAllowedUrl: (url: string) => boolean,
): string[] {
  return (urls ?? []).filter((url) => isAllowedUrl(url)).slice(0, 4);
}

export function sanitizeAIAltText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\bdata\s*:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
