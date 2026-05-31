import sanitizeHtml from "sanitize-html";

export const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;
const NULL_BYTES = /\u0000/g;
const DANGEROUS_PROTOCOL_TEXT =
  /\b(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|f\s*i\s*l\s*e)\s*:/gi;
const EVENT_HANDLER_TEXT = /\bo\s*n\w+\s*=/gi;
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

export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_CHARS, "");
}

export function foldCyrillicConfusables(input: string): string {
  return input.replace(CYRILLIC_CONFUSABLE_CHARS, (char) => CYRILLIC_CONFUSABLES[char] ?? char);
}

export function normalizeUserText(input: string): string {
  return foldCyrillicConfusables(
    stripBidiControls(input.normalize("NFKC"))
      .replace(ZERO_WIDTH_CHARS, "")
      .replace(NULL_BYTES, ""),
  );
}

function stripHtmlTags(input: string): string {
  const output = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
  return output.replace(/&lt;|&gt;/gi, "").replace(/[<>]/g, "");
}

// Strip HTML tags and dangerous characters from user input
export function sanitizeText(input: string): string {
  return stripHtmlTags(normalizeUserText(input))
    .replace(DANGEROUS_PROTOCOL_TEXT, "") // strip dangerous protocols
    .replace(EVENT_HANDLER_TEXT, "") // strip event handlers
    .trim();
}

export function sanitizeUserName(input: string, maxLength = 100): string {
  return truncateText(sanitizeText(input).replace(/\s+/g, " "), maxLength).trim();
}

export function normalizeDisplayNameForLookup(input: string): string {
  return sanitizeUserName(input);
}

export function truncateText(input: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = Array.from(input);
  if (chars.length <= limit) return input;
  return chars.slice(0, limit).join("");
}

export function truncateTextWithEllipsis(input: string, maxLength: number): string {
  const truncated = truncateText(input, maxLength);
  return Array.from(input).length > Math.max(0, Math.floor(maxLength)) ? `${truncated}…` : truncated;
}

// For longer content (bio, description) — store plain text and strip any HTML.
// User text renders as React text nodes; do not preserve markup for a future
// dangerouslySetInnerHTML sink to accidentally trust.
export function sanitizeRichText(input: string): string {
  return stripHtmlTags(normalizeUserText(input))
    .replace(DANGEROUS_PROTOCOL_TEXT, "")
    .replace(EVENT_HANDLER_TEXT, "")
    .trim();
}
