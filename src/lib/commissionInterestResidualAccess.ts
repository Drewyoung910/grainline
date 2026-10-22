import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";

type CommissionInterestClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type OwnerSummaryRow = {
  commissionRequestId: unknown;
  interestedCount: unknown;
  interestId: unknown;
  sellerProfileId: unknown;
  displayName: unknown;
  avatarImageUrl: unknown;
  ownerImageUrl: unknown;
};

type ServiceTargetRow = {
  userId: unknown;
};

export type OwnerCommissionInterestCard = Readonly<{
  id: string;
  sellerProfile: Readonly<{
    id: string;
    displayName: string;
    avatarImageUrl: string | null;
    ownerImageUrl: string | null;
  }>;
}>;

export type OwnerCommissionInterestSummary = Readonly<{
  interestedCount: number;
  interests: ReadonlyArray<OwnerCommissionInterestCard>;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

async function readOwnerCommissionInterestSummaries(
  client: CommissionInterestClient,
  commissionRequestIds: readonly string[],
  limit: number,
) {
  const rows = await client.$queryRaw<OwnerSummaryRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_commission_interest_summaries(
        ${[...commissionRequestIds]}::text[],
        ${limit}::integer
      )
  `;
  const summaries = new Map<string, {
    interestedCount: number;
    interests: OwnerCommissionInterestCard[];
  }>();
  for (const requestId of commissionRequestIds) {
    summaries.set(requestId, { interestedCount: -1, interests: [] });
  }
  for (const row of rows) {
    const summary = validId(row.commissionRequestId)
      ? summaries.get(row.commissionRequestId)
      : undefined;
    if (
      !summary
      || typeof row.interestedCount !== "bigint"
      || row.interestedCount < 0n
      || row.interestedCount > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("Seller owner commission-interest authority returned an invalid result");
    }
    const interestedCount = Number(row.interestedCount);
    if (summary.interestedCount !== -1 && summary.interestedCount !== interestedCount) {
      throw new Error("Seller owner commission-interest authority returned inconsistent counts");
    }
    summary.interestedCount = interestedCount;
    const isEmptyCard = row.interestId === null
      && row.sellerProfileId === null
      && row.displayName === null
      && row.avatarImageUrl === null
      && row.ownerImageUrl === null;
    if (isEmptyCard) continue;
    if (
      !validId(row.interestId)
      || !validId(row.sellerProfileId)
      || typeof row.displayName !== "string"
      || row.displayName.length < 1
      || row.displayName.length > 100
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.ownerImageUrl)
    ) {
      throw new Error("Seller owner commission-interest authority returned an invalid card");
    }
    summary.interests.push(Object.freeze({
      id: row.interestId,
      sellerProfile: Object.freeze({
        id: row.sellerProfileId,
        displayName: row.displayName,
        avatarImageUrl: row.avatarImageUrl,
        ownerImageUrl: row.ownerImageUrl,
      }),
    }));
  }
  const result = new Map<string, OwnerCommissionInterestSummary>();
  for (const [requestId, summary] of summaries) {
    if (
      summary.interestedCount < 0
      || summary.interests.length > limit
      || new Set(summary.interests.map(({ id }) => id)).size !== summary.interests.length
    ) {
      throw new Error(`Seller owner commission-interest authority omitted ${requestId}`);
    }
    result.set(requestId, Object.freeze({
      interestedCount: summary.interestedCount,
      interests: Object.freeze(summary.interests),
    }));
  }
  return result as ReadonlyMap<string, OwnerCommissionInterestSummary>;
}

export function ownerCommissionInterestSummaries(
  actorUserId: string,
  commissionRequestIds: readonly string[],
  limit: number,
) {
  if (
    !validId(actorUserId)
    || commissionRequestIds.length < 1
    || commissionRequestIds.length > 30
    || commissionRequestIds.some((id) => !validId(id))
    || new Set(commissionRequestIds).size !== commissionRequestIds.length
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 10
  ) {
    throw new RangeError("Seller owner commission-interest input is outside the supported range");
  }
  return withDbUserContext(actorUserId, (client) =>
    readOwnerCommissionInterestSummaries(client, commissionRequestIds, limit));
}

export async function commissionInterestNotificationTargets(
  commissionRequestId: string,
  limit: number,
) {
  if (
    !validId(commissionRequestId)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 10000
  ) {
    throw new RangeError("Seller service commission-interest input is outside the supported range");
  }
  const rows = await prisma.$queryRaw<ServiceTargetRow[]>`
    SELECT *
      FROM public.grainline_seller_service_commission_interest_targets(
        ${commissionRequestId}::text,
        ${limit}::integer
      )
  `;
  const userIds = rows.map(({ userId }) => {
    if (!validId(userId)) {
      throw new Error("Seller service commission-interest authority returned an invalid result");
    }
    return userId;
  });
  if (userIds.length > limit || new Set(userIds).size !== userIds.length) {
    throw new Error("Seller service commission-interest authority returned invalid cardinality");
  }
  return Object.freeze(userIds);
}
