import { ListingStatus, Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

const REVIEW_TARGET_STATUSES = new Set<ListingStatus>([
  ListingStatus.PENDING_REVIEW,
  ListingStatus.ACTIVE,
  ListingStatus.SOLD_OUT,
  ListingStatus.DRAFT,
]);

const REVIEW_SOURCE_STATUSES = new Set<ListingStatus>([
  ListingStatus.PENDING_REVIEW,
  ListingStatus.DRAFT,
  ListingStatus.HIDDEN,
  ListingStatus.SOLD,
  ListingStatus.SOLD_OUT,
  ListingStatus.REJECTED,
]);

export type VersionBoundListingAiReviewInput = Readonly<{
  listingId: string;
  reviewedAt: Date;
  sourceStatus: ListingStatus;
  status: ListingStatus;
  flags: readonly string[];
  score: number;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validReviewTransition(sourceStatus: ListingStatus, status: ListingStatus) {
  if (sourceStatus === ListingStatus.PENDING_REVIEW) {
    return REVIEW_TARGET_STATUSES.has(status);
  }
  return status === ListingStatus.PENDING_REVIEW || status === ListingStatus.ACTIVE;
}

/**
 * Apply an AI result only to the exact listing version the reviewer saw.
 * Returning false is an expected stale-result outcome; callers must not run
 * activation side effects for that result.
 */
export async function applyVersionBoundListingAiReviewTransition(
  userId: string,
  input: VersionBoundListingAiReviewInput,
) {
  if (
    !validId(input.listingId)
    || !(input.reviewedAt instanceof Date)
    || !Number.isFinite(input.reviewedAt.getTime())
    || !REVIEW_SOURCE_STATUSES.has(input.sourceStatus)
    || !REVIEW_TARGET_STATUSES.has(input.status)
    || !validReviewTransition(input.sourceStatus, input.status)
    || !Array.isArray(input.flags)
    || input.flags.length > 20
    || input.flags.some((flag) => !isTextWithinCodePointRange(flag, 0, 80))
    || !Number.isFinite(input.score)
    || input.score < 0
    || input.score > 1
  ) {
    throw new RangeError("Listing AI review transition input is invalid");
  }

  return withDbUserContext(userId, async (client) => {
    const flagsSql = input.flags.length > 0
      ? Prisma.sql`ARRAY[${Prisma.join([...input.flags])}]::text[]`
      : Prisma.sql`ARRAY[]::text[]`;
    const rows = await client.$queryRaw<Array<{ applied: unknown }>>(Prisma.sql`
      SELECT *
        FROM public.grainline_listing_owner_review_transition(
          ${input.listingId}::text,
          ${input.reviewedAt}::timestamp,
          ${input.sourceStatus}::text,
          ${input.status}::text,
          ${flagsSql},
          ${input.score}::double precision
        )
    `);
    if (rows.length !== 1 || typeof rows[0]?.applied !== "boolean") {
      throw new Error("Listing AI review transition authority returned an invalid result");
    }
    return rows[0].applied;
  });
}
