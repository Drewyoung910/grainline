import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  listingOrderArchiveBlockedFromRows,
  reportTargetAccessFromRows,
  reviewEligibilityFromRows,
  sellerVerificationSalesFromRows,
} from "@/lib/orderEligibilityState";

type OrderEligibilityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

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

export async function lockReviewEligibleOrderItem(
  input: { actorUserId: string; listingId: string; since: Date },
  client: OrderEligibilityClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const listingId = normalizedIdentifier(input.listingId, "Review listing id");
  const since = epochMillis(input.since, "Review eligibility timestamp");
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_review_eligibility_lock(
        ${actorUserId}, ${listingId}, ${since}
      )
  `);
  return reviewEligibilityFromRows(rows);
}

export async function canReportOrderTarget(
  input: { actorUserId: string; reportedUserId: string; orderId: string },
  client: OrderEligibilityClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const reportedUserId = normalizeDbUserContextUserId(input.reportedUserId);
  const orderId = normalizedIdentifier(input.orderId, "Reported Order id");
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_order_report_target_access(
      ${actorUserId}, ${reportedUserId}, ${orderId}
    ) AS value
  `;
  return reportTargetAccessFromRows(rows);
}

export async function getSellerVerificationOrderSales(
  input: { actorUserId: string; sellerProfileId: string },
  client: OrderEligibilityClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const sellerProfileId = normalizedIdentifier(
    input.sellerProfileId,
    "Verification seller profile id",
  );
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
      FROM public.grainline_order_seller_verification_sales(
        ${actorUserId}, ${sellerProfileId}
      )
  `;
  return sellerVerificationSalesFromRows(rows);
}

export async function getListingOrderArchiveBlocked(
  input: { actorUserId: string; listingId: string; now?: Date },
  client: OrderEligibilityClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const listingId = normalizedIdentifier(input.listingId, "Archive listing id");
  const now = epochMillis(input.now ?? new Date(), "Archive reference time");
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
      FROM public.grainline_listing_order_archive_blocked(
        ${actorUserId}, ${listingId}, ${now}
      )
  `;
  return listingOrderArchiveBlockedFromRows(rows);
}
