import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  checkoutExistingResultFromRows,
  type OrderCheckoutExistingResult,
} from "./orderCheckoutExistingState";

type CheckoutExistingClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function readExistingCheckoutOrder(input: {
  eventId: string;
  claimGeneration: bigint;
  sessionId: string;
}, client: CheckoutExistingClient = prisma): Promise<OrderCheckoutExistingResult> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT outcome, order_id, retry_reason, seller_user_ids
      FROM public.grainline_stripe_checkout_order_existing(
        ${input.eventId}::text,
        ${input.claimGeneration}::bigint,
        ${input.sessionId}::text
      )
  `;
  return checkoutExistingResultFromRows(rows);
}
