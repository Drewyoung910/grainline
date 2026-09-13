import { parseTimestampMsParam } from "./queryParams.ts";

const MESSAGE_CURSOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/;

export type MessageCursor = {
  createdAt: Date;
  id: string | null;
};

export function parseMessageCursor(
  timestampRaw: string | null | undefined,
  idRaw: string | null | undefined,
  options: { requireId?: boolean } = {},
): MessageCursor | null {
  const timestampMs = parseTimestampMsParam(timestampRaw);
  if (timestampMs === null) return null;

  const id = (idRaw ?? "").trim();
  if (id && !MESSAGE_CURSOR_ID_PATTERN.test(id)) return null;
  if (options.requireId && !id) return null;
  return { createdAt: new Date(timestampMs), id: id || null };
}

export function messageAfterCursorWhere(cursor: MessageCursor | null) {
  if (!cursor) return {};
  if (!cursor.id) return { createdAt: { gt: cursor.createdAt } };
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

export function messageBeforeCursorWhere(cursor: MessageCursor) {
  if (!cursor.id) throw new Error("Older-message pagination requires an id tie-breaker");
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
