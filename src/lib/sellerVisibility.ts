import { Prisma } from "@prisma/client";

export function visibleSellerProfileWhere(extra: Prisma.SellerProfileWhereInput = {}): Prisma.SellerProfileWhereInput {
  const parts: Prisma.SellerProfileWhereInput[] = [
    {
      chargesEnabled: true,
      stripeAccountSupported: true,
      ownerAccountActive: true,
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
      stripeAccountSupported: true,
      vacationMode: false,
      ownerAccountActive: true,
    },
  ];
  if (Object.keys(extra).length > 0) parts.push(extra);
  return {
    AND: parts,
  };
}
