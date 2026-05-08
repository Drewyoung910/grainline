export function isLikelyBotUserAgent(userAgent: string) {
  return /\b(bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|headless)\b/i.test(userAgent);
}
