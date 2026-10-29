import { Prisma } from "@prisma/client";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { withDbUserContext } from "@/lib/dbUserContext";
import { deleteStockNotificationsForBlockedPair } from "@/lib/stockNotificationAccess";

type BlockMutationTx = DbUserContextTransactionClient;

type LockedBlockUser = {
  id: string;
  deletedAt: Date | null;
};

type BlockFollowCleanupRow = {
  deletedCount: number;
};

async function cleanupBlockFollows(
  tx: BlockMutationTx,
  blockedId: string,
) {
  const rows = await tx.$queryRaw<BlockFollowCleanupRow[]>`
    SELECT public.grainline_user_block_follow_cleanup(${blockedId}::text)
      AS "deletedCount"
  `;
  const deletedCount = rows[0]?.deletedCount;
  if (rows.length !== 1 || !Number.isSafeInteger(deletedCount) || deletedCount < 0) {
    throw new Error("User block follow cleanup returned an invalid result");
  }
  return deletedCount;
}

async function lockBlockUserPair(
  tx: BlockMutationTx,
  blockedId: string,
) {
  return tx.$queryRaw<LockedBlockUser[]>`
    SELECT * FROM public.grainline_user_block_pair_lock(${blockedId}::text)
  `;
}

export async function createUserBlock(blockerId: string, blockedId: string) {
  return withDbUserContext(blockerId, async (tx) => {
    const users = await lockBlockUserPair(tx, blockedId);
    if (
      users.length !== 2
      || new Set(users.map((user) => user.id)).size !== 2
      || users.some((user) => user.deletedAt !== null)
    ) {
      return false;
    }

    await tx.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    await deleteStockNotificationsForBlockedPair(tx, blockedId);
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function deleteUserBlock(blockerId: string, blockedId: string) {
  return withDbUserContext(blockerId, async (tx) => {
    const users = await lockBlockUserPair(tx, blockedId);
    if (users.length !== 2 || new Set(users.map((user) => user.id)).size !== 2) return 0;

    const result = await tx.block.deleteMany({
      where: { blockerId, blockedId },
    });
    return result.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
