const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TOKEN_PATTERN = /\b(?:re_|rk_|sk_|pk_|whsec_|svix_|v1_|eyJ)[A-Za-z0-9._~+/=-]{12,}\b/g;
const LONG_HEX_PATTERN = /\b[a-f0-9]{32,}\b/gi;

export function sanitizeEmailOutboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(EMAIL_PATTERN, "[email]")
    .replace(URL_PATTERN, "[url]")
    .replace(TOKEN_PATTERN, "[token]")
    .replace(LONG_HEX_PATTERN, "[token]")
    .slice(0, 1000);
}
