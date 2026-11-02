import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";

type BlockSqlClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type BlockPairStateRow = {
  blocked: boolean;
};

export type OwnerBlockExportRow = {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
};

function exactCount(value: number | bigint | undefined, label: string) {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count as number;
}

export function userBlockPairIsBlocked(actorId: string, targetUserId: string) {
  return withDbUserContext(actorId, async (client) => {
    const rows = await client.$queryRaw<BlockPairStateRow[]>`
      SELECT public.grainline_user_block_pair_is_blocked(
        ${targetUserId}::text
      ) AS blocked
    `;
    if (rows.length !== 1 || typeof rows[0]?.blocked !== "boolean") {
      throw new TypeError("User block pair authority returned an invalid result");
    }
    return rows[0].blocked;
  });
}

export function ownerBlockExportRows(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<OwnerBlockExportRow[]>`
      SELECT * FROM public.grainline_user_block_export()
    `;
    if (rows.some((row) => (
      typeof row.blockerId !== "string"
      || typeof row.blockedId !== "string"
      || !(row.createdAt instanceof Date)
    ))) {
      throw new TypeError("User block export authority returned an invalid row");
    }
    return rows;
  });
}

export async function deleteAllOwnerBlocks(client: BlockSqlClient) {
  const rows = await client.$queryRaw<Array<{ deletedCount: number | bigint }>>`
    SELECT public.grainline_user_block_delete_owned() AS "deletedCount"
  `;
  if (rows.length !== 1) {
    throw new TypeError("User block deletion authority returned invalid cardinality");
  }
  return exactCount(rows[0]?.deletedCount, "User block deletion authority");
}
