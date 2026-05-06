import { CommissionStatus, type Prisma } from "@prisma/client";

export function openCommissionMutationWhere(
  id: string,
  now = new Date(),
  extra: Prisma.CommissionRequestWhereInput = {},
): Prisma.CommissionRequestWhereInput {
  return {
    AND: [
      {
        id,
        status: CommissionStatus.OPEN,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        buyer: { banned: false, deletedAt: null },
      },
      extra,
    ],
  };
}
