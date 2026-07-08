import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  dbUserContextTransactionOptions,
  normalizeDbUserContextUserId,
  type DbUserContextTransactionOptions,
} from "@/lib/dbUserContextState";
import { withSerializableRetry } from "@/lib/transactionRetry";

export type DbUserContextTransactionClient = Prisma.TransactionClient;

export type WithDbUserContextOptions = DbUserContextTransactionOptions & {
  serializableRetry?: boolean;
  attempts?: number;
};

export async function setDbUserContext(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
) {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const rows = await tx.$queryRaw<Array<{ user_id: string | null }>>`
    SELECT set_config('app.user_id', ${normalizedUserId}, true) AS user_id
  `;
  if (rows[0]?.user_id !== normalizedUserId) {
    throw new Error("Failed to set transaction-local RLS database user context");
  }
  return normalizedUserId;
}

export async function withDbUserContext<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: WithDbUserContextOptions = {},
) {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const transactionOptions = dbUserContextTransactionOptions(options);
  const runTransaction = () =>
    prisma.$transaction(async (tx) => {
      await setDbUserContext(tx, normalizedUserId);
      return operation(tx);
    }, transactionOptions);

  if (options.serializableRetry) {
    return withSerializableRetry(runTransaction, options.attempts);
  }
  return runTransaction();
}

export function withSerializableDbUserContext<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: Omit<WithDbUserContextOptions, "serializableRetry"> = {},
) {
  return withDbUserContext(userId, operation, {
    ...options,
    serializableRetry: true,
  });
}
