import type { Prisma } from "@prisma/client";

export type GuildMemberRevocationGuard =
  | { kind: "unresolved_case"; caseCreatedBefore: Date }
  | { kind: "listing_threshold"; listingsBelowThresholdBefore: Date };

export function guildMemberRevocationSellerWhere(
  sellerProfileId: string,
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

  // The fixed Case Guild predicate is re-run inside the caller's transaction
  // before this update and locks the exact blocking Case row. Keeping the
  // protected Case relation out of this Prisma filter lets later Case RLS deny
  // direct runtime reads without weakening the transition guard.
  return base;
}
