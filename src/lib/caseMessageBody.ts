import { sanitizeRichText } from "./sanitize.ts";
import { codePointLength } from "./textLength.ts";

export const CASE_MESSAGE_BODY_MAX_CODE_POINTS = 5_000;
export const CASE_MESSAGE_BODY_MAX_UTF8_BYTES = 20_000;
export const CASE_DESCRIPTION_BODY_MIN_CODE_POINTS = 20;
export const CASE_DESCRIPTION_BODY_MAX_CODE_POINTS = 2_000;
export const CASE_DESCRIPTION_BODY_MAX_UTF8_BYTES = 8_000;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isStoredCaseMessageBody(value: unknown): value is string {
  return typeof value === "string"
    && codePointLength(value) <= CASE_MESSAGE_BODY_MAX_CODE_POINTS
    && utf8ByteLength(value) <= CASE_MESSAGE_BODY_MAX_UTF8_BYTES;
}

export type NormalizedCaseMessageBody =
  | Readonly<{ ok: true; body: string }>
  | Readonly<{ ok: false; reason: "required" | "too_long" }>;

export type NormalizedCaseDescriptionBody =
  | Readonly<{ ok: true; body: string }>
  | Readonly<{
      ok: false;
      reason: "required" | "too_short" | "too_long";
    }>;

/**
 * Applies the same post-sanitization character and byte bounds enforced by the
 * Case reply authority. Checking only the submitted text is unsafe because
 * HTML entity normalization can expand the stored value.
 */
export function normalizeCaseMessageBody(
  value: string,
): NormalizedCaseMessageBody {
  const body = sanitizeRichText(value.trim());
  if (!body) return { ok: false, reason: "required" };
  if (!isStoredCaseMessageBody(body)) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, body };
}

/**
 * Mirrors grainline_case_open's stored description limits after applying the
 * same sanitizer used by the route. This keeps entity expansion and Unicode
 * code-point counting from surfacing as a generic database rejection.
 */
export function normalizeCaseDescriptionBody(
  value: string,
): NormalizedCaseDescriptionBody {
  const body = sanitizeRichText(value.trim());
  if (!body) return { ok: false, reason: "required" };
  const length = codePointLength(body);
  if (length < CASE_DESCRIPTION_BODY_MIN_CODE_POINTS) {
    return { ok: false, reason: "too_short" };
  }
  if (
    length > CASE_DESCRIPTION_BODY_MAX_CODE_POINTS
    || utf8ByteLength(body) > CASE_DESCRIPTION_BODY_MAX_UTF8_BYTES
  ) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, body };
}
