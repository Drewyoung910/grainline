import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

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
