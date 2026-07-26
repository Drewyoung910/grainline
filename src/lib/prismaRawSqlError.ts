import { Prisma } from "@prisma/client";

/**
 * Returns PostgreSQL's SQLSTATE from a Prisma raw-query failure without
 * depending on provider error text. Non-raw-query and malformed errors remain
 * unclassified so callers fail loudly instead of guessing.
 */
export function getPrismaRawSqlState(error: unknown): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError)
    || error.code !== "P2010"
  ) {
    return null;
  }
  const sqlState = error.meta?.code;
  return typeof sqlState === "string" ? sqlState : null;
}
