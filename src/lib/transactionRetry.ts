import { Prisma } from "@prisma/client";

export function isSerializableRetryError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }
  const err = error as { code?: string; message?: string };
  return err.code === "P2034" || err.code === "40001" || /could not serialize|serialization failure/i.test(err.message ?? "");
}

export function isTransactionRetryError(error: unknown) {
  if (isSerializableRetryError(error)) return true;
  const err = error as { code?: string; message?: string };
  return err.code === "40P01" || /deadlock detected/i.test(err.message ?? "");
}

async function withRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  attempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function withTransactionRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
) {
  return withRetry(operation, isTransactionRetryError, attempts);
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
) {
  return withRetry(operation, isSerializableRetryError, attempts);
}
