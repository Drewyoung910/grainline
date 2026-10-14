import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerCheckoutListingClient = Pick<Prisma.TransactionClient, "listing" | "$queryRaw">;

// Exact seller state used to decide whether a buyer may start or continue a
// purchase. The compatibility implementation reads SellerProfile until the
// companion table and fixed checkout operation are installed in Production.
export const listingSellerOrderStateSelect = {
  id: true,
  userId: true,
  chargesEnabled: true,
  stripeAccountSupported: true,
  ownerAccountActive: true,
  vacationMode: true,
  acceptingNewOrders: true,
} satisfies Prisma.SellerProfileSelect;

export const cartCheckoutSellerSelect = {
  ...listingSellerOrderStateSelect,
  displayName: true,
  offersGiftWrapping: true,
  giftWrappingPriceCents: true,
  allowLocalPickup: true,
} satisfies Prisma.SellerProfileSelect;

export type SellerCheckoutPrivateState = {
  id: string;
  stripeAccountId: string;
  stripeAccountVersion: string | null;
  defaultPkgWeightGrams: number | null;
  defaultPkgLengthCm: number | null;
  defaultPkgWidthCm: number | null;
  defaultPkgHeightCm: number | null;
};

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export async function sellerCheckoutPrivateState(
  input: {
    buyerUserId: string;
    sellerProfileId: string;
    cartId: string | null;
    listingId: string | null;
  },
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  const rows = await client.$queryRaw<SellerCheckoutPrivateState[]>`
    SELECT id, "stripeAccountId", "stripeAccountVersion", "defaultPkgWeightGrams",
           "defaultPkgLengthCm", "defaultPkgWidthCm", "defaultPkgHeightCm"
      FROM public.grainline_seller_checkout_private_state(
        ${input.buyerUserId}::text,
        ${input.sellerProfileId}::text,
        ${input.cartId}::text,
        ${input.listingId}::text
      )
  `;
  const row = rows[0];
  const valid = row
    && row.id === input.sellerProfileId
    && typeof row.stripeAccountId === "string"
    && row.stripeAccountId.length > 0
    && (row.stripeAccountVersion === null || typeof row.stripeAccountVersion === "string")
    && nullableNumber(row.defaultPkgWeightGrams)
    && nullableNumber(row.defaultPkgLengthCm)
    && nullableNumber(row.defaultPkgWidthCm)
    && nullableNumber(row.defaultPkgHeightCm);
  if (rows.length > 1 || (row && !valid)) {
    throw new Error("Seller checkout private-state authority returned an invalid result");
  }
  return valid ? row : null;
}

export const sellerCartCheckoutInclude = {
  items: {
    include: {
      listing: {
        include: {
          seller: { select: cartCheckoutSellerSelect },
          photos: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
          variantGroups: { include: { options: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.CartInclude;

export function sellerSingleCheckoutSource(
  listingId: string,
  client: SellerCheckoutListingClient = prisma,
) {
  return client.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
      seller: { select: cartCheckoutSellerSelect },
      variantGroups: { include: { options: true } },
    },
  });
}

export function sellerSingleCheckoutResumeSource(
  listingId: string,
  client: SellerCheckoutListingClient = prisma,
) {
  return client.listing.findUnique({
    where: { id: listingId },
    select: {
      status: true,
      isPrivate: true,
      reservedForUserId: true,
      seller: { select: listingSellerOrderStateSelect },
    },
  });
}
