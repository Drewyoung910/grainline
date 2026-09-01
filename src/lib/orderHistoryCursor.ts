import type { OrderListCursor } from "@/lib/orderParticipantReadState";

const MAX_CURSOR_LENGTH = 512;
const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_PAGE = 1000;
const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

export type OrderHistoryDirection = "older" | "newer";

export type OrderHistoryCursor = Readonly<{
  direction: OrderHistoryDirection;
  page: number;
  boundary: OrderListCursor;
}>;

export function buildOrderHistoryCursor(value: OrderHistoryCursor) {
  if (
    (value.direction !== "older" && value.direction !== "newer")
    || !Number.isSafeInteger(value.page)
    || value.page < 1
    || value.page > MAX_PAGE
    || !Number.isSafeInteger(value.boundary.createdAtEpochMillis)
    || value.boundary.createdAtEpochMillis < 0
    || value.boundary.createdAtEpochMillis > MAX_EPOCH_MILLIS
    || !ORDER_ID_PATTERN.test(value.boundary.orderId)
  ) {
    throw new TypeError("Order history cursor is invalid");
  }
  return Buffer.from(JSON.stringify({
    v: 1,
    d: value.direction,
    p: value.page,
    t: value.boundary.createdAtEpochMillis,
    i: value.boundary.orderId,
  }), "utf8").toString("base64url");
}

export function parseOrderHistoryCursor(
  raw: string | string[] | undefined,
): OrderHistoryCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
    const record = decoded as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "d,i,p,t,v") return null;
    if (
      record.v !== 1
      || (record.d !== "older" && record.d !== "newer")
      || !Number.isSafeInteger(record.p)
      || Number(record.p) < 1
      || Number(record.p) > MAX_PAGE
      || !Number.isSafeInteger(record.t)
      || Number(record.t) < 0
      || Number(record.t) > MAX_EPOCH_MILLIS
      || typeof record.i !== "string"
      || !ORDER_ID_PATTERN.test(record.i)
    ) return null;
    return {
      direction: record.d,
      page: Number(record.p),
      boundary: {
        createdAtEpochMillis: Number(record.t),
        orderId: record.i,
      },
    };
  } catch {
    return null;
  }
}

export function orderListCursorFromRow(row: { id: string; createdAt: Date }): OrderListCursor {
  return { createdAtEpochMillis: row.createdAt.getTime(), orderId: row.id };
}
