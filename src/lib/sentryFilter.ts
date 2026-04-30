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
const TOKEN_QUERY_PATTERN = /(^|[?&])((?:token|signature|sig|code|session_id|client_secret)=)[^&\s]+/gi;

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

function scrubString(value: string) {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(TOKEN_QUERY_PATTERN, "$1$2[redacted]");
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[redacted-depth]";
  if (typeof value === "string") return scrubString(value);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : scrubValue(child, depth + 1);
  }
  return out;
}

function scrubHeaders(headers: Record<string, string>) {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return scrubbed;
}

export function beforeSend(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  const text = eventText(event, hint);
  if (NOISY_PATTERNS.some((pattern) => pattern.test(text))) return null;

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
