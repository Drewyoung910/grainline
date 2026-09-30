import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type CheckoutBlockClient = Pick<Prisma.TransactionClient, "block">;

export const CHECKOUT_PAIR_UNAVAILABLE_MESSAGE = "This checkout is unavailable.";

export async function checkoutPairIsBlocked(
  buyerId: string,
  sellerUserId: string,
  db: CheckoutBlockClient = prisma,
): Promise<boolean> {
  if (!buyerId || !sellerUserId || buyerId === sellerUserId) return true;

  const block = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: buyerId, blockedId: sellerUserId },
        { blockerId: sellerUserId, blockedId: buyerId },
      ],
    },
    select: { id: true },
  });
  return block !== null;
}
