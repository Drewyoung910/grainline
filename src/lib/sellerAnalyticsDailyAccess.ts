import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";

type AnalyticsClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type EngagementRow = {
  listing_views: bigint;
  listing_clicks: bigint;
  profile_views: bigint;
  bucket_epoch_millis: bigint | null;
  bucket_views: bigint;
  bucket_clicks: bigint;
};

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function safeCount(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_BIGINT) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return Number(value);
}

function epochMillis(value: bigint, label: string) {
  if (typeof value !== "bigint" || value < 0n || value > 253402300799999n) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return Number(value);
}

async function recordListingAnalyticsWithClient(
  client: AnalyticsClient,
  listingId: string,
  kind: "view" | "click",
) {
  const rows = await client.$queryRaw<Array<{ recorded: boolean }>>`
    SELECT public.grainline_listing_analytics_record(
      ${listingId}::text,
      ${kind}::text
    ) AS recorded
  `;
  if (rows.length !== 1 || typeof rows[0]?.recorded !== "boolean") {
    throw new Error("Listing analytics authority returned an invalid result");
  }
  return rows[0].recorded;
}

export function recordListingAnalytics(
  listingId: string,
  kind: "view" | "click",
  viewerUserId: string | null,
) {
  if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(listingId)) {
    throw new RangeError("Listing analytics id is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      recordListingAnalyticsWithClient(client, listingId, kind));
  }
  return recordListingAnalyticsWithClient(prisma, listingId, kind);
}

export type SellerEngagementGrouping = "hour" | "day" | "month" | "year";

export type SellerEngagementAnalytics = Readonly<{
  listingViews: number;
  listingClicks: number;
  profileViews: number;
  buckets: ReadonlyArray<Readonly<{
    date: Date;
    views: number;
    clicks: number;
  }>>;
}>;

export function readSellerEngagementAnalytics(
  actorUserId: string,
  input: {
    startDate: Date;
    endDate: Date;
    endExclusive: boolean;
    grouping: SellerEngagementGrouping;
  },
) {
  const startMillis = input.startDate.getTime();
  const endMillis = input.endDate.getTime();
  if (
    !Number.isSafeInteger(startMillis)
    || !Number.isSafeInteger(endMillis)
    || startMillis < 0
    || endMillis < startMillis
    || typeof input.endExclusive !== "boolean"
  ) {
    throw new RangeError("Seller engagement analytics range is invalid");
  }

  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<EngagementRow[]>`
      SELECT * FROM public.grainline_seller_engagement_analytics(
        ${BigInt(startMillis)}::bigint,
        ${BigInt(endMillis)}::bigint,
        ${input.endExclusive}::boolean,
        ${input.grouping}::text
      )
    `;
    if (rows.length === 0) return null;

    const first = rows[0];
    if (!first) return null;
    const listingViews = safeCount(first.listing_views, "Seller listing views");
    const listingClicks = safeCount(first.listing_clicks, "Seller listing clicks");
    const profileViews = safeCount(first.profile_views, "Seller profile views");
    const buckets = rows.flatMap((row) => {
      if (
        row.listing_views !== first.listing_views
        || row.listing_clicks !== first.listing_clicks
        || row.profile_views !== first.profile_views
      ) {
        throw new Error("Seller engagement authority returned inconsistent totals");
      }
      if (row.bucket_epoch_millis === null) {
        if (rows.length !== 1 || row.bucket_views !== 0n || row.bucket_clicks !== 0n) {
          throw new Error("Seller engagement authority returned an invalid empty bucket");
        }
        return [];
      }
      return [Object.freeze({
        date: new Date(epochMillis(row.bucket_epoch_millis, "Seller engagement bucket")),
        views: safeCount(row.bucket_views, "Seller bucket views"),
        clicks: safeCount(row.bucket_clicks, "Seller bucket clicks"),
      })];
    });

    return Object.freeze({
      listingViews,
      listingClicks,
      profileViews,
      buckets: Object.freeze(buckets),
    }) satisfies SellerEngagementAnalytics;
  });
}

type RetentionRow = {
  listing_deleted: number;
  profile_deleted: number;
  listing_complete: boolean;
  profile_complete: boolean;
};

async function pruneSellerAnalyticsDailyBatch(batchSize: number) {
  const rows = await prisma.$queryRaw<RetentionRow[]>`
    SELECT * FROM public.grainline_seller_analytics_retention_prune(
      ${batchSize}::integer
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !Number.isSafeInteger(row?.listing_deleted)
    || row.listing_deleted < 0
    || !Number.isSafeInteger(row.profile_deleted)
    || row.profile_deleted < 0
    || typeof row.listing_complete !== "boolean"
    || typeof row.profile_complete !== "boolean"
  ) {
    throw new Error("Seller analytics retention authority returned an invalid result");
  }
  return row;
}

export async function pruneSellerAnalyticsDaily(input: {
  batchSize: number;
  timeBudgetMs: number;
  now?: () => number;
}) {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 5000) {
    throw new RangeError("Seller analytics retention batch is outside the supported range");
  }
  if (!Number.isFinite(input.timeBudgetMs) || input.timeBudgetMs < 0) {
    throw new RangeError("Seller analytics retention time budget is invalid");
  }

  const now = input.now ?? Date.now;
  const deadline = now() + input.timeBudgetMs;
  let listingDeleted = 0;
  let profileDeleted = 0;
  let listingComplete = false;
  let profileComplete = false;

  while (now() < deadline && (!listingComplete || !profileComplete)) {
    const row = await pruneSellerAnalyticsDailyBatch(input.batchSize);
    listingDeleted += row.listing_deleted;
    profileDeleted += row.profile_deleted;
    listingComplete ||= row.listing_complete;
    profileComplete ||= row.profile_complete;
  }

  return Object.freeze({ listingDeleted, profileDeleted, listingComplete, profileComplete });
}

export async function clearSellerProfileViewDailyForAccountDeletion(
  client: AnalyticsClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ removed: number }>>`
    SELECT public.grainline_seller_profile_view_daily_account_deletion_clear(
      ${input.sideEffectId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    ) AS removed
  `;
  if (
    rows.length !== 1
    || !Number.isSafeInteger(rows[0]?.removed)
    || rows[0].removed < 0
  ) {
    throw new Error("Seller profile-view deletion authority returned an invalid result");
  }
  return rows[0].removed;
}
