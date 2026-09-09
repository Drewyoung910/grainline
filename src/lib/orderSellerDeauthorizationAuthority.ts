import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sellerDeauthorizationResultFromRows,
  type SellerDeauthorizationResult,
} from "./orderSellerDeauthorizationState";

type SellerDeauthorizationClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function applyStripeSellerDeauthorization(input: {
  eventId: string;
  claimGeneration: bigint;
  accountId: string;
  eventCreatedAt: Date;
}, client: SellerDeauthorizationClient = prisma): Promise<SellerDeauthorizationResult> {
  const eventCreatedAtUtc = input.eventCreatedAt.toISOString();
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT outcome, seller_profile_id, public_visibility_changed,
           affected_order_count
      FROM public.grainline_stripe_seller_deauthorization_apply(
        ${input.eventId}::text,
        ${input.claimGeneration}::bigint,
        ${input.accountId}::text,
        (${eventCreatedAtUtc}::timestamptz AT TIME ZONE 'UTC')
      )
  `;
  return sellerDeauthorizationResultFromRows(rows);
}
