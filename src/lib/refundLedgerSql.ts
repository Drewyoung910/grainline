import { Prisma } from "@prisma/client";
export function paymentRefundBlockedSql(orderSql: Prisma.Sql) {
  return Prisma.sql`${orderSql}."paymentRefundBlocked" = true`;
}

export function paymentOpenDisputeBlockedSql(orderSql: Prisma.Sql) {
  return Prisma.sql`${orderSql}."paymentOpenDisputeBlocked" = true`;
}

export function paymentTransitionBlockedSql(orderSql: Prisma.Sql) {
  return Prisma.sql`(
    ${paymentRefundBlockedSql(orderSql)}
    OR ${paymentOpenDisputeBlockedSql(orderSql)}
  )`;
}

export const BLOCKING_REFUND_LEDGER_SQL = Prisma.sql`
  AND o."paymentRefundBlocked" = false
`;
