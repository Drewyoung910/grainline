import { Prisma } from "@prisma/client";
import {
  NON_BLOCKING_REFUND_LEDGER_STATUSES,
  STRIPE_DISPUTE_CLOSED_STATUSES,
} from "@/lib/refundRouteState";

export function blockingRefundLedgerExistsSql(orderIdSql: Prisma.Sql) {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "OrderPaymentEvent" ope
    WHERE ope."orderId" = ${orderIdSql}
      AND ope."eventType" = 'REFUND'
      AND (
        ope."status" IS NULL
        OR lower(ope."status") NOT IN (${Prisma.join(NON_BLOCKING_REFUND_LEDGER_STATUSES)})
      )
  )`;
}

export function latestOpenDisputeLedgerExistsSql(orderIdSql: Prisma.Sql) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT ON (COALESCE(ope."stripeObjectId", ope.id))
        ope."status"
      FROM "OrderPaymentEvent" ope
      WHERE ope."orderId" = ${orderIdSql}
        AND ope."eventType" = 'DISPUTE'
      ORDER BY COALESCE(ope."stripeObjectId", ope.id), ope."createdAt" DESC, ope.id DESC
    ) latest_dispute
    WHERE latest_dispute."status" IS NULL
      OR lower(latest_dispute."status") NOT IN (${Prisma.join([...STRIPE_DISPUTE_CLOSED_STATUSES])})
  )`;
}

export function blockingRefundOrLatestOpenDisputeLedgerExistsSql(orderIdSql: Prisma.Sql) {
  return Prisma.sql`(
    ${blockingRefundLedgerExistsSql(orderIdSql)}
    OR ${latestOpenDisputeLedgerExistsSql(orderIdSql)}
  )`;
}

export const BLOCKING_REFUND_LEDGER_SQL = Prisma.sql`
  AND NOT (${blockingRefundLedgerExistsSql(Prisma.sql`o.id`)})
`;
