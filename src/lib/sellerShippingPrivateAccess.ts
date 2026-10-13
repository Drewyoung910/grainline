import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerShippingClient = Pick<Prisma.TransactionClient, "sellerProfile">;

const sellerShippingQuoteSelect = {
  shipFromName: true,
  shipFromLine1: true,
  shipFromLine2: true,
  shipFromCity: true,
  shipFromState: true,
  shipFromPostal: true,
  shipFromCountry: true,
  defaultPkgWeightGrams: true,
  defaultPkgLengthCm: true,
  defaultPkgWidthCm: true,
  defaultPkgHeightCm: true,
  allowLocalPickup: true,
  preferredCarriers: true,
  useCalculatedShipping: true,
  shippingFlatRateCents: true,
  freeShippingOverCents: true,
} satisfies Prisma.SellerProfileSelect;

/**
 * Compatibility boundary for private seller fulfillment inputs used to quote
 * shipping. SellerProfile remains authoritative until the additive companion
 * is installed and this operation can move behind its fixed database function.
 */
export function sellerShippingQuoteState(
  sellerProfileId: string,
  client: SellerShippingClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: sellerShippingQuoteSelect,
  });
}
