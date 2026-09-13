export type AccountFeedKind = "listing" | "blog" | "broadcast";

export type AccountFeedCursor = {
  date: Date;
  id: string | null;
  kind: AccountFeedKind | null;
  legacy: boolean;
};

export type AccountFeedCursorItem = {
  date: string;
  id?: string;
  kind: AccountFeedKind;
};

const KIND_RANK: Record<AccountFeedKind, number> = {
  listing: 0,
  blog: 1,
  broadcast: 2,
};

function isAccountFeedKind(value: unknown): value is AccountFeedKind {
  return value === "listing" || value === "blog" || value === "broadcast";
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildAccountFeedCursor(item: AccountFeedCursorItem) {
  if (!item.id) return item.date;
  const payload = JSON.stringify({ d: item.date, i: item.id, k: item.kind });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function parseAccountFeedCursor(raw: string | null): AccountFeedCursor | null {
  if (!raw) return null;

  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      d?: unknown;
      i?: unknown;
      k?: unknown;
    };
    const date = validDate(decoded.d);
    if (date && typeof decoded.i === "string" && isAccountFeedKind(decoded.k)) {
      return { date, id: decoded.i, kind: decoded.k, legacy: false };
    }
  } catch {
    // Fall through to legacy ISO cursor parsing.
  }

  const legacyDate = validDate(raw);
  return legacyDate ? { date: legacyDate, id: null, kind: null, legacy: true } : null;
}

export function compareAccountFeedItemsDesc(a: AccountFeedCursorItem, b: AccountFeedCursorItem) {
  const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (byDate !== 0) return byDate;

  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind;

  return (b.id ?? "").localeCompare(a.id ?? "");
}

export function isAccountFeedItemAfterCursor(item: AccountFeedCursorItem, cursor: AccountFeedCursor) {
  if (cursor.legacy || !cursor.id || !cursor.kind) return true;
  return compareAccountFeedItemsDesc(item, {
    date: cursor.date.toISOString(),
    id: cursor.id,
    kind: cursor.kind,
  }) > 0;
}

export function accountFeedCursorTieMode(kind: AccountFeedKind, cursor: AccountFeedCursor) {
  if (cursor.legacy || !cursor.kind || !cursor.id) return "none" as const;
  const kindRank = KIND_RANK[kind];
  const cursorRank = KIND_RANK[cursor.kind];
  if (kindRank > cursorRank) return "all" as const;
  if (kindRank === cursorRank) return "after-id" as const;
  return "none" as const;
}
