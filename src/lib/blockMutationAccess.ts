import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type BlockMutationTx = Pick<Prisma.TransactionClient, "$queryRaw" | "block">;

type LockedBlockUser = {
  id: string;
  deletedAt: Date | null;
};

async function lockBlockUserPair(
  tx: BlockMutationTx,
  blockerId: string,
  blockedId: string,
) {
  if (!blockerId || !blockedId || blockerId === blockedId) {
    throw new Error("Block mutation requires two distinct users");
  }

  // Notification creation takes FOR SHARE on this same sorted pair before its
  // reciprocal Block absence check. FOR UPDATE makes block/unblock the other
  // side of that protocol, so whichever transaction locks first determines
  // whether the notification is allowed. Sorting prevents reverse-pair
  // mutations from introducing a lock-order deadlock.
  return tx.$queryRaw<LockedBlockUser[]>`
    SELECT block_user.id, block_user."deletedAt"
      FROM "User" AS block_user
     WHERE block_user.id IN (${blockerId}, ${blockedId})
     ORDER BY block_user.id
     FOR UPDATE
  `;
}

export async function createUserBlock(blockerId: string, blockedId: string) {
  return prisma.$transaction(async (tx) => {
    const users = await lockBlockUserPair(tx, blockerId, blockedId);
    if (users.length !== 2 || users.some((user) => user.deletedAt !== null)) {
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
  return prisma.$transaction(async (tx) => {
    const users = await lockBlockUserPair(tx, blockerId, blockedId);
    if (users.length !== 2) return 0;

    const result = await tx.block.deleteMany({
      where: { blockerId, blockedId },
    });
    return result.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
