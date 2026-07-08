import type { Prisma } from "@prisma/client";

export const DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS = 10_000;
export const DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS = 5_000;
export const DB_USER_CONTEXT_USER_ID_MAX_LENGTH = 128;
export const DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL =
  "Serializable" as Prisma.TransactionIsolationLevel;

export type DbUserContextTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
  serializableRetry?: boolean;
};

export function normalizeDbUserContextUserId(userId: string) {
  const normalized = userId;
  if (
    normalized.length === 0 ||
    normalized !== normalized.trim() ||
    normalized.length > DB_USER_CONTEXT_USER_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new Error("RLS database user context requires a bounded local user id");
  }
  return normalized;
}

export function dbUserContextTransactionOptions(options: DbUserContextTransactionOptions = {}) {
  const isolationLevel =
    options.isolationLevel ??
    (options.serializableRetry ? DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL : undefined);
  if (options.serializableRetry && isolationLevel !== DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL) {
    throw new Error("RLS database user context serializable retry requires Serializable isolation");
  }
  return {
    isolationLevel,
    maxWait: options.maxWait ?? DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
    timeout: options.timeout ?? DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
  };
}
