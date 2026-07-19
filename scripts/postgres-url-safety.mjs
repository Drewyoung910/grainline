const REVIEWED_QUERY_PARAMETER_VALUES = new Map([
  ["sslmode", new Set(["verify-full"])],
  ["channel_binding", new Set(["require"])],
]);

export function assertReviewedPostgresConnectionParameters(parsed, label) {
  if (!(parsed instanceof URL)) {
    throw new TypeError("parsed must be a URL");
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string");
  }

  const seen = new Set();
  for (const [rawKey, value] of parsed.searchParams.entries()) {
    const key = rawKey.toLowerCase();
    if (rawKey !== key || seen.has(key)) {
      throw new Error(
        `${label} must not contain duplicate or case-variant connection parameters`,
      );
    }
    seen.add(key);

    const allowedValues = REVIEWED_QUERY_PARAMETER_VALUES.get(key);
    if (!allowedValues) {
      throw new Error(
        `${label} may contain only reviewed sslmode and channel_binding connection parameters`,
      );
    }
    if (!allowedValues.has(value.toLowerCase())) {
      if (key === "sslmode") {
        throw new Error(`${label} must use sslmode=verify-full`);
      }
      throw new Error(`${label} channel_binding must be absent or require`);
    }
  }

  if (!seen.has("sslmode")) {
    throw new Error(`${label} must use sslmode=verify-full`);
  }
}
