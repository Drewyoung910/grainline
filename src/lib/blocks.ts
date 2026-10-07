import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { withDbUserContext } from "@/lib/dbUserContext";

type BlockTargetRow = {
  userId: string;
  sellerProfileId: string | null;
};

export type BlockedAccountRow = {
  blockId: string;
  blockedId: string;
  name: string | null;
  imageUrl: string | null;
  sellerDisplayName: string | null;
  sellerAvatarImageUrl: string | null;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

async function userBlockTargets(client: DbUserContextTransactionClient) {
  const rows = await client.$queryRaw<BlockTargetRow[]>`
    SELECT * FROM public.grainline_user_block_targets()
  `;
  if (rows.some((row) => (
    typeof row.userId !== "string"
    || !nullableString(row.sellerProfileId)
  ))) {
    throw new Error("User block target authority returned an invalid result");
  }
  return rows;
}

function ownerBlockTargets(userId: string) {
  return withDbUserContext(userId, userBlockTargets);
}

export async function getBlockedUserIdsFor(meId: string | null): Promise<Set<string>> {
  if (!meId) return new Set();
  return new Set((await ownerBlockTargets(meId)).map((row) => row.userId));
}

export async function getBlockedSellerProfileIdsFor(meId: string | null): Promise<string[]> {
  if (!meId) return [];
  return (await ownerBlockTargets(meId)).flatMap((row) => (
    row.sellerProfileId ? [row.sellerProfileId] : []
  ));
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
  if (!meId) return { blockedUserIds: new Set(), blockedSellerIds: [] };
  const rows = await ownerBlockTargets(meId);
  return {
    blockedUserIds: new Set(rows.map((row) => row.userId)),
    blockedSellerIds: rows.flatMap((row) => (
      row.sellerProfileId ? [row.sellerProfileId] : []
    )),
  };
}

export function getBlockedAccountsFor(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<BlockedAccountRow[]>`
      SELECT * FROM public.grainline_user_blocked_account_page()
    `;
    if (rows.some((row) => (
      typeof row.blockId !== "string"
      || typeof row.blockedId !== "string"
      || !nullableString(row.name)
      || !nullableString(row.imageUrl)
      || !nullableString(row.sellerDisplayName)
      || !nullableString(row.sellerAvatarImageUrl)
    ))) {
      throw new Error("User blocked-account authority returned an invalid result");
    }
    return rows;
  });
}
