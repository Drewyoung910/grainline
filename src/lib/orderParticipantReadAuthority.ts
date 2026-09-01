import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  buyerOrderListPageFromRows,
  buyerOrderSummaryPageFromRows,
  orderCountFromRows,
  sellerOrderListPageFromRows,
  sellerOrderSummaryPageFromRows,
  type OrderListCursor,
} from "@/lib/orderParticipantReadState";

type OrderReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError("Order list limit is invalid");
  }
  return value;
}

function normalizedCursor(value: OrderListCursor | null) {
  if (value == null) return null;
  if (
    !Number.isSafeInteger(value.createdAtEpochMillis)
    || value.createdAtEpochMillis < 0
    || value.createdAtEpochMillis > 253402300799999
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(value.orderId)
  ) {
    throw new TypeError("Order list cursor is invalid");
  }
  return value;
}

export async function countBuyerOrders(
  actorUserIdInput: string,
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_order_buyer_count(${actorUserId}) AS value
  `;
  return orderCountFromRows(rows, "Buyer");
}

export async function readBuyerOrderPage(
  input: {
    actorUserId: string;
    limit: number;
    cursor?: OrderListCursor | null;
  },
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const limit = boundedLimit(input.limit);
  const cursor = normalizedCursor(input.cursor ?? null);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_buyer_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.orderId ?? null}
      )
  `);
  return buyerOrderListPageFromRows(rows, limit);
}

export async function countSellerOrders(
  actorUserIdInput: string,
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_order_seller_count(${actorUserId}) AS value
  `;
  return orderCountFromRows(rows, "Seller");
}

export async function readSellerOrderPage(
  input: {
    actorUserId: string;
    limit: number;
    cursor?: OrderListCursor | null;
  },
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const limit = boundedLimit(input.limit);
  const cursor = normalizedCursor(input.cursor ?? null);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.orderId ?? null}
      )
  `);
  return sellerOrderListPageFromRows(rows, limit);
}

export async function readBuyerOrderSummaryPage(
  input: {
    actorUserId: string;
    limit: number;
    cursor?: OrderListCursor | null;
    direction?: "older" | "newer";
  },
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const limit = boundedLimit(input.limit);
  const cursor = normalizedCursor(input.cursor ?? null);
  const direction = input.direction ?? "older";
  if (direction !== "older" && direction !== "newer") {
    throw new TypeError("Order summary direction is invalid");
  }
  if (direction === "newer" && cursor === null) {
    throw new TypeError("Newer Order summary page requires a cursor");
  }
  if (direction === "newer") {
    const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
        FROM public.grainline_order_buyer_summary_after_page(
          ${actorUserId},
          ${limit},
          ${cursor?.createdAtEpochMillis ?? null},
          ${cursor?.orderId ?? null}
        )
    `);
    return buyerOrderSummaryPageFromRows(rows, limit);
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_buyer_summary_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.orderId ?? null}
      )
  `);
  return buyerOrderSummaryPageFromRows(rows, limit);
}

export async function readSellerOrderSummaryPage(
  input: {
    actorUserId: string;
    limit: number;
    cursor?: OrderListCursor | null;
    direction?: "older" | "newer";
  },
  client: OrderReadClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const limit = boundedLimit(input.limit);
  const cursor = normalizedCursor(input.cursor ?? null);
  const direction = input.direction ?? "older";
  if (direction !== "older" && direction !== "newer") {
    throw new TypeError("Order summary direction is invalid");
  }
  if (direction === "newer" && cursor === null) {
    throw new TypeError("Newer Order summary page requires a cursor");
  }
  if (direction === "newer") {
    const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
        FROM public.grainline_order_seller_summary_after_page(
          ${actorUserId},
          ${limit},
          ${cursor?.createdAtEpochMillis ?? null},
          ${cursor?.orderId ?? null}
        )
    `);
    return sellerOrderSummaryPageFromRows(rows, limit);
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_summary_page(
        ${actorUserId},
        ${limit},
        ${cursor?.createdAtEpochMillis ?? null},
        ${cursor?.orderId ?? null}
      )
  `);
  return sellerOrderSummaryPageFromRows(rows, limit);
}
