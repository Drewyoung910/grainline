import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";

type SellerProfileOwnerClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SellerOwnerAccountSummaryRow = {
  sellerProfileId: unknown;
  avatarImageUrl: unknown;
  activeListingCount: unknown;
};

export type SellerOwnerAccountSummary = {
  sellerProfileId: string;
  avatarImageUrl: string | null;
  activeListingCount: number;
};

async function readSellerOwnerAccountSummary(client: SellerProfileOwnerClient) {
  const rows = await client.$queryRaw<SellerOwnerAccountSummaryRow[]>`
    SELECT * FROM public.grainline_seller_owner_account_summary()
  `;
  if (rows.length > 1) {
    throw new Error("Seller owner account-summary authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    typeof row.sellerProfileId !== "string"
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(row.sellerProfileId)
    || (row.avatarImageUrl !== null && typeof row.avatarImageUrl !== "string")
    || typeof row.activeListingCount !== "bigint"
    || row.activeListingCount < 0n
    || row.activeListingCount > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller owner account-summary authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    avatarImageUrl: row.avatarImageUrl,
    activeListingCount: Number(row.activeListingCount),
  }) satisfies Readonly<SellerOwnerAccountSummary>;
}

export function sellerOwnerAccountSummary(userId: string) {
  return withDbUserContext(userId, readSellerOwnerAccountSummary);
}
