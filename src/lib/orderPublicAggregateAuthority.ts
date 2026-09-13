import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  fulfilledOrderCountFromRows,
  publicListingOrderCountsFromRows,
  publicMarketplaceListingMetricsFromRows,
  publicSellerOrderStatsFromRows,
} from "@/lib/orderPublicAggregateState";

type PublicAggregateClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function normalizedIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 191) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function epochMillis(value: Date, label: string) {
  const result = value.getTime();
  if (!Number.isSafeInteger(result) || result < 0 || result > 253402300799999) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

export async function getPublicFulfilledOrderCount(
  client: PublicAggregateClient = prisma,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_order_public_fulfilled_count() AS value
  `;
  return fulfilledOrderCountFromRows(rows);
}

export async function getPublicSellerOrderStats(
  input: { sellerProfileId: string; recentShippingSince: Date },
  client: PublicAggregateClient = prisma,
) {
  const sellerProfileId = normalizedIdentifier(
    input.sellerProfileId,
    "Public seller profile id",
  );
  const recentShippingSince = epochMillis(
    input.recentShippingSince,
    "Public seller shipping cutoff",
  );
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
      FROM public.grainline_order_public_seller_stats(
        ${sellerProfileId}, ${recentShippingSince}
      )
  `;
  return publicSellerOrderStatsFromRows(rows);
}

export async function getPublicListingOrderCounts(
  listingIds: string[],
  client: PublicAggregateClient = prisma,
) {
  const normalized = listingIds.map((id) =>
    normalizedIdentifier(id, "Public listing id")
  );
  if (
    normalized.length < 1
    || normalized.length > 200
    || new Set(normalized).size !== normalized.length
  ) {
    throw new TypeError("Public listing id batch is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_public_listing_counts(${normalized}::text[])
  `);
  return publicListingOrderCountsFromRows(rows);
}

export async function getPublicMarketplaceListingMetrics(
  client: PublicAggregateClient = prisma,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_order_public_marketplace_listing_metrics()
  `;
  return publicMarketplaceListingMetricsFromRows(rows);
}
