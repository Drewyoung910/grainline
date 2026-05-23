import { sanitizeAIAltText } from "./aiReviewSafety.ts";

export interface AIReviewResult {
  approved: boolean;
  flags: string[];
  confidence: number;
  reason: string;
  altTexts?: string[];
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Converts the model response into the only shape callers are allowed to trust.
 * Missing or malformed moderation decisions fail closed, free-form strings are
 * bounded before persistence, confidence is clamped to 0..1, and alt text is
 * padded to the reviewed image count so photo backfill code cannot drift by
 * array index.
 */
export function normalizeAIReviewResult(raw: unknown, expectedAltTexts: number): AIReviewResult {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const flags = Array.isArray(value.flags)
    ? value.flags.filter((flag): flag is string => typeof flag === "string").map((flag) => truncateText(flag, 80)).slice(0, 20)
    : ["invalid-ai-response"];
  const rawConfidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
    ? value.confidence
    : 0;
  const altTexts = Array.isArray(value.altTexts)
    ? value.altTexts
        .filter((alt): alt is string => typeof alt === "string")
        .map((alt) => sanitizeAIAltText(alt))
        .filter(Boolean)
        .slice(0, expectedAltTexts)
    : [];
  while (altTexts.length < expectedAltTexts) {
    altTexts.push("Handmade woodworking product photo");
  }

  return {
    approved: typeof value.approved === "boolean" ? value.approved : false,
    flags,
    confidence: Math.max(0, Math.min(1, rawConfidence)),
    reason: typeof value.reason === "string" && value.reason.trim()
      ? truncateText(value.reason.replace(/\s+/g, " ").trim(), 500)
      : "AI review returned an invalid response",
    altTexts,
  };
}
