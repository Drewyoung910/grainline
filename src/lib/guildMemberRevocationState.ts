import { CaseStatus, type Prisma } from "@prisma/client";

export const GUILD_MEMBER_REVOKE_CASE_STATUSES = [
  CaseStatus.OPEN,
  CaseStatus.IN_DISCUSSION,
  CaseStatus.PENDING_CLOSE,
] as const;

export type GuildMemberRevocationGuard =
  | { kind: "unresolved_case"; caseCreatedBefore: Date }
  | { kind: "listing_threshold"; listingsBelowThresholdBefore: Date };

export function guildMemberRevocationCaseWhere(
  sellerUserId: string,
  guard: Extract<GuildMemberRevocationGuard, { kind: "unresolved_case" }>,
): Prisma.CaseWhereInput {
  return {
    sellerId: sellerUserId,
    status: { in: [...GUILD_MEMBER_REVOKE_CASE_STATUSES] },
    createdAt: { lt: guard.caseCreatedBefore },
  };
}

export function guildMemberRevocationSellerWhere(
  sellerProfileId: string,
  sellerUserId: string,
  guard: GuildMemberRevocationGuard,
): Prisma.SellerProfileWhereInput {
  const base: Prisma.SellerProfileWhereInput = {
    id: sellerProfileId,
    guildLevel: "GUILD_MEMBER",
  };

  if (guard.kind === "listing_threshold") {
    return {
      ...base,
      listingsBelowThresholdSince: { lt: guard.listingsBelowThresholdBefore },
    };
  }

  return {
    ...base,
    user: {
      casesAsSeller: {
        some: guildMemberRevocationCaseWhere(sellerUserId, guard),
      },
    },
  };
}
