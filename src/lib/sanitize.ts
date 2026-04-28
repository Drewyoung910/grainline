const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_CHARS, "");
}

export function normalizeUserText(input: string): string {
  return stripBidiControls(input.normalize("NFKC"));
}

// Strip HTML tags and dangerous characters from user input
export function sanitizeText(input: string): string {
  return normalizeUserText(input)
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/javascript:/gi, '') // strip JS protocol
    .replace(/on\w+\s*=/gi, '') // strip event handlers
    .trim()
}

export function sanitizeUserName(input: string, maxLength = 100): string {
  return sanitizeText(input)
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
}

// For longer content (bio, description) — allow basic formatting but strip dangerous content
export function sanitizeRichText(input: string): string {
  return normalizeUserText(input)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // strip script tags
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '') // strip iframes
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
}
