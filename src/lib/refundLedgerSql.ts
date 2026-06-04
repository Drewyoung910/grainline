import { Prisma } from "@prisma/client";
import { NON_BLOCKING_REFUND_LEDGER_STATUSES } from "@/lib/refundRouteState";

export const BLOCKING_REFUND_LEDGER_SQL = Prisma.sql`
  AND NOT EXISTS (
    SELECT 1 FROM "OrderPaymentEvent" ope
    WHERE ope."orderId" = o.id
      AND ope."eventType" = 'REFUND'
      AND (
        ope."status" IS NULL
        OR lower(ope."status") NOT IN (${Prisma.join(NON_BLOCKING_REFUND_LEDGER_STATUSES)})
      )
  )
`;
