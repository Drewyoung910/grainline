export type SupportRequestKind = "support" | "data_request";

export type NormalizedSupportRequest = {
  kind: SupportRequestKind;
  name: string | null;
  email: string;
  topic: string;
  message: string;
  orderId: string | null;
};

const SUPPORT_TOPICS = new Set([
  "order",
  "account",
  "seller",
  "payment",
  "bug",
  "other",
]);

const DATA_REQUEST_TOPICS = new Set([
  "access",
  "delete",
  "correct",
  "portability",
  "opt_out",
  "appeal",
  "other",
]);

const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
const DANGEROUS_BLOCK_TAGS = /<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const COMMON_HTML_TAGS = /<\/?(?:a|abbr|article|aside|b|blockquote|br|button|code|dd|div|dl|dt|em|fieldset|footer|form|h[1-6]|header|hr|i|img|input|label|li|main|nav|ol|option|p|pre|section|select|small|span|strong|table|tbody|td|textarea|tfoot|th|thead|tr|u|ul)[^>]*>/gi;

function normalizeEmailAddress(email: string | null | undefined): string | null {
  const normalized = email?.trim().normalize("NFC").toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function sanitizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(DANGEROUS_BLOCK_TAGS, "")
    .replace(COMMON_HTML_TAGS, "")
    .replace(/[<>]/g, "")
    .replace(/\b(?:javascript|data|vbscript)\s*:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
}

function truncateText(input: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = Array.from(input);
  return chars.length <= limit ? input : chars.slice(0, limit).join("");
}

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = truncateText(sanitizeText(value), maxLength).trim();
  return cleaned || null;
}

function cleanRequiredText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? truncateText(sanitizeText(value), maxLength).trim() : "";
}

export function normalizeSupportRequest(
  kind: SupportRequestKind,
  input: {
    name?: unknown;
    email?: unknown;
    topic?: unknown;
    message?: unknown;
    orderId?: unknown;
  },
): { ok: true; request: NormalizedSupportRequest } | { ok: false; error: string } {
  const email = normalizeEmailAddress(typeof input.email === "string" ? input.email : "");
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const allowedTopics = kind === "data_request" ? DATA_REQUEST_TOPICS : SUPPORT_TOPICS;
  const topic = typeof input.topic === "string" && allowedTopics.has(input.topic)
    ? input.topic
    : "other";
  const message = cleanRequiredText(input.message, 4000);
  if (message.length < 10) return { ok: false, error: "Add a few details so we can help." };

  return {
    ok: true,
    request: {
      kind,
      name: cleanOptionalText(input.name, 100),
      email,
      topic,
      message,
      orderId: cleanOptionalText(input.orderId, 80),
    },
  };
}

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function supportRequestRecipient(kind: SupportRequestKind) {
  return kind === "data_request" ? "legal@thegrainline.com" : "support@thegrainline.com";
}

export function supportRequestStorageKind(kind: SupportRequestKind) {
  return kind === "data_request" ? "DATA_REQUEST" : "SUPPORT";
}

export function supportRequestSlaDueAt(createdAt = new Date()) {
  return new Date(createdAt.getTime() + 45 * 24 * 60 * 60 * 1000);
}

export function supportRequestSubject(request: NormalizedSupportRequest, requestId?: string) {
  const prefix = request.kind === "data_request" ? "Data request" : "Support request";
  const reference = requestId ? ` #${requestId}` : "";
  return `${prefix}${reference}: ${request.topic}`;
}

export function supportRequestHtml(
  request: NormalizedSupportRequest,
  context: { requestId?: string; slaDueAt?: Date } = {},
) {
  const title = supportRequestSubject(request, context.requestId);
  const orderRow = request.orderId
    ? `<tr><td style="padding:6px 0;color:#6B6A66;">Order/listing</td><td style="padding:6px 0;">${esc(request.orderId)}</td></tr>`
    : "";
  const requestRow = context.requestId
    ? `<tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Request ID</td><td style="padding:6px 0;">${esc(context.requestId)}</td></tr>`
    : "";
  const slaRow = context.slaDueAt
    ? `<tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">SLA due</td><td style="padding:6px 0;">${esc(context.slaDueAt.toISOString())}</td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1C1C1A;line-height:1.5;">
  <h1 style="font-size:20px;">${esc(title)}</h1>
  <table cellpadding="0" cellspacing="0" style="font-size:14px;">
    ${requestRow}
    <tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Name</td><td style="padding:6px 0;">${esc(request.name ?? "Not provided")}</td></tr>
    <tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Email</td><td style="padding:6px 0;">${esc(request.email)}</td></tr>
    <tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Topic</td><td style="padding:6px 0;">${esc(request.topic)}</td></tr>
    ${orderRow}
    ${slaRow}
  </table>
  <h2 style="font-size:16px;margin-top:24px;">Message</h2>
  <p style="white-space:pre-wrap;">${esc(request.message)}</p>
</body>
</html>`;
}
