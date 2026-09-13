import type { Prisma } from "@prisma/client";

export function publicCommissionInterestWhere(
  extra: Prisma.CommissionInterestWhereInput = {},
): Prisma.CommissionInterestWhereInput {
  const parts: Prisma.CommissionInterestWhereInput[] = [
    {
      sellerProfile: {
        AND: [
          {
            chargesEnabled: true,
            OR: [{ stripeAccountVersion: null }, { stripeAccountVersion: "v2" }],
            vacationMode: false,
            user: { banned: false, deletedAt: null },
          },
        ],
      },
    },
  ];
  if (Object.keys(extra).length > 0) parts.push(extra);
  return { AND: parts };
}

export function resolvedInterestedCount({
  interestedCount,
  _count,
}: {
  interestedCount?: number | bigint | null;
  _count?: { interests?: number | bigint | null } | null;
}) {
  return Number(_count?.interests ?? interestedCount ?? 0);
}
