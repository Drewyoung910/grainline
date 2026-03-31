// Strip HTML tags and dangerous characters from user input
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/javascript:/gi, '') // strip JS protocol
    .replace(/on\w+\s*=/gi, '') // strip event handlers
    .trim()
}

// For longer content (bio, description) — allow basic formatting but strip dangerous content
export function sanitizeRichText(input: string): string {
  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // strip script tags
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '') // strip iframes
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
}
