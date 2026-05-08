import { Prisma } from "@prisma/client";

const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

export function visibleSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  return {
    AND: [
      {
        chargesEnabled: true,
        stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION,
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
        stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION,
        vacationMode: false,
        user: { banned: false, deletedAt: null },
      },
      extra,
    ],
  };
}
