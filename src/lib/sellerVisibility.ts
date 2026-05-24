import { Prisma } from "@prisma/client";

export const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

export function isSupportedStripeAccountVersion(version: string | null | undefined) {
  return version == null || version === SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION;
}

function supportedStripeAccountVersionWhere() {
  return {
    OR: [
      { stripeAccountVersion: null },
      { stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION },
    ],
  } satisfies Prisma.SellerProfileWhereInput;
}

export function visibleSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  const parts: Prisma.SellerProfileWhereInput[] = [
    {
      chargesEnabled: true,
      ...supportedStripeAccountVersionWhere(),
      user: { banned: false, deletedAt: null },
    },
  ];
  if (Object.keys(extra).length > 0) parts.push(extra);
  return {
    AND: parts,
  };
}

export function activeSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  const parts: Prisma.SellerProfileWhereInput[] = [
    {
      chargesEnabled: true,
      ...supportedStripeAccountVersionWhere(),
      vacationMode: false,
      user: { banned: false, deletedAt: null },
    },
  ];
  if (Object.keys(extra).length > 0) parts.push(extra);
  return {
    AND: parts,
  };
}
