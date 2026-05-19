import { sanitizeText, truncateText } from "@/lib/sanitize";

export type NormalizedMessageAttachment = {
  url: string;
  name: string | null;
  type: string | null;
};

const MAX_MESSAGE_ATTACHMENTS = 6;
const MAX_ATTACHMENT_URL_LENGTH = 1000;
const MAX_ATTACHMENT_NAME_LENGTH = 200;
const MAX_ATTACHMENT_TYPE_LENGTH = 100;

function sanitizeAttachmentText(input: string): string {
  return sanitizeText(input);
}

function normalizeOptionalField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = truncateText(sanitizeAttachmentText(value), maxLength).trim();
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
