import { Prisma } from "@prisma/client";

export function isSerializableRetryError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }
  const err = error as { code?: string; message?: string };
  return err.code === "P2034" || err.code === "40001" || /could not serialize|serialization failure/i.test(err.message ?? "");
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isSerializableRetryError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}
