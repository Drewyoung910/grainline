export type AuditJsonValue =
  | null
  | string
  | number
  | boolean
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export const ACCOUNT_DELETION_AUDIT_REDACTION = "[deleted account]";
export const ACCOUNT_DELETION_TEXT_REDACTION = "[deleted account]";

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
    const normalized = value.toLowerCase();
    const shouldRedact = needles.some((needle) => normalized.includes(needle));
    return shouldRedact
      ? { value: ACCOUNT_DELETION_AUDIT_REDACTION, changed: true }
      : { value, changed: false };
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

export function redactAccountDeletionAuditMetadata(
  metadata: AuditJsonValue,
  sensitiveValues: Iterable<string | null | undefined>,
) {
  const needles = normalizeNeedles(sensitiveValues);
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
) {
  const needles = normalizeNeedles(sensitiveValues).filter((value) => value.length >= 3);
  if (needles.length === 0) return { text, changed: false };

  let redacted = text;
  for (const needle of needles.sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(needle), "gi"), replacement);
  }

  return { text: redacted, changed: redacted !== text };
}
