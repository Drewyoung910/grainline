import { Prisma } from "@prisma/client";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { withDbUserContext } from "@/lib/dbUserContext";

type BlockMutationTx = DbUserContextTransactionClient;

type LockedBlockUser = {
  id: string;
  deletedAt: Date | null;
};

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
