export type CaseReplyAttachment = {
  id: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  createdAt: Date;
};

export type CaseReplyResult = {
  caseId: string;
  orderId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  messageId: string;
  authorUserId: string;
  authorKind: "BUYER" | "SELLER" | "STAFF";
  status: "OPEN" | "IN_DISCUSSION" | "PENDING_CLOSE" | "UNDER_REVIEW";
  actsAsStaff: boolean;
  createdAt: Date;
  attachments: CaseReplyAttachment[];
  action: "created" | "replay";
};

const RESULT_KEYS = Object.freeze([
  "action",
  "actsAsStaff",
  "attachments",
  "authorKind",
  "authorUserId",
  "buyerUserId",
  "caseId",
  "createdAt",
  "messageId",
  "orderId",
  "sellerUserId",
  "status",
]);
const ATTACHMENT_KEYS = Object.freeze([
  "byteSize",
  "contentType",
  "createdAt",
  "id",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  return value;
}

function requireBoundedString(value: unknown, label: string, max = 191) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireNullableBoundedString(value: unknown, label: string) {
  return value === null ? null : requireBoundedString(value, label);
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (
    typeof value !== "string"
    || !(allowed as readonly string[]).includes(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T[number];
}

function requireUuid(value: unknown, label: string) {
  const result = requireBoundedString(value, label);
  if (!UUID_PATTERN.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function requireUtcTimestamp(value: unknown, label: string) {
  if (typeof value !== "string" || !UTC_MILLISECOND_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime()) || result.toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function attachmentMetadataKey(
  attachment: { contentType: string; byteSize: number },
) {
  return `${attachment.contentType}\u0000${attachment.byteSize}`;
}

export function validateCaseReplyResult(
  value: unknown,
  expected: {
    actorUserId: string;
    caseId: string;
    attachments: readonly { contentType: string; byteSize: number }[];
  },
): CaseReplyResult {
  const row = requireExactRecord(value, RESULT_KEYS, "Case-reply result");
  if (!Array.isArray(row.attachments)) {
    throw new TypeError("Case-reply attachments are invalid");
  }

  const createdAt = requireUtcTimestamp(row.createdAt, "Case-reply timestamp");
  const attachments = row.attachments.map((value, index) => {
    const attachment = requireExactRecord(
      value,
      ATTACHMENT_KEYS,
      `Case-reply attachment ${index}`,
    );
    const byteSize = attachment.byteSize;
    if (
      !Number.isInteger(byteSize)
      || (byteSize as number) < 1
      || (byteSize as number) > 8_388_608
    ) {
      throw new TypeError(`Case-reply attachment ${index} byte size is invalid`);
    }
    const attachmentCreatedAt = requireUtcTimestamp(
      attachment.createdAt,
      `Case-reply attachment ${index} timestamp`,
    );
    if (attachmentCreatedAt.getTime() !== createdAt.getTime()) {
      throw new TypeError("Case-reply attachment timestamp drifted");
    }
    return {
      id: requireUuid(attachment.id, `Case-reply attachment ${index}`),
      contentType: requireOneOf(
        attachment.contentType,
        ["image/jpeg", "image/png", "image/webp"] as const,
        `Case-reply attachment ${index} content type`,
      ),
      byteSize: byteSize as number,
      createdAt: attachmentCreatedAt,
    };
  });

  if (
    attachments.length !== expected.attachments.length
    || new Set(attachments.map(({ id }) => id)).size !== attachments.length
  ) {
    throw new TypeError("Case-reply attachment identity drifted");
  }
  const actualMetadata = attachments.map(attachmentMetadataKey).sort();
  const expectedMetadata = expected.attachments
    .map(attachmentMetadataKey)
    .sort();
  if (
    actualMetadata.some(
      (metadata, index) => metadata !== expectedMetadata[index],
    )
  ) {
    throw new TypeError("Case-reply attachment metadata drifted");
  }

  if (typeof row.actsAsStaff !== "boolean") {
    throw new TypeError("Case-reply staff mode is invalid");
  }

  const result: CaseReplyResult = {
    caseId: requireBoundedString(row.caseId, "Case-reply Case"),
    orderId: requireBoundedString(row.orderId, "Case-reply Order"),
    buyerUserId: requireNullableBoundedString(
      row.buyerUserId,
      "Case-reply buyer",
    ),
    sellerUserId: requireBoundedString(row.sellerUserId, "Case-reply seller"),
    messageId: requireUuid(row.messageId, "Case-reply message"),
    authorUserId: requireBoundedString(
      row.authorUserId,
      "Case-reply author",
    ),
    authorKind: requireOneOf(
      row.authorKind,
      ["BUYER", "SELLER", "STAFF"] as const,
      "Case-reply author kind",
    ),
    status: requireOneOf(
      row.status,
      ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] as const,
      "Case-reply status",
    ),
    actsAsStaff: row.actsAsStaff,
    createdAt,
    attachments,
    action: requireOneOf(
      row.action,
      ["created", "replay"] as const,
      "Case-reply action",
    ),
  };

  if (
    result.caseId !== expected.caseId
    || result.authorUserId !== expected.actorUserId
    || result.buyerUserId === result.sellerUserId
  ) {
    throw new TypeError("Case-reply identity drifted");
  }

  const actorIsBuyer = result.authorUserId === result.buyerUserId;
  const actorIsSeller = result.authorUserId === result.sellerUserId;
  if (
    (actorIsBuyer
      && (result.authorKind !== "BUYER" || result.actsAsStaff))
    || (actorIsSeller
      && (result.authorKind !== "SELLER" || result.actsAsStaff))
    || (!actorIsBuyer
      && !actorIsSeller
      && (result.authorKind !== "STAFF" || !result.actsAsStaff))
    || (!result.actsAsStaff
      && !(["OPEN", "IN_DISCUSSION"] as string[]).includes(result.status))
  ) {
    throw new TypeError("Case-reply authority identity drifted");
  }
  return result;
}
