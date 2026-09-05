import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  paidCheckoutAuthorityResultFromRows,
  type PaidCheckoutAuthorityResult,
} from "./orderPaidCheckoutState";

type PaidCheckoutClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type PaidCheckoutProviderItem = Readonly<{
  sourceKey: string;
  listingId: string;
  variantKey: string;
  quantity: number;
  unitAmountCents: number;
}>;

export type PaidCheckoutProviderProjection = Readonly<{
  currency: string;
  chargedTotalCents: number;
  itemsSubtotalCents: number;
  shippingTitle: string | null;
  shippingAmountCents: number;
  taxAmountCents: number;
  buyerEmail: string | null;
  buyerName: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  stripeApplicationFeeId: string | null;
  stripeTransferId: string;
  shippingCarrier: string | null;
  shippingService: string | null;
  quotedToLine1: string | null;
  quotedToLine2: string | null;
  quotedToCity: string | null;
  quotedToState: string | null;
  quotedToPostalCode: string | null;
  quotedToCountry: string | null;
  quotedToName: string | null;
  quotedToPhone: string | null;
  quotedShippingAmountCents: number | null;
  shippoShipmentId: string | null;
  shippoRateObjectId: string | null;
  giftNote: string | null;
  giftWrapping: boolean;
  giftWrappingPriceCents: number;
  estDays: number;
  paidItems: readonly PaidCheckoutProviderItem[];
}>;

export async function createOrderFromPaidCheckout(input: {
  eventId: string;
  claimGeneration: bigint;
  reservationId: string;
  sessionId: string;
  paidAt: Date;
  provider: PaidCheckoutProviderProjection;
}, client: PaidCheckoutClient = prisma): Promise<PaidCheckoutAuthorityResult> {
  const paidAtUtc = input.paidAt.toISOString();
  const providerJson = JSON.stringify(input.provider);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT outcome, order_id, invalid_reason, invalid_seller_user_ids,
           listing_visibility_changed
      FROM public.grainline_stripe_checkout_order_create(
        ${input.eventId}::text,
        ${input.claimGeneration}::bigint,
        ${input.reservationId}::text,
        ${input.sessionId}::text,
        (${paidAtUtc}::timestamptz AT TIME ZONE 'UTC'),
        ${providerJson}::jsonb
      )
  `;
  return paidCheckoutAuthorityResultFromRows(rows);
}
