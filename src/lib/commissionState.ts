import { CommissionStatus, type Prisma } from "@prisma/client";

export function openCommissionBaseWhere(now = new Date()): Prisma.CommissionRequestWhereInput {
  return {
    status: CommissionStatus.OPEN,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    buyerAccountActive: true,
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

// Why a request is no longer open. An OPEN row reaches this only when it has
// expired or its buyer's account is no longer active.
export function closedCommissionLabel(request: { status: CommissionStatus; expiresAt: Date | null }) {
  if (request.status !== CommissionStatus.OPEN) return request.status.toLowerCase().replace("_", " ");
  return request.expiresAt != null && request.expiresAt <= new Date() ? "expired" : "closed";
}
