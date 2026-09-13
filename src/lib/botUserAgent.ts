const BOT_USER_AGENT_PATTERN =
  /bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|headless|curl\/|wget\/|python-requests|go-http-client|axios\/|node-fetch|undici|scrapy|httpclient|libwww-perl|postmanruntime|java\/|okhttp\//i;

export function isLikelyBotUserAgent(userAgent: string | null | undefined) {
  const normalized = userAgent?.trim();
  if (!normalized) return true;

  return BOT_USER_AGENT_PATTERN.test(normalized);
}
