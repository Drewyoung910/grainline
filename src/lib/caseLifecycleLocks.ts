import type { Prisma } from "@prisma/client";

type RowLockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function requireSingleLockRow(
  rows: Array<{ id: string }>,
  target: "Order" | "User",
  id: string,
) {
  if (rows.length > 1) {
    throw new Error(`${target} lock returned invalid cardinality`);
  }
  if (rows.length === 1 && rows[0].id !== id) {
    throw new Error(`${target} lock returned the wrong row`);
  }
  return rows.length === 1;
}

export async function lockUserForCaseLifecycle(
  tx: RowLockClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "User"
    WHERE id = ${userId}
    FOR SHARE
  `;
  return requireSingleLockRow(rows, "User", userId);
}

export async function lockOrderForCaseLifecycle(
  tx: RowLockClient,
  orderId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Order"
    WHERE id = ${orderId}
    FOR UPDATE
  `;
  return requireSingleLockRow(rows, "Order", orderId);
}

export async function databaseClockTimestamp(tx: RowLockClient) {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS now
  `;
  if (
    rows.length !== 1 ||
    !(rows[0].now instanceof Date) ||
    Number.isNaN(rows[0].now.getTime())
  ) {
    throw new Error("database clock returned an invalid timestamp");
  }
  return rows[0].now;
}
