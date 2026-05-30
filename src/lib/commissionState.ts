import { CommissionStatus, type Prisma } from "@prisma/client";

export function openCommissionBaseWhere(now = new Date()): Prisma.CommissionRequestWhereInput {
  return {
    status: CommissionStatus.OPEN,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    buyer: { banned: false, deletedAt: null },
  };
}

export function openCommissionMutationWhere(
  id: string,
  now = new Date(),
  extra: Prisma.CommissionRequestWhereInput = {},
): Prisma.CommissionRequestWhereInput {
  return {
    AND: [
      openCommissionBaseWhere(now),
      { id },
      extra,
    ],
  };
}
