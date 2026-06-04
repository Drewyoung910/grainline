import { normalizeUserText, truncateText } from "./sanitize.ts";

export type SupportRequestKind = "support" | "data_request";

export type NormalizedSupportRequest = {
  kind: SupportRequestKind;
  name: string | null;
  email: string;
  topic: string;
  message: string;
  orderId: string | null;
  listingId: string | null;
};

type SupportRequestAccountExportWhere =
  | { userId: string }
  | { OR: Array<{ userId: string } | { email: { in: string[] } }> };

export const SUPPORT_REQUEST_EMAIL_PENDING_MARKER =
  "Notification email delivery is pending confirmation; check Sentry or email provider logs if this remains after intake.";
export const SUPPORT_REQUEST_CLOSURE_EVIDENCE_MIN_CHARS = 40;
export const SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS = 4000;

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

const DANGEROUS_BLOCK_TAGS = /<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const COMMON_HTML_TAGS = /<\/?(?:a|abbr|article|aside|b|blockquote|br|button|code|dd|div|dl|dt|em|fieldset|footer|form|h[1-6]|header|hr|i|img|input|label|li|main|nav|ol|option|p|pre|section|select|small|span|strong|table|tbody|td|textarea|tfoot|th|thead|tr|u|ul)[^>]*>/gi;
const SUPPORT_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function normalizeEmailAddress(email: string | null | undefined): string | null {
  const normalized = normalizeUserText(email ?? "").trim().normalize("NFC").toLowerCase();
  if (!normalized || EMAIL_CONTROL_CHARS.test(normalized) || !SUPPORT_EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeText(input: string): string {
  return normalizeUserText(input)
    .replace(DANGEROUS_BLOCK_TAGS, "")
    .replace(COMMON_HTML_TAGS, "")
    .replace(/[<>]/g, "")
    .replace(/\b(?:javascript|data|vbscript)\s*:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
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
    listingId?: unknown;
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
      listingId: cleanOptionalText(input.listingId, 80),
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

export function supportRequestAccountExportWhere(
  userId: string,
  accountEmails: readonly string[] | string | null,
): SupportRequestAccountExportWhere {
  let emails: string[];
  if (Array.isArray(accountEmails)) {
    emails = [...new Set(accountEmails.filter((email): email is string => Boolean(email)))];
  } else if (typeof accountEmails === "string" && accountEmails) {
    emails = [accountEmails];
  } else {
    emails = [];
  }
  if (emails.length === 0) return { userId };
  return { OR: [{ userId }, { email: { in: emails } }] };
}

export function supportRequestEmailNotificationState(input: {
  emailSentAt: Date | null;
  emailLastError: string | null;
}) {
  if (input.emailSentAt) {
    return { label: "Sent", tone: "success" as const, message: null };
  }
  if (input.emailLastError === SUPPORT_REQUEST_EMAIL_PENDING_MARKER) {
    return {
      label: "Needs review",
      tone: "warning" as const,
      message: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
    };
  }
  if (input.emailLastError) {
    return { label: "Failed", tone: "error" as const, message: `Email error: ${input.emailLastError}` };
  }
  return { label: "Pending", tone: "neutral" as const, message: null };
}

export function normalizeSupportRequestClosureEvidence(
  value: unknown,
): { ok: true; evidence: string } | { ok: false; error: string } {
  const evidence = cleanRequiredText(value, SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS);
  if (evidence.length < SUPPORT_REQUEST_CLOSURE_EVIDENCE_MIN_CHARS) {
    return { ok: false, error: "Add closure evidence before closing this data request." };
  }
  return { ok: true, evidence };
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
    ? `<tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Order ID</td><td style="padding:6px 0;">${esc(request.orderId)}</td></tr>`
    : "";
  const listingRow = request.listingId
    ? `<tr><td style="padding:6px 24px 6px 0;color:#6B6A66;">Listing ID</td><td style="padding:6px 0;">${esc(request.listingId)}</td></tr>`
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
    ${listingRow}
    ${slaRow}
  </table>
  <h2 style="font-size:16px;margin-top:24px;">Message</h2>
  <p style="white-space:pre-wrap;">${esc(request.message)}</p>
</body>
</html>`;
}
