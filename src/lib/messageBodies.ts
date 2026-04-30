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

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return optionalString(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return optionalNumber(value);
}

export function parseFileMessageBody(raw: string): FileMessageBody | null {
  const obj = parseJsonRecord(raw);
  if (!obj || obj.kind !== "file" || typeof obj.url !== "string" || !obj.url.trim()) return null;
  return {
    kind: "file",
    url: obj.url,
    name: optionalNullableString(obj.name) ?? null,
    type: optionalNullableString(obj.type) ?? null,
  };
}

export function parseCommissionInterestMessageBody(raw: string): CommissionInterestMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    commissionId: optionalString(obj.commissionId),
    commissionTitle: optionalString(obj.commissionTitle),
    sellerName: optionalString(obj.sellerName),
    budgetMinCents: optionalNullableNumber(obj.budgetMinCents),
    budgetMaxCents: optionalNullableNumber(obj.budgetMaxCents),
    timeline: optionalNullableString(obj.timeline),
  };
}

export function parseCustomOrderRequestMessageBody(raw: string): CustomOrderRequestMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    description: optionalString(obj.description),
    dimensions: optionalNullableString(obj.dimensions),
    budget: optionalNullableNumber(obj.budget),
    timelineLabel: optionalNullableString(obj.timelineLabel),
    listingTitle: optionalNullableString(obj.listingTitle),
  };
}

export function parseCustomOrderLinkMessageBody(raw: string): CustomOrderLinkMessageBody {
  const obj = parseJsonRecord(raw);
  if (!obj) return {};
  return {
    listingId: optionalString(obj.listingId),
    title: optionalString(obj.title),
    priceCents: optionalNumber(obj.priceCents),
    currency: optionalString(obj.currency),
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
    body: obj.body,
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
