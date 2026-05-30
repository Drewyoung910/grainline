import { CommissionStatus, type Prisma } from "@prisma/client";
import { openCommissionBaseWhere } from "./commissionState.ts";

export const COMMISSION_EXPIRY_DAYS = 90;

export function commissionExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + COMMISSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export function openCommissionWhere<T extends Prisma.CommissionRequestWhereInput>(
  extra?: T,
  now = new Date(),
): Prisma.CommissionRequestWhereInput {
  const base = openCommissionBaseWhere(now);

  return extra ? { AND: [base, extra] } : base;
}

export function commissionIsExpired(request: { status: CommissionStatus; expiresAt: Date | null }) {
  return request.status === CommissionStatus.OPEN && request.expiresAt != null && request.expiresAt <= new Date();
}
