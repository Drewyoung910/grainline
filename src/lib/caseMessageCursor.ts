export const CASE_MESSAGE_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 512;
const CASE_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/;

export type CaseMessageHistoryCursor = {
  createdAt: Date;
  id: string;
};

type CaseMessageCursorPayload = {
  d?: unknown;
  i?: unknown;
};

function validCursorDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildCaseMessageHistoryCursor(
  cursor: CaseMessageHistoryCursor,
) {
  const payload = JSON.stringify({
    d: cursor.createdAt.toISOString(),
    i: cursor.id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function parseCaseMessageHistoryCursor(
  raw: string | string[] | undefined,
): CaseMessageHistoryCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as CaseMessageCursorPayload;
    const createdAt = validCursorDate(decoded.d);
    if (
      createdAt
      && typeof decoded.i === "string"
      && CASE_MESSAGE_ID_PATTERN.test(decoded.i)
    ) {
      return { createdAt, id: decoded.i };
    }
  } catch {
    // Invalid cursors fall back to the latest bounded page.
  }
  return null;
}
