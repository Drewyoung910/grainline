import sanitizeHtml from "sanitize-html";

const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_CHARS, "");
}

export function normalizeUserText(input: string): string {
  return stripBidiControls(input.normalize("NFKC"));
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
    .replace(/\b(?:javascript|data|vbscript)\s*:/gi, '') // strip dangerous protocols
    .replace(/on\w+\s*=/gi, '') // strip event handlers
    .trim()
}

export function sanitizeUserName(input: string, maxLength = 100): string {
  return truncateText(sanitizeText(input).replace(/\s+/g, " "), maxLength).trim();
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
    .replace(/\b(?:javascript|data|vbscript)\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
}
