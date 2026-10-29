import { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";

export async function createUserBlock(blockerId: string, blockedId: string) {
  return withDbUserContext(blockerId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ created: boolean }>>`
      SELECT public.grainline_user_block_create(${blockedId}::text) AS created
    `;
    if (rows.length !== 1 || typeof rows[0]?.created !== "boolean") {
      throw new TypeError("User block create authority returned an invalid result");
    }
    return rows[0].created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function deleteUserBlock(blockerId: string, blockedId: string) {
  return withDbUserContext(blockerId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ deletedCount: number }>>`
      SELECT public.grainline_user_block_remove(${blockedId}::text)
        AS "deletedCount"
    `;
    const deletedCount = rows[0]?.deletedCount;
    if (rows.length !== 1 || !Number.isSafeInteger(deletedCount) || deletedCount < 0) {
      throw new TypeError("User unblock authority returned an invalid result");
    }
    return deletedCount;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
