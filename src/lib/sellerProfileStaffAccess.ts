import type { Prisma } from "@prisma/client";

type SellerProfileStaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerProfileStaffReportTarget = Readonly<{
  id: string;
  displayName: string;
}>;

export type SellerProfileStaffBroadcastTarget = Readonly<{
  broadcastId: string;
  sellerProfileId: string;
  sellerUserId: string;
  sellerDisplayName: string;
}>;

type VerificationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "GUILD_MASTER_PENDING"
  | "GUILD_MASTER_APPROVED"
  | "GUILD_MASTER_REJECTED";

type SellerProfileStaffVerificationTargetRow = Readonly<{
  verificationId: string;
  verificationStatus: VerificationStatus;
  sellerProfileId: string;
  sellerUserId: string;
  sellerDisplayName: string;
  ownerAccountActive: boolean;
  metricsCalculatedAt: Date | null;
  metricsPeriodMonths: number | null;
  metricsAverageRating: number | null;
  metricsReviewCount: number | null;
  metricsOnTimeShippingRate: number | null;
  metricsResponseRate: number | null;
  metricsTotalSalesCents: bigint | null;
  metricsCompletedOrderCount: number | null;
  metricsActiveCaseCount: number | null;
  metricsAccountAgeDays: number | null;
}>;

export type SellerProfileStaffVerificationTarget = Readonly<{
  id: string;
  status: VerificationStatus;
  sellerProfileId: string;
  sellerProfile: Readonly<{
    id: string;
    userId: string;
    displayName: string;
    ownerAccountActive: boolean;
    sellerMetrics: null | Readonly<{
      calculatedAt: Date;
      periodMonths: number;
      averageRating: number;
      reviewCount: number;
      onTimeShippingRate: number;
      responseRate: number;
      totalSalesCents: bigint;
      completedOrderCount: number;
      activeCaseCount: number;
      accountAgeDays: number;
    }>;
  }>;
}>;

const VERIFICATION_STATUSES = new Set<VerificationStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "GUILD_MASTER_PENDING",
  "GUILD_MASTER_APPROVED",
  "GUILD_MASTER_REJECTED",
]);

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export async function sellerProfileStaffReportTargets(
  client: SellerProfileStaffClient,
  input: { actorId: string; sellerProfileIds: string[] },
) {
  if (input.sellerProfileIds.length === 0) return [];
  const sellerProfileIds = [...new Set(input.sellerProfileIds)];
  if (sellerProfileIds.length > 50) {
    throw new Error("Seller report target input exceeds its bound");
  }
  const requested = new Set(sellerProfileIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<SellerProfileStaffReportTarget[]>`
    SELECT * FROM public.grainline_seller_staff_report_targets(
      ${input.actorId}::text,
      ${sellerProfileIds}::text[]
    )
  `;
  if (rows.length > requested.size || rows.some((row) => {
    const valid = typeof row.id === "string"
      && typeof row.displayName === "string"
      && row.displayName.length > 0
      && row.displayName.length <= 100
      && requested.has(row.id)
      && !returned.has(row.id);
    returned.add(row.id);
    return !valid;
  })) {
    throw new Error("Seller report target authority returned an invalid result");
  }
  return rows;
}

export async function sellerProfileStaffBroadcastTargets(
  client: SellerProfileStaffClient,
  input: { actorId: string; broadcastIds: string[] },
) {
  if (input.broadcastIds.length === 0) return [];
  const broadcastIds = [...new Set(input.broadcastIds)];
  if (broadcastIds.length > 50 || broadcastIds.some((id) => !validId(id))) {
    throw new RangeError("Seller broadcast target input exceeds its bound");
  }
  const requested = new Set(broadcastIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<SellerProfileStaffBroadcastTarget[]>`
    SELECT * FROM public.grainline_seller_staff_broadcast_targets(
      ${input.actorId}::text,
      ${broadcastIds}::text[]
    )
  `;
  if (rows.length > requested.size || rows.some((row) => {
    const valid = validId(row.broadcastId)
      && requested.has(row.broadcastId)
      && !returned.has(row.broadcastId)
      && validId(row.sellerProfileId)
      && validId(row.sellerUserId)
      && typeof row.sellerDisplayName === "string"
      && row.sellerDisplayName.length > 0
      && row.sellerDisplayName.length <= 100;
    returned.add(row.broadcastId);
    return !valid;
  })) {
    throw new Error("Seller broadcast target authority returned an invalid result");
  }
  return rows;
}

export async function sellerProfileStaffVerificationTarget(
  client: SellerProfileStaffClient,
  input: { actorId: string; verificationId: string },
): Promise<SellerProfileStaffVerificationTarget | null> {
  if (!validId(input.actorId) || !validId(input.verificationId)) {
    throw new RangeError("Seller verification target input is invalid");
  }
  const rows = await client.$queryRaw<SellerProfileStaffVerificationTargetRow[]>`
    SELECT * FROM public.grainline_seller_staff_verification_target(
      ${input.actorId}::text,
      ${input.verificationId}::text
    )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller verification target authority returned multiple rows");
  }
  const row = rows[0];
  const metricValues = [
    row.metricsPeriodMonths,
    row.metricsAverageRating,
    row.metricsReviewCount,
    row.metricsOnTimeShippingRate,
    row.metricsResponseRate,
    row.metricsTotalSalesCents,
    row.metricsCompletedOrderCount,
    row.metricsActiveCaseCount,
    row.metricsAccountAgeDays,
  ];
  const metricsAbsent = row.metricsCalculatedAt === null
    && metricValues.every((value) => value === null);
  const metricsValid = validDate(row.metricsCalculatedAt)
    && validNonnegativeInteger(row.metricsPeriodMonths)
    && validFiniteNumber(row.metricsAverageRating)
    && validNonnegativeInteger(row.metricsReviewCount)
    && validFiniteNumber(row.metricsOnTimeShippingRate)
    && validFiniteNumber(row.metricsResponseRate)
    && typeof row.metricsTotalSalesCents === "bigint"
    && row.metricsTotalSalesCents >= 0n
    && validNonnegativeInteger(row.metricsCompletedOrderCount)
    && validNonnegativeInteger(row.metricsActiveCaseCount)
    && validNonnegativeInteger(row.metricsAccountAgeDays);
  if (
    row.verificationId !== input.verificationId
    || !VERIFICATION_STATUSES.has(row.verificationStatus)
    || !validId(row.sellerProfileId)
    || !validId(row.sellerUserId)
    || typeof row.sellerDisplayName !== "string"
    || row.sellerDisplayName.length === 0
    || row.sellerDisplayName.length > 100
    || typeof row.ownerAccountActive !== "boolean"
    || (!metricsAbsent && !metricsValid)
  ) {
    throw new Error("Seller verification target authority returned an invalid result");
  }
  return {
    id: row.verificationId,
    status: row.verificationStatus,
    sellerProfileId: row.sellerProfileId,
    sellerProfile: {
      id: row.sellerProfileId,
      userId: row.sellerUserId,
      displayName: row.sellerDisplayName,
      ownerAccountActive: row.ownerAccountActive,
      sellerMetrics: metricsAbsent ? null : {
        calculatedAt: row.metricsCalculatedAt!,
        periodMonths: row.metricsPeriodMonths!,
        averageRating: row.metricsAverageRating!,
        reviewCount: row.metricsReviewCount!,
        onTimeShippingRate: row.metricsOnTimeShippingRate!,
        responseRate: row.metricsResponseRate!,
        totalSalesCents: row.metricsTotalSalesCents!,
        completedOrderCount: row.metricsCompletedOrderCount!,
        activeCaseCount: row.metricsActiveCaseCount!,
        accountAgeDays: row.metricsAccountAgeDays!,
      },
    },
  };
}
