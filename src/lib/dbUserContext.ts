import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  dbUserContextTransactionOptions,
  normalizeDbUserContextUserId,
  type DbUserContextTransactionOptions,
} from "@/lib/dbUserContextState";
import { withSerializableRetry } from "@/lib/transactionRetry";

declare const dbUserContextTransactionBrand: unique symbol;

/**
 * A transaction client whose transaction-local app.user_id value has been
 * verified by setDbUserContext(). The private brand prevents a global Prisma
 * client or a raw transaction client from reaching RLS-protected helpers.
 */
export type DbUserContextTransactionClient = Prisma.TransactionClient & {
  readonly [dbUserContextTransactionBrand]: true;
};

export type WithDbUserContextOptions = DbUserContextTransactionOptions & {
  attempts?: number;
};

async function setDbUserContext(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<DbUserContextTransactionClient> {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const rows = await tx.$queryRaw<Array<{ user_id: string | null }>>`
    SELECT set_config('app.user_id', ${normalizedUserId}, true) AS user_id
  `;
  if (rows[0]?.user_id !== normalizedUserId) {
    throw new Error("Failed to set transaction-local RLS database user context");
  }
  return tx as DbUserContextTransactionClient;
}

/**
 * Runs future user-scoped RLS work inside a Prisma interactive transaction.
 *
 * Pass only the server-resolved authenticated local User.id, such as `me.id`.
 * Never pass request body, query string, route param, or other client-supplied
 * values as the RLS user context.
 *
 * The callback must use the provided transaction client for every protected
 * query and must run those queries sequentially. Do not use `Promise.all` or
 * other concurrent Prisma calls inside this transaction; the RLS context is
 * transaction-local and the interactive transaction pins one connection. Keep
 * the callback DB-only and fast; do not await external or network calls inside
 * it because the pooled connection is held for the callback's duration.
 */
export async function withDbUserContext<T>(
  userId: string,
  operation: (tx: DbUserContextTransactionClient) => Promise<T>,
  options: WithDbUserContextOptions = {},
) {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const transactionOptions = dbUserContextTransactionOptions(options);
  const runTransaction = () =>
    prisma.$transaction(async (tx) => {
      const contextualTx = await setDbUserContext(tx, normalizedUserId);
      return operation(contextualTx);
    }, transactionOptions);

  if (options.serializableRetry) {
    return withSerializableRetry(runTransaction, options.attempts);
  }
  return runTransaction();
}

export function withSerializableDbUserContext<T>(
  userId: string,
  operation: (tx: DbUserContextTransactionClient) => Promise<T>,
  options: Omit<WithDbUserContextOptions, "serializableRetry" | "isolationLevel"> = {},
) {
  return withDbUserContext(userId, operation, {
    ...options,
    serializableRetry: true,
  });
}
