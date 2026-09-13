export type CountValue = bigint | number | string;

export type CaseAccountDeletionRedaction = {
  sideEffectId: string;
  userId: string;
  authoredMessagesRedacted: number;
  quotedMessagesRedacted: number;
  buyerDescriptionsRedacted: number;
  participantDescriptionsRedacted: number;
};

const REDACTION_KEYS = Object.freeze([
  "authoredMessagesRedacted",
  "buyerDescriptionsRedacted",
  "participantDescriptionsRedacted",
  "quotedMessagesRedacted",
  "sideEffectId",
  "userId",
]);

function requireBoundedId(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 191
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireSafeCount(value: unknown, label: string) {
  let count: number;
  if (typeof value === "bigint") {
    count = Number(value);
  } else if (
    typeof value === "number"
    || (typeof value === "string" && /^[0-9]+$/.test(value))
  ) {
    count = Number(value);
  } else {
    throw new TypeError(`${label} is invalid`);
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return count;
}

export function validateCaseAccountDeletionBlockerRows(
  rows: Array<{ count: CountValue }>,
) {
  if (
    rows.length !== 1
    || Object.keys(rows[0]).join(",") !== "count"
  ) {
    throw new TypeError(
      "Case account-deletion blocker authority returned an invalid shape",
    );
  }
  return requireSafeCount(
    rows[0].count,
    "Case account-deletion blocker count",
  );
}

export function validateCaseAccountDeletionRedactionRows(
  rows: unknown[],
  expected: { sideEffectId: string; userId: string },
): CaseAccountDeletionRedaction {
  const sideEffectId = requireBoundedId(
    expected.sideEffectId,
    "Case account-deletion side effect",
  );
  const userId = requireBoundedId(
    expected.userId,
    "Case account-deletion user",
  );
  if (
    rows.length !== 1
    || typeof rows[0] !== "object"
    || rows[0] === null
    || Array.isArray(rows[0])
  ) {
    throw new TypeError(
      "Case account-deletion redaction authority returned an invalid row",
    );
  }
  const row = rows[0] as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (
    keys.length !== REDACTION_KEYS.length
    || keys.some((key, index) => key !== REDACTION_KEYS[index])
  ) {
    throw new TypeError(
      "Case account-deletion redaction authority returned an invalid shape",
    );
  }
  const result = {
    sideEffectId: requireBoundedId(
      row.sideEffectId,
      "Case account-deletion returned side effect",
    ),
    userId: requireBoundedId(
      row.userId,
      "Case account-deletion returned user",
    ),
    authoredMessagesRedacted: requireSafeCount(
      row.authoredMessagesRedacted,
      "Case account-deletion authored-message count",
    ),
    quotedMessagesRedacted: requireSafeCount(
      row.quotedMessagesRedacted,
      "Case account-deletion quoted-message count",
    ),
    buyerDescriptionsRedacted: requireSafeCount(
      row.buyerDescriptionsRedacted,
      "Case account-deletion buyer-description count",
    ),
    participantDescriptionsRedacted: requireSafeCount(
      row.participantDescriptionsRedacted,
      "Case account-deletion participant-description count",
    ),
  };
  if (
    result.sideEffectId !== sideEffectId
    || result.userId !== userId
  ) {
    throw new TypeError(
      "Case account-deletion redaction authority identity drifted",
    );
  }
  return result;
}
