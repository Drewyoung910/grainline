import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  sellerCompletedOrderCountFromRows,
  sellerOrderAnalyticsBucketsFromRows,
  sellerOrderAnalyticsSummaryFromRows,
  sellerOrderTopListingsFromRows,
  sellerRecentSalesFromRows,
} from "@/lib/orderSellerAnalyticsState";

type SellerAnalyticsClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type SellerOrderAnalyticsGrouping = "hour" | "day" | "month" | "year";

function epochMillis(value: Date, label: string) {
  const result = value.getTime();
  if (!Number.isSafeInteger(result) || result < 0 || result > 253402300799999) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function normalizedRange(input: {
  startDate: Date;
  endDate: Date;
  endExclusive: boolean;
}) {
  const startEpochMillis = epochMillis(input.startDate, "Seller analytics range start");
  const endEpochMillis = epochMillis(input.endDate, "Seller analytics range end");
  if (startEpochMillis > endEpochMillis || typeof input.endExclusive !== "boolean") {
    throw new TypeError("Seller analytics range is invalid");
  }
  return { startEpochMillis, endEpochMillis, endExclusive: input.endExclusive };
}

export async function readSellerOrderAnalyticsSummary(
  input: {
    actorUserId: string;
    startDate: Date;
    endDate: Date;
    endExclusive: boolean;
  },
  client: SellerAnalyticsClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const range = normalizedRange(input);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_analytics_summary(
        ${actorUserId}, ${range.startEpochMillis}, ${range.endEpochMillis},
        ${range.endExclusive}
      )
  `);
  return sellerOrderAnalyticsSummaryFromRows(rows);
}

export async function readSellerOrderAnalyticsBuckets(
  input: {
    actorUserId: string;
    startDate: Date;
    endDate: Date;
    endExclusive: boolean;
    grouping: SellerOrderAnalyticsGrouping;
  },
  client: SellerAnalyticsClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const range = normalizedRange(input);
  if (!["hour", "day", "month", "year"].includes(input.grouping)) {
    throw new TypeError("Seller analytics grouping is invalid");
  }
  const maxRows = input.grouping === "hour" ? 48 : input.grouping === "day" ? 400 : 100;
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_analytics_buckets(
        ${actorUserId}, ${range.startEpochMillis}, ${range.endEpochMillis},
        ${range.endExclusive}, ${input.grouping}
      )
  `);
  return sellerOrderAnalyticsBucketsFromRows(rows, maxRows);
}

export async function readSellerOrderTopListings(
  input: {
    actorUserId: string;
    startDate: Date;
    endDate: Date;
    endExclusive: boolean;
    allTime: boolean;
  },
  client: SellerAnalyticsClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const range = normalizedRange(input);
  if (typeof input.allTime !== "boolean") throw new TypeError("Seller analytics all-time flag is invalid");
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_analytics_top_listings(
        ${actorUserId}, ${range.startEpochMillis}, ${range.endEpochMillis},
        ${range.endExclusive}, ${input.allTime}
      )
  `);
  return sellerOrderTopListingsFromRows(rows);
}

export async function readSellerRecentSales(
  actorUserIdInput: string,
  client: SellerAnalyticsClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_order_seller_recent_sales(${actorUserId})
  `;
  return sellerRecentSalesFromRows(rows);
}

export async function countSellerCompletedOrders(
  actorUserIdInput: string,
  client: SellerAnalyticsClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_order_seller_completed_count(${actorUserId}) AS value
  `;
  return sellerCompletedOrderCountFromRows(rows);
}
