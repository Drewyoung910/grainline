// src/lib/metrics.ts
import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";
import type { SellerMetricsResult } from "@/lib/metricsState";

const SELLER_PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type SellerMetricsRow = {
  sellerProfileId: unknown;
  calculatedAt: unknown;
  periodMonths: unknown;
  averageRating: unknown;
  reviewCount: unknown;
  onTimeShippingRate: unknown;
  responseRate: unknown;
  totalSalesCents: unknown;
  completedOrderCount: unknown;
  activeCaseCount: unknown;
  accountAgeDays: unknown;
};

type MetricsClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export {
  GUILD_MASTER_REQUIREMENTS,
  LISTING_VIEW_DAILY_RETENTION_DAYS,
  METRICS_PERIOD_DAYS_PER_MONTH,
  listingViewDailyRetentionCutoff,
  meetsGuildMasterRequirements,
  metricsPeriodStart,
  type SellerMetricsResult,
} from "@/lib/metricsState";

function validatePeriodMonths(periodMonths: number) {
  if (!Number.isInteger(periodMonths) || periodMonths < 1 || periodMonths > 12) {
    throw new RangeError("Seller metrics period is outside the supported range");
  }
  return periodMonths;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return Number(value);
}

function supportedPeriodMonths(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 12) {
    throw new TypeError("Seller metrics period is outside the supported range");
  }
  return Number(value);
}

function boundedRate(value: unknown, maximum: number, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return value;
}

function sellerMetricsResult(rows: SellerMetricsRow[]): SellerMetricsResult {
  if (rows.length !== 1) {
    throw new Error("Seller metrics authority returned an invalid row count");
  }
  const row = rows[0];
  if (
    !row
    || typeof row.sellerProfileId !== "string"
    || !SELLER_PROFILE_ID_PATTERN.test(row.sellerProfileId)
    || !(row.calculatedAt instanceof Date)
    || !Number.isFinite(row.calculatedAt.getTime())
    || typeof row.totalSalesCents !== "bigint"
    || row.totalSalesCents < 0n
    || row.totalSalesCents > MAX_SAFE_BIGINT
  ) {
    throw new Error("Seller metrics authority returned an invalid result");
  }

  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    calculatedAt: new Date(row.calculatedAt),
    periodMonths: supportedPeriodMonths(row.periodMonths),
    averageRating: boundedRate(row.averageRating, 5, "Seller average rating"),
    reviewCount: nonNegativeInteger(row.reviewCount, "Seller review count"),
    onTimeShippingRate: boundedRate(row.onTimeShippingRate, 1, "Seller shipping rate"),
    responseRate: boundedRate(row.responseRate, 1, "Seller response rate"),
    totalSalesCents: Number(row.totalSalesCents),
    completedOrderCount: nonNegativeInteger(
      row.completedOrderCount,
      "Seller completed-order count",
    ),
    activeCaseCount: nonNegativeInteger(row.activeCaseCount, "Seller active-case count"),
    accountAgeDays: nonNegativeInteger(row.accountAgeDays, "Seller account age"),
  });
}

async function readOwnerSellerMetrics(
  actorUserId: string,
  periodMonths: number,
  forceRefresh: boolean,
) {
  const period = validatePeriodMonths(periodMonths);
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<SellerMetricsRow[]>`
      SELECT *
        FROM public.grainline_seller_metrics_owner_state(
          ${period}::integer,
          ${forceRefresh}::boolean
        )
    `;
    return sellerMetricsResult(rows);
  }, { maxWait: 10_000, timeout: 30_000 });
}

/** Read an owner's fresh-enough private metrics, recalculating on cache miss. */
export function getFreshSellerMetrics(
  actorUserId: string,
  periodMonths = 3,
): Promise<SellerMetricsResult> {
  return readOwnerSellerMetrics(actorUserId, periodMonths, false);
}

/** Force a fresh owner-authorized calculation for Guild application. */
export function calculateSellerMetrics(
  actorUserId: string,
  periodMonths = 3,
): Promise<SellerMetricsResult> {
  return readOwnerSellerMetrics(actorUserId, periodMonths, true);
}

export async function clearSellerMetricsForAccountDeletion(
  client: MetricsClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ removed: number }>>`
    SELECT public.grainline_seller_metrics_account_deletion_clear(
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
    throw new Error("Seller metrics deletion authority returned an invalid result");
  }
  return rows[0].removed;
}
