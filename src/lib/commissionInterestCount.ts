import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

export { resolvedInterestedCount } from "@/lib/commissionInterestCountValue";

type CommissionInterestClient = typeof prisma | DbUserContextTransactionClient;

type CommissionInterestCountRow = {
  commissionRequestId: unknown;
  value: unknown;
};

type CommissionInterestCardRow = {
  interestId: unknown;
  createdAt: unknown;
  sellerProfileId: unknown;
  displayName: unknown;
  avatarImageUrl: unknown;
  ownerImageUrl: unknown;
  guildLevel: unknown;
};

export type PublicCommissionInterestCard = Readonly<{
  id: string;
  createdAt: Date;
  sellerProfile: Readonly<{
    id: string;
    displayName: string;
    avatarImageUrl: string | null;
    ownerImageUrl: string | null;
    guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  }>;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

async function readPublicCommissionInterestCounts(
  client: CommissionInterestClient,
  commissionRequestIds: readonly string[],
) {
  const rows = await client.$queryRaw<CommissionInterestCountRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_commission_interest_counts(
        ${[...commissionRequestIds]}::text[]
      )
  `);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (
      !validId(row.commissionRequestId)
      || typeof row.value !== "bigint"
      || row.value < 0n
      || row.value > BigInt(Number.MAX_SAFE_INTEGER)
      || counts.has(row.commissionRequestId)
    ) {
      throw new Error("Seller public commission-interest count authority returned an invalid result");
    }
    counts.set(row.commissionRequestId, Number(row.value));
  }
  return counts;
}

export async function publicCommissionInterestCounts(
  commissionRequestIds: readonly string[],
  viewerUserId: string | null,
) {
  if (
    commissionRequestIds.length < 1
    || commissionRequestIds.length > 100
    || commissionRequestIds.some((id) => !validId(id))
    || new Set(commissionRequestIds).size !== commissionRequestIds.length
  ) {
    throw new RangeError("Seller public commission-interest count input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readPublicCommissionInterestCounts(client, commissionRequestIds));
  }
  return readPublicCommissionInterestCounts(prisma, commissionRequestIds);
}

async function readPublicCommissionInterestCards(
  client: CommissionInterestClient,
  commissionRequestId: string,
  limit: number,
) {
  const rows = await client.$queryRaw<CommissionInterestCardRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_commission_interest_cards(
        ${commissionRequestId}::text,
        ${limit}::integer
      )
  `);
  const cards = rows.map((row) => {
    if (
      !validId(row.interestId)
      || !(row.createdAt instanceof Date)
      || Number.isNaN(row.createdAt.getTime())
      || !validId(row.sellerProfileId)
      || !isTextWithinCodePointRange(row.displayName, 1, 100)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.ownerImageUrl)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
    ) {
      throw new Error("Seller public commission-interest card authority returned an invalid result");
    }
    return Object.freeze({
      id: row.interestId,
      createdAt: row.createdAt,
      sellerProfile: Object.freeze({
        id: row.sellerProfileId,
        displayName: row.displayName,
        avatarImageUrl: row.avatarImageUrl,
        ownerImageUrl: row.ownerImageUrl,
        guildLevel: row.guildLevel as PublicCommissionInterestCard["sellerProfile"]["guildLevel"],
      }),
    }) satisfies PublicCommissionInterestCard;
  });
  if (
    cards.length > limit
    || new Set(cards.map(({ id }) => id)).size !== cards.length
  ) {
    throw new Error("Seller public commission-interest card authority returned invalid cardinality");
  }
  return Object.freeze(cards);
}

export async function publicCommissionInterestCards(
  commissionRequestId: string,
  viewerUserId: string | null,
  limit: number,
) {
  if (
    !validId(commissionRequestId)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100
  ) {
    throw new RangeError("Seller public commission-interest card input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readPublicCommissionInterestCards(client, commissionRequestId, limit));
  }
  return readPublicCommissionInterestCards(prisma, commissionRequestId, limit);
}
