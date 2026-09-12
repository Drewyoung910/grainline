import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  checkoutRefundReviewOutcomeFromRows,
  type OrderCheckoutRefundReviewOutcome,
} from "./orderCheckoutRefundReviewState";

type CheckoutRefundReviewClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type OrderCheckoutRefundReviewAction =
  | "missing_payment_intent"
  | "claim_conflict"
  | "provider_failure";

export async function recordCheckoutRefundReview(input: {
  eventId: string;
  claimGeneration: bigint;
  sessionId: string;
  orderId: string;
  action: OrderCheckoutRefundReviewAction;
}, client: CheckoutRefundReviewClient = prisma): Promise<OrderCheckoutRefundReviewOutcome> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT outcome
      FROM public.grainline_stripe_checkout_refund_review(
        ${input.eventId}::text,
        ${input.claimGeneration}::bigint,
        ${input.sessionId}::text,
        ${input.orderId}::text,
        ${input.action}::text
      )
  `;
  return checkoutRefundReviewOutcomeFromRows(rows);
}
