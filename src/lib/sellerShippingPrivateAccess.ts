import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerShippingClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerShippingQuoteState = {
  shipFromName: string | null;
  shipFromLine1: string | null;
  shipFromLine2: string | null;
  shipFromCity: string | null;
  shipFromState: string | null;
  shipFromPostal: string | null;
  shipFromCountry: string | null;
  defaultPkgWeightGrams: number | null;
  defaultPkgLengthCm: number | null;
  defaultPkgWidthCm: number | null;
  defaultPkgHeightCm: number | null;
  allowLocalPickup: boolean;
  preferredCarriers: string[];
  useCalculatedShipping: boolean;
  shippingFlatRateCents: number | null;
  freeShippingOverCents: number | null;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validShippingState(
  row: SellerShippingQuoteState | undefined,
): row is SellerShippingQuoteState {
  return Boolean(
    row
    && nullableString(row.shipFromName)
    && nullableString(row.shipFromLine1)
    && nullableString(row.shipFromLine2)
    && nullableString(row.shipFromCity)
    && nullableString(row.shipFromState)
    && nullableString(row.shipFromPostal)
    && nullableString(row.shipFromCountry)
    && nullableNumber(row.defaultPkgWeightGrams)
    && nullableNumber(row.defaultPkgLengthCm)
    && nullableNumber(row.defaultPkgWidthCm)
    && nullableNumber(row.defaultPkgHeightCm)
    && typeof row.allowLocalPickup === "boolean"
    && Array.isArray(row.preferredCarriers)
    && row.preferredCarriers.every((carrier) => typeof carrier === "string")
    && typeof row.useCalculatedShipping === "boolean"
    && nullableNumber(row.shippingFlatRateCents)
    && nullableNumber(row.freeShippingOverCents),
  );
}

/**
 * Fixed database-operation boundary for private seller fulfillment inputs.
 * The database binds disclosure to an active buyer and an exact eligible cart
 * or listing; callers never receive SellerProfilePrivate table authority.
 */
export async function sellerShippingQuoteState(
  input: {
    buyerUserId: string;
    sellerProfileId: string;
    cartId: string | null;
    listingId: string | null;
  },
  client: SellerShippingClient = prisma,
) {
  const rows = await client.$queryRaw<SellerShippingQuoteState[]>`
    SELECT "shipFromName", "shipFromLine1", "shipFromLine2",
           "shipFromCity", "shipFromState", "shipFromPostal",
           "shipFromCountry", "defaultPkgWeightGrams",
           "defaultPkgLengthCm", "defaultPkgWidthCm", "defaultPkgHeightCm",
           "allowLocalPickup", "preferredCarriers", "useCalculatedShipping",
           "shippingFlatRateCents", "freeShippingOverCents"
      FROM public.grainline_seller_shipping_quote_state(
        ${input.buyerUserId}::text,
        ${input.sellerProfileId}::text,
        ${input.cartId}::text,
        ${input.listingId}::text
      )
  `;
  if (rows.length > 1 || (rows[0] && !validShippingState(rows[0]))) {
    throw new Error("Seller shipping quote-state authority returned an invalid result");
  }
  return rows[0] ?? null;
}
