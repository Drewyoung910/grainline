import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  checkoutPostpaymentResultFromRows,
  type OrderCheckoutPostpaymentResult,
} from "./orderCheckoutPostpaymentState";

type CheckoutPostpaymentClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function readCheckoutPostpaymentProjection(input: {
  eventId: string;
  claimGeneration: bigint;
  sessionId: string;
}, client: CheckoutPostpaymentClient = prisma): Promise<OrderCheckoutPostpaymentResult> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT outcome, order_id, projection
      FROM public.grainline_stripe_checkout_postpayment(
        ${input.eventId}::text,
        ${input.claimGeneration}::bigint,
        ${input.sessionId}::text
      )
  `;
  return checkoutPostpaymentResultFromRows(rows);
}
