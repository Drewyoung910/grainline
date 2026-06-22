import { sanitizeText, truncateText } from "./sanitize.ts";
import { isR2PublicUrl } from "./urlValidation.ts";

export type FileMessageBody = {
  kind: "file";
  url: string;
  name: string | null;
  type: string | null;
};

export type CommissionInterestMessageBody = {
  commissionId?: string;
  commissionTitle?: string;
  sellerName?: string;
  budgetMinCents?: number | null;
  budgetMaxCents?: number | null;
  timeline?: string | null;
};

export type CustomOrderRequestMessageBody = {
  description?: string;
  dimensions?: string | null;
  budget?: number | null;
  timelineLabel?: string | null;
  listingTitle?: string | null;
};

export type CustomOrderLinkMessageBody = {
  listingId?: string;
  title?: string;
  priceCents?: number;
  currency?: string;
};

export type ThreadMessageEventMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  kind?: string | null;
  isSystemMessage?: boolean | null;
  createdAt: string;
  readAt?: string | null;
};

const MAX_FILE_MESSAGE_URL_LENGTH = 1000;
const MAX_FILE_MESSAGE_NAME_LENGTH = 200;
const MAX_FILE_MESSAGE_TYPE_LENGTH = 100;
const MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH = 200;
const MAX_STRUCTURED_MESSAGE_BODY_LENGTH = 5000;
const MAX_STRUCTURED_MESSAGE_CURRENCY_LENGTH = 10;
const FILE_MESSAGE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalCleanNullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = truncateText(sanitizeText(value).replace(FILE_MESSAGE_CONTROL_CHARS, ""), maxLength).trim();
  return cleaned || null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return optionalNumber(value);
}

export function parseFileMessageBody(
  raw: string,
  isAllowedUrl: (url: string) => boolean = isR2PublicUrl,
): FileMessageBody | null {
  const obj = parseJsonRecord(raw);
  if (!obj || obj.kind !== "file" || typeof obj.url !== "string" || !obj.url.trim()) return null;
  const url = obj.url.trim();
  if (url.length > MAX_FILE_MESSAGE_URL_LENGTH || !isAllowedUrl(url)) return null;
  return {
    kind: "file",
    url,
    name: optionalCleanNullableString(obj.name, MAX_FILE_MESSAGE_NAME_LENGTH) ?? null,
    type: optionalCleanNullableString(obj.type, MAX_FILE_MESSAGE_TYPE_LENGTH) ?? null,
  };
}

export function parseCommissionInterestMessageBody(raw: string): CommissionInterestMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    commissionId: optionalString(obj.commissionId),
    commissionTitle: optionalCleanNullableString(obj.commissionTitle, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH) ?? undefined,
    sellerName: optionalCleanNullableString(obj.sellerName, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH) ?? undefined,
    budgetMinCents: optionalNullableNumber(obj.budgetMinCents),
    budgetMaxCents: optionalNullableNumber(obj.budgetMaxCents),
    timeline: optionalCleanNullableString(obj.timeline, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH),
  };
}

export function parseCustomOrderRequestMessageBody(raw: string): CustomOrderRequestMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    description: optionalCleanNullableString(obj.description, MAX_STRUCTURED_MESSAGE_BODY_LENGTH) ?? undefined,
    dimensions: optionalCleanNullableString(obj.dimensions, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH),
    budget: optionalNullableNumber(obj.budget),
    timelineLabel: optionalCleanNullableString(obj.timelineLabel, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH),
    listingTitle: optionalCleanNullableString(obj.listingTitle, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH),
  };
}

export function parseCustomOrderLinkMessageBody(raw: string): CustomOrderLinkMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    listingId: optionalString(obj.listingId),
    title: optionalCleanNullableString(obj.title, MAX_STRUCTURED_MESSAGE_SHORT_TEXT_LENGTH) ?? undefined,
    priceCents: optionalNumber(obj.priceCents),
    currency: optionalCleanNullableString(obj.currency, MAX_STRUCTURED_MESSAGE_CURRENCY_LENGTH) ?? undefined,
  };
}

function parseThreadMessage(value: unknown): ThreadMessageEventMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.senderId !== "string" ||
    typeof obj.recipientId !== "string" ||
    typeof obj.body !== "string" ||
    typeof obj.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: obj.id,
    senderId: obj.senderId,
    recipientId: obj.recipientId,
    body: optionalCleanNullableString(obj.body, MAX_STRUCTURED_MESSAGE_BODY_LENGTH) ?? "",
    kind: typeof obj.kind === "string" || obj.kind === null ? obj.kind : undefined,
    isSystemMessage: typeof obj.isSystemMessage === "boolean" || obj.isSystemMessage === null
      ? obj.isSystemMessage
      : undefined,
    createdAt: obj.createdAt,
    readAt: typeof obj.readAt === "string" || obj.readAt === null ? obj.readAt : undefined,
  };
}

export function parseThreadMessagesEvent(raw: string): ThreadMessageEventMessage[] | null {
  const obj = parseJsonRecord(raw);
  if (obj?.type !== "messages" || !Array.isArray(obj.messages)) return null;
  return obj.messages
    .map(parseThreadMessage)
    .filter((message): message is ThreadMessageEventMessage => Boolean(message));
}
