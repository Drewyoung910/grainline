import type { Prisma } from "@prisma/client";

export async function removeSellerCommissionInterests(
  tx: Prisma.TransactionClient,
  sellerProfileId: string,
) {
  const interests = await tx.commissionInterest.findMany({
    where: { sellerProfileId },
    select: { commissionRequestId: true },
  });
  const commissionRequestIds = [...new Set(interests.map((interest) => interest.commissionRequestId))];
  if (commissionRequestIds.length === 0) return { commissionRequestIds };

  await tx.commissionInterest.deleteMany({ where: { sellerProfileId } });

  for (const commissionRequestId of commissionRequestIds) {
    const interestedCount = await tx.commissionInterest.count({
      where: { commissionRequestId },
    });
    await tx.commissionRequest.update({
      where: { id: commissionRequestId },
      data: { interestedCount },
    });
  }

  return { commissionRequestIds };
}
