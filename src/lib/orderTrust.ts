import { Prisma } from "@prisma/client";

export const PAID_STRIPE_ORDER_SQL = Prisma.sql`
  AND o."paidAt" IS NOT NULL
  AND (
    o."stripeSessionId" IS NOT NULL
    OR o."stripePaymentIntentId" IS NOT NULL
    OR o."stripeChargeId" IS NOT NULL
  )
`;

export function paidStripeOrderWhere(): Prisma.OrderWhereInput {
  return {
    paidAt: { not: null },
    OR: [
      { stripeSessionId: { not: null } },
      { stripePaymentIntentId: { not: null } },
      { stripeChargeId: { not: null } },
    ],
  };
}
