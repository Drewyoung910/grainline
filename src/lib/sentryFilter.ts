import type { Breadcrumb, BreadcrumbHint, ErrorEvent, EventHint } from "@sentry/core";

const NOISY_PATTERNS = [
  /ResizeObserver loop/i,
  /AbortError/i,
  /The operation was aborted/i,
  /Load failed/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
];

const SECRET_KEY_PATTERN = /(authorization|cookie|set-cookie|email|ip[_-]?address|token|secret|password|api[_-]?key|session|clerk|stripe|resend)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TOKEN_QUERY_PATTERN = /(^|[?&\s])((?:token|signature|sig|code|session_id|client_secret)=)[^&\s,]+/gi;
const PROVIDER_TOKEN_PATTERN = /\b(?:acct_|ch_|cs_|cu_|evt_|in_|pi_|po_|re_|rk_|seti_|sk_|pk_|tr_|txn_|whsec_|svix_|v1_|eyJ)[A-Za-z0-9._~+/=-]{12,}\b/g;
const CUID_PATTERN = /\bc[a-z0-9]{24,}\b/g;
const LONG_HEX_PATTERN = /\b[a-f0-9]{32,}\b/gi;
const EMAIL_HASH_KEY_PATTERN = /(^|[_-])emailHash$/i;
const EMAIL_HASH_VALUE_PATTERN = /^sha256:[a-f0-9]{24}$/;
const IP_HEADER_PATTERN = /^(?:x-forwarded-for|forwarded|x-real-ip|cf-connecting-ip|true-client-ip)$/i;

function eventText(event: ErrorEvent, hint?: EventHint) {
  const exceptionValues = event.exception?.values?.map((value) => value.value).filter(Boolean).join(" ") ?? "";
  const originalException =
    hint?.originalException instanceof Error
      ? `${hint.originalException.name} ${hint.originalException.message}`
      : typeof hint?.originalException === "string"
        ? hint.originalException
        : "";
  return [event.message, exceptionValues, originalException].filter(Boolean).join(" ");
}

function isKnownBot(value: string) {
  return /\b(googlebot|bingbot|duckduckbot|slurp|baiduspider|yandexbot|spider|crawler|bot)\b/i.test(value);
}

function isBotStripeLoadFailure(event: ErrorEvent, text: string) {
  if (!/Failed to load Stripe\.js/i.test(text)) return false;

  const requestHeaders =
    event.request?.headers && typeof event.request.headers === "object"
      ? Object.values(event.request.headers as Record<string, string>).join(" ")
      : "";
  const tagText =
    event.tags && typeof event.tags === "object"
      ? Object.entries(event.tags as Record<string, unknown>)
          .map(([key, value]) => `${key}:${String(value)}`)
          .join(" ")
      : "";
  return isKnownBot(`${requestHeaders} ${tagText}`);
}

function scrubString(value: string, opts: { redactUrls?: boolean } = {}) {
  let scrubbed = value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(TOKEN_QUERY_PATTERN, "$1$2[redacted]");
  if (opts.redactUrls) scrubbed = scrubbed.replace(URL_PATTERN, "[redacted-url]");
  return scrubbed
    .replace(PROVIDER_TOKEN_PATTERN, "[redacted-token]")
    .replace(CUID_PATTERN, "[redacted-token]")
    .replace(LONG_HEX_PATTERN, "[redacted-token]");
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted-depth]";
  if (typeof value === "string") return scrubString(value, { redactUrls: true });
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const preserveHashedEmail = EMAIL_HASH_KEY_PATTERN.test(key) &&
      typeof child === "string" &&
      EMAIL_HASH_VALUE_PATTERN.test(child);
    out[key] = preserveHashedEmail ? child : SECRET_KEY_PATTERN.test(key) ? "[redacted]" : scrubValue(child, depth + 1);
  }
  return out;
}

function scrubHeaders(headers: Record<string, string>) {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) || IP_HEADER_PATTERN.test(key)
      ? "[redacted]"
      : scrubString(value, { redactUrls: true });
  }
  return scrubbed;
}

export function beforeSend(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  const text = eventText(event, hint);
  if (isBotStripeLoadFailure(event, text)) return null;
  if (NOISY_PATTERNS.some((pattern) => pattern.test(text))) return null;

  if (typeof event.message === "string") event.message = scrubString(event.message, { redactUrls: true });
  if (typeof event.transaction === "string") event.transaction = scrubString(event.transaction, { redactUrls: true });
  if (event.exception) event.exception = scrubValue(event.exception) as ErrorEvent["exception"];

  if (event.request) {
    if (event.request.headers) event.request.headers = scrubHeaders(event.request.headers);
    if (event.request.cookies) event.request.cookies = {};
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    } else if (Array.isArray(event.request.query_string)) {
      event.request.query_string = event.request.query_string.map(([key, value]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[redacted]" : scrubString(value),
      ]);
    }
    if (typeof event.request.url === "string") event.request.url = scrubString(event.request.url);
  }

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  if (event.extra) event.extra = scrubValue(event.extra) as ErrorEvent["extra"];
  if (event.contexts) event.contexts = scrubValue(event.contexts) as ErrorEvent["contexts"];
  if (event.tags) event.tags = scrubValue(event.tags) as ErrorEvent["tags"];

  return event;
}

export function beforeBreadcrumb(breadcrumb: Breadcrumb, _hint?: BreadcrumbHint): Breadcrumb | null {
  return scrubValue(breadcrumb) as Breadcrumb;
}
