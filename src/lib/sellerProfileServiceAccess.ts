import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerProfileServiceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SellerWelcomeNameRow = {
  displayName: unknown;
};

type BlockedPairTargetRow = {
  buyerUserId: unknown;
  sellerUserId: unknown;
  sellerProfileId: unknown;
};

const SELLER_SERVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function sellerServiceId(value: string) {
  if (!SELLER_SERVICE_ID_PATTERN.test(value)) {
    throw new TypeError("Seller service identity is invalid");
  }
  return value;
}

export async function sellerWelcomeDisplayName(
  userIdInput: string,
  client: SellerProfileServiceClient = prisma,
) {
  const userId = sellerServiceId(userIdInput);
  const rows = await client.$queryRaw<SellerWelcomeNameRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_service_welcome_name(${userId})
  `);
  if (rows.length > 1) {
    throw new Error("Seller welcome authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    typeof row.displayName !== "string"
    || row.displayName.length < 1
    || row.displayName.length > 100
  ) {
    throw new Error("Seller welcome authority returned an invalid result");
  }
  return row.displayName;
}

export async function blockedPairCheckoutTargets(
  input: { firstUserId: string; secondUserId: string },
  client: SellerProfileServiceClient = prisma,
) {
  const firstUserId = sellerServiceId(input.firstUserId);
  const secondUserId = sellerServiceId(input.secondUserId);
  const rows = await client.$queryRaw<BlockedPairTargetRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_transaction_blocked_pair_targets(
        ${firstUserId}, ${secondUserId}
      )
  `);
  const allowedPairs = new Set([
    `${firstUserId}\u0000${secondUserId}`,
    `${secondUserId}\u0000${firstUserId}`,
  ]);
  if (
    rows.length > 2
    || rows.some((row) => (
      typeof row.buyerUserId !== "string"
      || typeof row.sellerUserId !== "string"
      || typeof row.sellerProfileId !== "string"
      || !SELLER_SERVICE_ID_PATTERN.test(row.sellerProfileId)
      || !allowedPairs.has(`${row.buyerUserId}\u0000${row.sellerUserId}`)
    ))
  ) {
    throw new Error("Seller blocked-pair authority returned an invalid result");
  }
  return rows.map((row) => Object.freeze({
    buyerId: row.buyerUserId as string,
    sellerId: row.sellerProfileId as string,
  }));
}
