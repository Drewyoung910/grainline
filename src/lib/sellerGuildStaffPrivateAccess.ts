import type { Prisma } from "@prisma/client";

type SellerGuildStaffReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerGuildStaffRosterRow = {
  id: string;
  displayName: string;
  guildMemberApprovedAt: Date | null;
  guildMasterApprovedAt: Date | null;
  featuredUntil: Date | null;
};

export type SellerGuildStaffTransitionOperation =
  | "APPROVE_GUILD_MEMBER"
  | "REJECT_GUILD_MEMBER"
  | "REVOKE_GUILD_MEMBER"
  | "APPROVE_GUILD_MASTER"
  | "REJECT_GUILD_MASTER"
  | "REVOKE_GUILD_MASTER"
  | "REINSTATE_GUILD_MEMBER";

export type SellerGuildStaffTransitionResult = {
  applied: boolean;
  auditId: string | null;
  sellerProfileId: string | null;
  sellerUserId: string | null;
  sellerDisplayName: string | null;
};

export type SellerStaffFeatureTransitionResult = {
  applied: boolean;
  auditId: string | null;
  sellerProfileId: string | null;
};

type SellerGuildStaffMasterPendingRow = {
  id: string;
  craftDescription: string;
  guildMasterCraftBusiness: string | null;
  yearsExperience: number;
  portfolioUrl: string | null;
  appliedAt: Date;
  sellerProfileId: string;
  sellerDisplayName: string;
  guildMasterAppliedAt: Date | null;
  metricsCalculatedAt: Date | null;
  metricsPeriodMonths: number | null;
  metricsAverageRating: number | null;
  metricsReviewCount: number | null;
  metricsOnTimeShippingRate: number | null;
  metricsResponseRate: number | null;
  metricsTotalSalesCents: bigint | null;
  metricsCompletedOrderCount: number | null;
  metricsActiveCaseCount: number | null;
  metricsAccountAgeDays: number | null;
};

/** Fixed isolated-staff projections and atomic Guild transitions. */

async function sellerGuildStaffRoster(
  client: SellerGuildStaffReadClient,
  actorId: string,
  cohort: "GUILD_MEMBER" | "GUILD_MASTER" | "REVOKED_MEMBER",
) {
  return client.$queryRaw<SellerGuildStaffRosterRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_staff_roster(
        ${actorId},
        ${cohort}
      )
  `;
}

export function sellerGuildStaffMemberList(
  client: SellerGuildStaffReadClient,
  actorId: string,
) {
  return sellerGuildStaffRoster(client, actorId, "GUILD_MEMBER");
}

export function sellerGuildStaffMasterList(
  client: SellerGuildStaffReadClient,
  actorId: string,
) {
  return sellerGuildStaffRoster(client, actorId, "GUILD_MASTER");
}

export function sellerGuildStaffRevokedMemberList(
  client: SellerGuildStaffReadClient,
  actorId: string,
) {
  return sellerGuildStaffRoster(client, actorId, "REVOKED_MEMBER");
}

export async function sellerGuildStaffMasterPendingList(
  client: SellerGuildStaffReadClient,
  actorId: string,
) {
  const rows = await client.$queryRaw<SellerGuildStaffMasterPendingRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_staff_master_pending(${actorId})
  `;
  return rows.map((row) => ({
    id: row.id,
    craftDescription: row.craftDescription,
    guildMasterCraftBusiness: row.guildMasterCraftBusiness,
    yearsExperience: row.yearsExperience,
    portfolioUrl: row.portfolioUrl,
    appliedAt: row.appliedAt,
    sellerProfileId: row.sellerProfileId,
    sellerProfile: {
      id: row.sellerProfileId,
      displayName: row.sellerDisplayName,
      guildMasterAppliedAt: row.guildMasterAppliedAt,
      sellerMetrics: row.metricsCalculatedAt === null ? null : {
        calculatedAt: row.metricsCalculatedAt,
        periodMonths: row.metricsPeriodMonths!,
        averageRating: row.metricsAverageRating!,
        reviewCount: row.metricsReviewCount!,
        onTimeShippingRate: row.metricsOnTimeShippingRate!,
        responseRate: row.metricsResponseRate!,
        totalSalesCents: row.metricsTotalSalesCents!,
        completedOrderCount: row.metricsCompletedOrderCount!,
        activeCaseCount: row.metricsActiveCaseCount!,
        accountAgeDays: row.metricsAccountAgeDays!,
      },
    },
  }));
}

export async function applySellerGuildStaffTransition(
  client: SellerGuildStaffReadClient,
  input: {
    actorId: string;
    operation: SellerGuildStaffTransitionOperation;
    verificationId?: string;
    sellerProfileId?: string;
    reviewNotes?: string | null;
    adminOverride?: boolean;
  },
) {
  const rows = await client.$queryRaw<SellerGuildStaffTransitionResult[]>`
    SELECT *
      FROM public.grainline_seller_guild_staff_transition(
        ${input.actorId},
        ${input.operation},
        ${input.verificationId ?? null},
        ${input.sellerProfileId ?? null},
        ${input.reviewNotes ?? null},
        ${input.adminOverride ?? false}
      )
  `;
  return rows[0] ?? null;
}

export async function applySellerStaffFeatureTransition(
  client: SellerGuildStaffReadClient,
  input: {
    actorId: string;
    sellerProfileId: string;
    operation: "FEATURE" | "UNFEATURE";
  },
) {
  const rows = await client.$queryRaw<SellerStaffFeatureTransitionResult[]>`
    SELECT *
      FROM public.grainline_seller_staff_feature_transition(
        ${input.actorId},
        ${input.sellerProfileId},
        ${input.operation}
      )
  `;
  const result = rows[0] ?? null;
  if (result
      && result.sellerProfileId !== null
      && result.sellerProfileId !== input.sellerProfileId) {
    throw new Error("Seller feature transition returned an invalid target");
  }
  if (result?.applied && !result.auditId) {
    throw new Error("Seller feature transition omitted its audit witness");
  }
  return result;
}
