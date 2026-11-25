import { createHash } from "node:crypto";

export type AuditJsonValue =
  | null
  | string
  | number
  | boolean
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export const ACCOUNT_DELETION_AUDIT_REDACTION = "[deleted account]";
export const ACCOUNT_DELETION_TEXT_REDACTION = "[deleted account]";

export type AuditJsonPatch = {
  path: string[];
  value: AuditJsonValue;
};

export type AuditTextPatch = {
  expectedSha256: string;
  length: number;
  replacement: string;
};

function auditJsonValuesEqual(left: AuditJsonValue, right: AuditJsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => auditJsonValuesEqual(value, right[index] as AuditJsonValue));
  }
  if (
    left && right
    && typeof left === "object" && typeof right === "object"
    && !Array.isArray(left) && !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every(
        (key) => Object.hasOwn(right, key)
          && auditJsonValuesEqual(left[key] as AuditJsonValue, right[key] as AuditJsonValue),
      );
  }
  return false;
}

export function buildAccountDeletionAuditJsonPatches(
  before: AuditJsonValue,
  after: AuditJsonValue,
  path: string[] = [],
): AuditJsonPatch[] {
  if (auditJsonValuesEqual(before, after)) return [];

  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((value, index) =>
      buildAccountDeletionAuditJsonPatches(value, after[index] as AuditJsonValue, [
        ...path,
        String(index),
      ]));
  }

  if (
    before && after
    && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)
  ) {
    return Object.entries(after).flatMap(([key, value]) => {
      if (!Object.hasOwn(before, key)) return [{ path: [...path, key], value }];
      return buildAccountDeletionAuditJsonPatches(
        before[key] as AuditJsonValue,
        value,
        [...path, key],
      );
    });
  }

  return [{ path, value: after }];
}

function normalizeNeedles(values: Iterable<string | null | undefined>) {
  const seen = new Set<string>();
  return [...values]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function redactValue(
  value: AuditJsonValue,
  needles: string[],
): { value: AuditJsonValue; changed: boolean } {
  if (typeof value === "string") {
    const redacted = redactTextWithNeedles(
      value,
      needles,
      ACCOUNT_DELETION_AUDIT_REDACTION,
    );
    return { value: redacted, changed: redacted !== value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const redacted = value.map((item) => {
      const result = redactValue(item, needles);
      changed ||= result.changed;
      return result.value;
    });
    return { value: redacted, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const redacted: Record<string, AuditJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = redactValue(item, needles);
      changed ||= result.changed;
      redacted[key] = result.value;
    }
    if (changed) redacted.redactedForAccountDeletion = true;
    return { value: redacted, changed };
  }

  return { value, changed: false };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactionPatternForNeedle(needle: string) {
  const escaped = escapeRegExp(needle);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
}

function redactTextWithNeedles(text: string, needles: string[], replacement: string) {
  let redacted = text;
  for (const needle of needles.sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(redactionPatternForNeedle(needle), replacement);
  }
  return redacted;
}

function textRedactionPatches(
  text: string,
  needles: string[],
  replacement: string,
): AuditTextPatch[] {
  const matches = new Map<string, AuditTextPatch>();
  for (const needle of needles.sort((a, b) => b.length - a.length)) {
    for (const match of text.matchAll(redactionPatternForNeedle(needle))) {
      const matched = match[0];
      const expectedSha256 = createHash("sha256").update(matched).digest("hex");
      matches.set(`${expectedSha256}:${Array.from(matched).length}`, {
        expectedSha256,
        length: Array.from(matched).length,
        replacement,
      });
    }
  }
  return [...matches.values()];
}

export function redactAccountDeletionAuditMetadata(
  metadata: AuditJsonValue,
  sensitiveValues: Iterable<string | null | undefined>,
) {
  const needles = normalizeNeedles(sensitiveValues).filter((value) => Array.from(value).length >= 2);
  if (needles.length === 0) return { metadata, changed: false };

  const result = redactValue(metadata, needles);
  return { metadata: result.value, changed: result.changed };
}

export function markAccountDeletionAuditMetadata(metadata: AuditJsonValue) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    if ((metadata as Record<string, AuditJsonValue>).redactedForAccountDeletion === true) {
      return { metadata, changed: false };
    }
    return {
      metadata: { ...metadata, redactedForAccountDeletion: true },
      changed: true,
    };
  }

  return {
    metadata: {
      value: metadata,
      redactedForAccountDeletion: true,
    },
    changed: true,
  };
}

export function redactAccountDeletionText(
  text: string,
  sensitiveValues: Iterable<string | null | undefined>,
  replacement = ACCOUNT_DELETION_TEXT_REDACTION,
  maxLength?: number,
) {
  if (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < 1)) {
    throw new TypeError("maxLength must be a positive integer");
  }
  const needles = normalizeNeedles(sensitiveValues).filter((value) => Array.from(value).length >= 2);
  if (needles.length === 0) {
    const bounded = maxLength === undefined
      ? text
      : Array.from(text).slice(0, maxLength).join("");
    return { text: bounded, changed: bounded !== text, patches: [] };
  }

  const redacted = redactTextWithNeedles(text, needles, replacement);

  const bounded = maxLength === undefined
    ? redacted
    : Array.from(redacted).slice(0, maxLength).join("");
  return {
    text: bounded,
    changed: bounded !== text,
    patches: bounded !== text
      ? textRedactionPatches(text, needles, replacement)
      : [],
  };
}
