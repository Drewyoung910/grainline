const REVIEWED_QUERY_PARAMETER_VALUES = new Map([
  ["sslmode", new Set(["verify-full"])],
  ["channel_binding", new Set(["require"])],
]);

const REVIEWED_POSTGRES_PORT = "5432";

export function parseExactPostgresUrl(value, label) {
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string");
  }
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
  ) {
    throw new Error(
      `${label} must be a non-empty PostgreSQL URL without surrounding whitespace`,
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use the postgres/postgresql protocol`);
  }
  return parsed;
}

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
    if (!allowedValues.has(value)) {
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

function decodeCredentialPart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid URL encoding`);
  }
}

export function assertExplicitPostgresConnectionAuthority(parsed, label) {
  if (!(parsed instanceof URL)) {
    throw new TypeError("parsed must be a URL");
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string");
  }

  const username = decodeCredentialPart(parsed.username, `${label} username`);
  const password = decodeCredentialPart(parsed.password, `${label} password`);
  if (!parsed.hostname || !username || !password) {
    throw new Error(
      `${label} must include an explicit database host, username, and password`,
    );
  }
  if (parsed.port !== REVIEWED_POSTGRES_PORT) {
    throw new Error(`${label} must use explicit port ${REVIEWED_POSTGRES_PORT}`);
  }

  return Object.freeze({ username });
}

export function parseCanonicalPostgresDatabaseName(parsed, label) {
  if (!(parsed instanceof URL)) {
    throw new TypeError("parsed must be a URL");
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string");
  }
  if (parsed.hash) {
    throw new Error(`${label} must not contain a URL fragment`);
  }
  if (!/^\/[A-Za-z0-9_-]{1,63}$/.test(parsed.pathname)) {
    throw new Error(
      `${label} must name one unencoded, bounded database path segment`,
    );
  }
  return parsed.pathname.slice(1);
}

export function assertDeterministicPostgresEnvironment(env, label) {
  if (!env || typeof env !== "object") {
    throw new TypeError("env must be an object");
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new TypeError("label must be a non-empty string");
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error(
      `${label} must not disable TLS certificate verification through NODE_TLS_REJECT_UNAUTHORIZED`,
    );
  }
  if (typeof env.PGOPTIONS === "string" && env.PGOPTIONS.length > 0) {
    throw new Error(`${label} must not inherit session settings through PGOPTIONS`);
  }
}

export function postgresChannelBindingClientOptions(parsed) {
  if (!(parsed instanceof URL)) {
    throw new TypeError("parsed must be a URL");
  }
  return parsed.searchParams.get("channel_binding") === "require"
    ? Object.freeze({ enableChannelBinding: true })
    : Object.freeze({});
}
