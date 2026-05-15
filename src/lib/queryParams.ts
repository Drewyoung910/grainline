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

export function parseTimestampMsParam(raw: string | null | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const time = new Date(parsed).getTime();
  return Number.isNaN(time) ? null : time;
}
