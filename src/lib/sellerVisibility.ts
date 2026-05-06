import { Prisma } from "@prisma/client";

export function visibleSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  return {
    AND: [
      {
        chargesEnabled: true,
        user: { banned: false, deletedAt: null },
      },
      extra,
    ],
  };
}

export function activeSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  return {
    AND: [
      {
        chargesEnabled: true,
        vacationMode: false,
        user: { banned: false, deletedAt: null },
      },
      extra,
    ],
  };
}
