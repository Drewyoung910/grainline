import { prisma } from "@/lib/db";
import { blockedUserIdsFromRows, sellerProfileIdsFromRows } from "./blockFilterState.ts";

export async function getBlockedUserIdsFor(meId: string | null): Promise<Set<string>> {
  if (!meId) return new Set();
  const [blockedByMe, blockingMe] = await Promise.all([
    prisma.block.findMany({
      where: {
        blockerId: meId,
        blocker: { deletedAt: null },
        blocked: { deletedAt: null },
      },
      select: { blockedId: true },
    }),
    prisma.block.findMany({
      where: {
        blockedId: meId,
        blocker: { deletedAt: null },
        blocked: { deletedAt: null },
      },
      select: { blockerId: true },
    }),
  ]);
  return blockedUserIdsFromRows({ blockedByMe, blockingMe });
}

export async function getBlockedSellerProfileIdsFor(meId: string | null): Promise<string[]> {
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (blockedUserIds.size === 0) return [];
  const sellers = await prisma.sellerProfile.findMany({
    where: { userId: { in: [...blockedUserIds] } },
    select: { id: true },
  });
  return sellerProfileIdsFromRows(sellers);
}

/**
 * Returns both blocked user IDs and blocked seller profile IDs
 * in a single Block table query. Use this on pages that need both
 * (e.g., homepage) to avoid querying the Block table twice.
 */
export async function getBlockedIdsFor(meId: string | null): Promise<{
  blockedUserIds: Set<string>;
  blockedSellerIds: string[];
}> {
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (blockedUserIds.size === 0) return { blockedUserIds, blockedSellerIds: [] };
  const sellers = await prisma.sellerProfile.findMany({
    where: { userId: { in: [...blockedUserIds] } },
    select: { id: true },
  });
  return { blockedUserIds, blockedSellerIds: sellerProfileIdsFromRows(sellers) };
}
