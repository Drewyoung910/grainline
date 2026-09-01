import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orderSellerMetricsFactsFromRows } from "@/lib/orderSellerMetricsState";

type OrderSellerMetricsClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const SELLER_PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const MAX_EPOCH_MILLIS = 253402300799999;

function normalizedSellerProfileId(value: string) {
  if (!SELLER_PROFILE_ID_PATTERN.test(value)) {
    throw new TypeError("Order seller-metrics seller id is invalid");
  }
  return value;
}

function epochMillis(value: Date) {
  const result = value.getTime();
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_EPOCH_MILLIS) {
    throw new TypeError("Order seller-metrics period is invalid");
  }
  return result;
}

export async function readOrderSellerMetricsFacts(
  sellerProfileIdInput: string,
  periodStart: Date,
  client: OrderSellerMetricsClient = prisma,
) {
  const sellerProfileId = normalizedSellerProfileId(sellerProfileIdInput);
  const periodStartEpochMillis = epochMillis(periodStart);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_seller_metrics_facts(
        ${sellerProfileId}, ${periodStartEpochMillis}
      )
  `);
  return orderSellerMetricsFactsFromRows(rows);
}
