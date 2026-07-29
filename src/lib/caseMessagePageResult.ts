export type CaseMessagePageAttachment = {
  id: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  createdAt: Date;
};

export type CaseMessagePageRow = {
  id: string;
  authorId: string;
  authorKind: "BUYER" | "SELLER" | "STAFF" | null;
  body: string;
  createdAt: Date;
  attachments: CaseMessagePageAttachment[];
};

const MESSAGE_KEYS = Object.freeze([
  "attachments",
  "authorId",
  "authorKind",
  "body",
  "createdAt",
  "id",
]);
const ATTACHMENT_KEYS = Object.freeze([
  "byteSize",
  "contentType",
  "createdAt",
  "id",
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const ABSOLUTE_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
) {
  if (!isRecord(value)) {
    throw new TypeError(`Case-message page ${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== keys.length
    || actual.some((key, index) => key !== keys[index])
  ) {
    throw new TypeError(`Case-message page ${label} has an invalid shape`);
  }
  return value;
}

function requireId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`Case-message page ${label} is invalid`);
  }
  return value;
}

function requireDate(value: unknown, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`Case-message page ${label} is invalid`);
  }
  return value;
}

function requireAbsoluteJsonDate(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || !ABSOLUTE_TIMESTAMP_PATTERN.test(value)
  ) {
    throw new TypeError(`Case-message page ${label} is invalid`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError(`Case-message page ${label} is invalid`);
  }
  return parsed;
}

function compareStable(
  left: { createdAt: Date; id: string },
  right: { createdAt: Date; id: string },
) {
  const time = left.createdAt.getTime() - right.createdAt.getTime();
  return time || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function validateAttachment(value: unknown): CaseMessagePageAttachment {
  const row = requireExactRecord(
    value,
    ATTACHMENT_KEYS,
    "attachment",
  );
  const contentType = row.contentType;
  if (
    contentType !== "image/jpeg"
    && contentType !== "image/png"
    && contentType !== "image/webp"
  ) {
    throw new TypeError(
      "Case-message page attachment content type is invalid",
    );
  }
  if (
    typeof row.byteSize !== "number"
    || !Number.isSafeInteger(row.byteSize)
    || row.byteSize < 1
    || row.byteSize > 8 * 1024 * 1024
  ) {
    throw new TypeError("Case-message page attachment byte size is invalid");
  }
  return {
    id: requireId(row.id, "attachment id"),
    contentType,
    byteSize: row.byteSize,
    createdAt: requireAbsoluteJsonDate(
      row.createdAt,
      "attachment timestamp",
    ),
  };
}

function validateMessage(value: unknown): CaseMessagePageRow {
  const row = requireExactRecord(value, MESSAGE_KEYS, "message");
  if (
    typeof row.body !== "string"
    || row.body.length > 5000
    || (
      row.authorKind !== null
      && row.authorKind !== "BUYER"
      && row.authorKind !== "SELLER"
      && row.authorKind !== "STAFF"
    )
  ) {
    throw new TypeError("Case-message page message fields are invalid");
  }
  if (!Array.isArray(row.attachments) || row.attachments.length > 4) {
    throw new TypeError("Case-message page attachments are invalid");
  }
  const attachments = row.attachments.map(validateAttachment);
  const attachmentIds = new Set<string>();
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (attachmentIds.has(attachment.id)) {
      throw new TypeError("Case-message page attachment ids are duplicated");
    }
    attachmentIds.add(attachment.id);
    if (
      index > 0
      && compareStable(attachments[index - 1], attachment) >= 0
    ) {
      throw new TypeError(
        "Case-message page attachment order is invalid",
      );
    }
  }
  return {
    id: requireId(row.id, "message id"),
    authorId: requireId(row.authorId, "author id"),
    authorKind: row.authorKind,
    body: row.body,
    createdAt: requireDate(row.createdAt, "message timestamp"),
    attachments,
  };
}

export function validateCaseMessagePageRows(
  value: unknown,
): CaseMessagePageRow[] {
  if (!Array.isArray(value) || value.length > 51) {
    throw new TypeError("Case-message page row count is invalid");
  }
  const rows = value.map(validateMessage);
  const messageIds = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (messageIds.has(row.id)) {
      throw new TypeError("Case-message page message ids are duplicated");
    }
    messageIds.add(row.id);
    if (index > 0 && compareStable(rows[index - 1], row) <= 0) {
      throw new TypeError("Case-message page message order is invalid");
    }
  }
  return rows;
}
