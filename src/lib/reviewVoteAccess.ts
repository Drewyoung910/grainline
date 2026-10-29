import { Prisma } from "@prisma/client";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";

export const REVIEW_VOTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

export type ReviewVoteToggleStatus =
  | "OK"
  | "NOT_FOUND"
  | "SELF"
  | "OWN_LISTING";

type ReviewVoteToggleRow = {
  resultStatus: string;
  voted: boolean;
  helpfulCount: number;
};

type ReviewVoteExportRow = {
  reviewId: string;
  value: number;
  createdAt: Date;
  listingId: string;
};

function exactCount(value: unknown, label: string) {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

function assertReviewIds(reviewIds: string[]) {
  if (
    reviewIds.length < 1
    || reviewIds.length > 100
    || reviewIds.some((id) => !REVIEW_VOTE_ID_PATTERN.test(id))
  ) {
    throw new RangeError("Review vote ids are outside the supported range");
  }
}

export function isReviewVoteId(value: string) {
  return REVIEW_VOTE_ID_PATTERN.test(value);
}

export async function ownerReviewVoteIds(userId: string, reviewIds: string[]) {
  if (reviewIds.length === 0) return new Set<string>();
  const uniqueReviewIds = [...new Set(reviewIds)];
  assertReviewIds(uniqueReviewIds);
  return withDbUserContext(userId, async (client) => {
    const rows = await client.reviewVote.findMany({
      where: { userId, reviewId: { in: uniqueReviewIds } },
      select: { reviewId: true },
    });
    if (rows.some((row) => (
      typeof row.reviewId !== "string"
      || !uniqueReviewIds.includes(row.reviewId)
    ))) {
      throw new TypeError("Review vote owner state returned an invalid review id");
    }
    const voted = new Set(rows.map((row) => row.reviewId));
    if (voted.size !== rows.length) {
      throw new TypeError("Review vote owner state returned duplicate review ids");
    }
    return voted;
  });
}

export function toggleOwnerReviewVote(userId: string, reviewId: string) {
  if (!isReviewVoteId(reviewId)) {
    throw new RangeError("Review vote id is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ReviewVoteToggleRow[]>`
      SELECT
        result."resultStatus",
        result.voted,
        result."helpfulCount"
      FROM public.grainline_review_vote_owner_toggle(${reviewId}::text) AS result
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || !["OK", "NOT_FOUND", "SELF", "OWN_LISTING"].includes(row.resultStatus)
      || typeof row.voted !== "boolean"
      || !Number.isSafeInteger(row.helpfulCount)
      || row.helpfulCount < 0
      || (row.resultStatus !== "OK" && row.voted)
    ) {
      throw new TypeError("Review vote toggle authority returned an invalid result");
    }
    return row as ReviewVoteToggleRow & { resultStatus: ReviewVoteToggleStatus };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function exportOwnerReviewVotes(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ReviewVoteExportRow[]>`
      SELECT * FROM public.grainline_review_vote_owner_export()
    `;
    if (rows.some((row) => (
      typeof row.reviewId !== "string"
      || row.value !== 1
      || !(row.createdAt instanceof Date)
      || typeof row.listingId !== "string"
    ))) {
      throw new TypeError("Review vote export authority returned an invalid row");
    }
    return rows.map((row) => ({
      reviewId: row.reviewId,
      value: row.value,
      createdAt: row.createdAt,
      review: { listingId: row.listingId },
    }));
  });
}

export async function deleteAllOwnerReviewVotes(
  client: DbUserContextTransactionClient,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_review_vote_owner_delete_all() AS value
  `;
  if (rows.length !== 1) {
    throw new TypeError("Review vote deletion authority returned invalid cardinality");
  }
  return exactCount(rows[0]?.value, "Review vote deletion authority");
}
