// Next passes string[] when a query key repeats (/browse?page=1&page=2). Page code
// expects one string, so the first value wins.
type RawParam = string | string[] | null | undefined;

function firstParam(raw: RawParam): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export function normalizeSearchQueryParameter(
  raw: RawParam,
  maxCharacters = Number.MAX_SAFE_INTEGER,
): string {
  const limit = Math.max(0, Math.floor(maxCharacters));
  const normalized = firstParam(raw)
    .normalize("NFKC")
    .replaceAll("\u0000", "")
    .trim();
  return Array.from(normalized).slice(0, limit).join("");
}

export function firstSearchParams<T extends object>(
  params: T,
): { [K in keyof T]: Exclude<T[K], string[]> | undefined } {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  ) as { [K in keyof T]: Exclude<T[K], string[]> | undefined };
}

export function parseBoundedPositiveIntParam(
  raw: RawParam,
  fallback: number,
  max: number,
): number {
  const value = firstParam(raw).trim();
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const DECIMAL_PARAM_PATTERN = /^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/;

export function parseBoundedDecimalParam(
  raw: RawParam,
  min: number,
  max: number,
): number | null {
  const value = firstParam(raw).trim();
  if (!DECIMAL_PARAM_PATTERN.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function parseTimestampMsParam(raw: RawParam): number | null {
  const value = firstParam(raw).trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const time = new Date(parsed).getTime();
  return Number.isNaN(time) ? null : time;
}
