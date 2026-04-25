import { CommissionStatus, type Prisma } from "@prisma/client";

export const COMMISSION_EXPIRY_DAYS = 90;

export function commissionExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + COMMISSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export function openCommissionWhere<T extends Prisma.CommissionRequestWhereInput>(
  extra?: T,
): Prisma.CommissionRequestWhereInput {
  return {
    ...extra,
    status: CommissionStatus.OPEN,
    buyer: { banned: false, deletedAt: null },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

export function commissionIsExpired(request: { status: CommissionStatus; expiresAt: Date | null }) {
  return request.status === CommissionStatus.OPEN && request.expiresAt != null && request.expiresAt <= new Date();
}
