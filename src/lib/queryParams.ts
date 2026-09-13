export function parseBoundedPositiveIntParam(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  const value = (raw ?? "").trim();
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const DECIMAL_PARAM_PATTERN = /^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/;

export function parseBoundedDecimalParam(
  raw: string | null | undefined,
  min: number,
  max: number,
): number | null {
  const value = (raw ?? "").trim();
  if (!DECIMAL_PARAM_PATTERN.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function parseTimestampMsParam(raw: string | null | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const time = new Date(parsed).getTime();
  return Number.isNaN(time) ? null : time;
}
