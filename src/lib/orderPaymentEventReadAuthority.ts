import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buyerOrderPaymentHistoryPageFromRows,
  groupBuyerPaymentHistory,
  groupSellerPaymentHistory,
  orderPaymentRefundOutcomesFromRows,
  orderPaymentStaffTimelineFromRows,
  sellerOrderPaymentHistoryPageFromRows,
  type BuyerOrderPaymentHistory,
  type OrderPaymentExportCursor,
  type OrderPaymentRefundOutcome,
  type OrderPaymentStaffTimelineEvent,
  type SellerOrderPaymentHistory,
} from "@/lib/orderPaymentEventReadState";

type OrderPaymentReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function orderIdArraySql(orderIds: readonly string[]) {
  return orderIds.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(orderIds)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
}

function validateOutcomeRequest(orderIds: readonly string[]) {
  if (orderIds.length > 100 || new Set(orderIds).size !== orderIds.length) {
    throw new Error("Order payment outcome request is invalid");
  }
}

export async function buyerRefundOutcomes(
  actorUserId: string,
  orderIds: readonly string[],
  client: OrderPaymentReadClient = prisma,
): Promise<Map<string, OrderPaymentRefundOutcome>> {
  if (orderIds.length === 0) return new Map();
  validateOutcomeRequest(orderIds);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT order_id, amount_cents, currency, status, created_at_epoch_millis
      FROM public.grainline_order_payment_buyer_refund_outcomes(
        ${actorUserId},
        ${orderIdArraySql(orderIds)}
      )
  `);
  return orderPaymentRefundOutcomesFromRows(rows);
}

export async function sellerRefundOutcomes(
  actorUserId: string,
  orderIds: readonly string[],
  client: OrderPaymentReadClient = prisma,
): Promise<Map<string, OrderPaymentRefundOutcome>> {
  if (orderIds.length === 0) return new Map();
  validateOutcomeRequest(orderIds);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT order_id, amount_cents, currency, status, created_at_epoch_millis
      FROM public.grainline_order_payment_seller_refund_outcomes(
        ${actorUserId},
        ${orderIdArraySql(orderIds)}
      )
  `);
  return orderPaymentRefundOutcomesFromRows(rows);
}

async function readBuyerPaymentHistoryPage(
  actorUserId: string,
  limit: number,
  cursor: OrderPaymentExportCursor | null,
  client: OrderPaymentReadClient,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT payment_event_id, order_id, event_type, amount_cents, currency,
           status, created_at_epoch_millis
      FROM public.grainline_order_payment_buyer_export_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.paymentEventId ?? null}
      )
  `);
  return buyerOrderPaymentHistoryPageFromRows(rows, limit);
}

async function readSellerPaymentHistoryPage(
  actorUserId: string,
  limit: number,
  cursor: OrderPaymentExportCursor | null,
  client: OrderPaymentReadClient,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT payment_event_id, order_id, event_type, amount_cents, currency,
           status, reason, created_at_epoch_millis
      FROM public.grainline_order_payment_seller_export_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.paymentEventId ?? null}
      )
  `);
  return sellerOrderPaymentHistoryPageFromRows(rows, limit);
}

export async function exportBuyerOrderPaymentHistory(
  actorUserId: string,
  client: OrderPaymentReadClient = prisma,
): Promise<Map<string, BuyerOrderPaymentHistory[]>> {
  const limit = 500;
  const rows: Array<{ orderId: string; value: BuyerOrderPaymentHistory }> = [];
  let cursor: OrderPaymentExportCursor | null = null;

  for (;;) {
    const page = await readBuyerPaymentHistoryPage(actorUserId, limit, cursor, client);
    rows.push(...page.rows);
    if (page.rows.length < limit) return groupBuyerPaymentHistory(rows);
    if (
      !page.cursor
      || (
        cursor
        && page.cursor.paymentEventId === cursor.paymentEventId
        && page.cursor.createdAtEpochMillis === cursor.createdAtEpochMillis
      )
    ) {
      throw new Error("Buyer payment export cursor did not advance");
    }
    cursor = page.cursor;
  }
}

export async function exportSellerOrderPaymentHistory(
  actorUserId: string,
  client: OrderPaymentReadClient = prisma,
): Promise<Map<string, SellerOrderPaymentHistory[]>> {
  const limit = 500;
  const rows: Array<{ orderId: string; value: SellerOrderPaymentHistory }> = [];
  let cursor: OrderPaymentExportCursor | null = null;

  for (;;) {
    const page = await readSellerPaymentHistoryPage(actorUserId, limit, cursor, client);
    rows.push(...page.rows);
    if (page.rows.length < limit) return groupSellerPaymentHistory(rows);
    if (
      !page.cursor
      || (
        cursor
        && page.cursor.paymentEventId === cursor.paymentEventId
        && page.cursor.createdAtEpochMillis === cursor.createdAtEpochMillis
      )
    ) {
      throw new Error("Seller payment export cursor did not advance");
    }
    cursor = page.cursor;
  }
}

export async function staffOrderPaymentTimeline(
  actorUserId: string,
  orderId: string,
  client: OrderPaymentReadClient = prisma,
): Promise<OrderPaymentStaffTimelineEvent[]> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT payment_event_id, stripe_event_id, stripe_object_id,
           stripe_object_type, event_type, amount_cents, currency, status,
           reason, description, transfer_reversal_id,
           transfer_reversal_amount_cents, platform_funded_refund_cents,
           original_transfer_amount_cents, created_at_epoch_millis
      FROM public.grainline_order_payment_staff_timeline(
        ${actorUserId}, ${orderId}, 25
      )
  `;
  return orderPaymentStaffTimelineFromRows(rows);
}
