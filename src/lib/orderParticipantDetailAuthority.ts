import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  buyerOrderDetailFromRows,
  sellerOrderDetailFromRows,
} from "@/lib/orderParticipantDetailState";

type OrderDetailReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function normalizedOrderId(value: string) {
  if (typeof value !== "string" || !ORDER_ID_PATTERN.test(value)) {
    throw new TypeError("Order detail order id is invalid");
  }
  return value;
}

export async function readBuyerOrderDetail(
  actorUserIdInput: string,
  orderIdInput: string,
  client: OrderDetailReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const orderId = normalizedOrderId(orderIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_buyer_detail(${actorUserId}, ${orderId})
  `);
  return buyerOrderDetailFromRows(rows);
}

export async function readSellerOrderDetail(
  actorUserIdInput: string,
  orderIdInput: string,
  client: OrderDetailReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const orderId = normalizedOrderId(orderIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_detail(${actorUserId}, ${orderId})
  `);
  return sellerOrderDetailFromRows(rows);
}
