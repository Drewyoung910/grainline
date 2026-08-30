type PrismaKnownRawQueryError = {
  name: "PrismaClientKnownRequestError";
  code: "P2010";
  clientVersion: string;
  meta: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrismaKnownRawQueryError(
  error: unknown,
): error is PrismaKnownRawQueryError {
  return isRecord(error)
    && error.name === "PrismaClientKnownRequestError"
    && error.code === "P2010"
    && typeof error.clientVersion === "string"
    && error.clientVersion.length > 0
    && isRecord(error.meta);
}

function isSqlState(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value);
}

function getPostgresAdapterSqlState(meta: Record<string, unknown>): string | null {
  const driverAdapterError = meta.driverAdapterError;
  if (!isRecord(driverAdapterError)
    || driverAdapterError.name !== "DriverAdapterError"
    || !isRecord(driverAdapterError.cause)
    || driverAdapterError.cause.kind !== "postgres") {
    return null;
  }

  const sqlState = driverAdapterError.cause.originalCode;
  return isSqlState(sqlState) ? sqlState : null;
}

/**
 * Returns PostgreSQL's SQLSTATE from a Prisma raw-query failure without
 * depending on provider error text. Use Prisma's stable public error shape
 * instead of `instanceof`: a server bundle can contain more than one copy of
 * the Prisma runtime class, and a genuine error from one copy is not an
 * instance of the other. Non-raw-query and malformed errors remain
 * unclassified so callers fail loudly instead of guessing.
 */
export function getPrismaRawSqlState(error: unknown): string | null {
  if (!isPrismaKnownRawQueryError(error)) return null;
  const legacySqlState = error.meta.code;
  if (isSqlState(legacySqlState)) return legacySqlState;

  // Prisma's JavaScript driver adapters preserve PostgreSQL's SQLSTATE below
  // the exact DriverAdapterError cause instead of the legacy `meta.code`
  // field. Keep this structural path narrow: P2010 + PostgreSQL adapter + a
  // valid five-character SQLSTATE. Never infer authority failures from text.
  return getPostgresAdapterSqlState(error.meta);
}
