export type NormalizedMessageAttachment = {
  url: string;
  name: string | null;
  type: string | null;
};

const MAX_MESSAGE_ATTACHMENTS = 6;
const MAX_ATTACHMENT_URL_LENGTH = 1000;
const MAX_ATTACHMENT_NAME_LENGTH = 200;
const MAX_ATTACHMENT_TYPE_LENGTH = 100;
const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

function sanitizeAttachmentText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
}

function normalizeOptionalField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = sanitizeAttachmentText(value).slice(0, maxLength).trim();
  return normalized || null;
}

export function normalizeMessageAttachments(
  raw: string,
  isAllowedUrl: (url: string) => boolean = () => false,
): NormalizedMessageAttachment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const attachments: NormalizedMessageAttachment[] = [];
  for (const item of parsed) {
    if (attachments.length >= MAX_MESSAGE_ATTACHMENTS) break;
    if (!item || typeof item !== "object") continue;

    const candidate = item as { url?: unknown; name?: unknown; type?: unknown };
    if (typeof candidate.url !== "string") continue;
    const url = candidate.url.trim();
    if (url.length > MAX_ATTACHMENT_URL_LENGTH || !isAllowedUrl(url)) continue;

    attachments.push({
      url,
      name: normalizeOptionalField(candidate.name, MAX_ATTACHMENT_NAME_LENGTH),
      type: normalizeOptionalField(candidate.type, MAX_ATTACHMENT_TYPE_LENGTH),
    });
  }

  return attachments;
}
