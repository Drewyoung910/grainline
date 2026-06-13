import sanitizeHtml from "sanitize-html";
import {
  normalizeUserText,
  stripBidiControls,
} from "./textNormalization.ts";

const DANGEROUS_PROTOCOL_TEXT =
  /\b(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|f\s*i\s*l\s*e)\s*:/gi;
const EVENT_HANDLER_TEXT = /\bo\s*n\w+\s*=/gi;

export { normalizeUserText, stripBidiControls };

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
