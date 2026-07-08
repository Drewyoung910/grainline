import type { Prisma } from "@prisma/client";

export const DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS = 10_000;
export const DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS = 5_000;
export const DB_USER_CONTEXT_USER_ID_MAX_LENGTH = 128;

export type DbUserContextTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

export function normalizeDbUserContextUserId(userId: string) {
  const normalized = userId.trim();
  if (
    normalized.length === 0 ||
    normalized.length > DB_USER_CONTEXT_USER_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new Error("RLS database user context requires a bounded local user id");
  }
  return normalized;
}

export function dbUserContextTransactionOptions(options: DbUserContextTransactionOptions = {}) {
  return {
    isolationLevel: options.isolationLevel,
    maxWait: options.maxWait ?? DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
    timeout: options.timeout ?? DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
  };
}
