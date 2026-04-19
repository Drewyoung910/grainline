import { prisma } from "@/lib/db";

export async function getBlockedUserIdsFor(meId: string | null): Promise<Set<string>> {
  if (!meId) return new Set();
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: meId }, { blockedId: meId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.blockerId !== meId) ids.add(b.blockerId);
    if (b.blockedId !== meId) ids.add(b.blockedId);
  }
  return ids;
}

export async function getBlockedSellerProfileIdsFor(meId: string | null): Promise<string[]> {
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (blockedUserIds.size === 0) return [];
  const sellers = await prisma.sellerProfile.findMany({
    where: { userId: { in: [...blockedUserIds] } },
    select: { id: true },
  });
  return sellers.map(s => s.id);
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
  return { blockedUserIds, blockedSellerIds: sellers.map(s => s.id) };
}
