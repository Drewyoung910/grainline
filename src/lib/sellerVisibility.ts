import { Prisma } from "@prisma/client";

const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

function supportedStripeAccountVersionWhere() {
  return {
    OR: [
      { stripeAccountVersion: null },
      { stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION },
    ],
  } satisfies Prisma.SellerProfileWhereInput;
}

export function visibleSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  return {
    AND: [
      {
        chargesEnabled: true,
        ...supportedStripeAccountVersionWhere(),
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
        ...supportedStripeAccountVersionWhere(),
        vacationMode: false,
        user: { banned: false, deletedAt: null },
      },
      extra,
    ],
  };
}
