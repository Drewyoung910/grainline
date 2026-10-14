import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerGuildStaffPrivateClient = Pick<
  Prisma.TransactionClient,
  "sellerProfile" | "makerVerification" | "$queryRaw"
>;

type SellerGuildStaffReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerGuildStaffRosterRow = {
  id: string;
  displayName: string;
  guildMemberApprovedAt: Date | null;
  guildMasterApprovedAt: Date | null;
  featuredUntil: Date | null;
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

const sellerGuildStaffContactSelect = {
  userId: true,
  displayName: true,
} satisfies Prisma.SellerProfileSelect;

const sellerGuildStaffReinstatementSelect = {
  userId: true,
  displayName: true,
  ownerAccountActive: true,
} satisfies Prisma.SellerProfileSelect;

/** Compatibility boundary for staff Guild reads and transitions. Read lists
 * use fixed isolated-staff database projections; transition writes remain on
 * SellerProfile until their paired database operation is prepared. */
export function sellerGuildStaffContact(
  sellerProfileId: string,
  client: SellerGuildStaffPrivateClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: sellerGuildStaffContactSelect,
  });
}

export function sellerGuildStaffReinstatementState(
  client: SellerGuildStaffPrivateClient,
  sellerProfileId: string,
) {
  return client.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: sellerGuildStaffReinstatementSelect,
  });
}

export function approveSellerGuildMember(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; approvedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, ownerAccountActive: true },
    data: {
      isVerifiedMaker: true,
      verifiedAt: input.approvedAt,
      guildLevel: "GUILD_MEMBER",
      guildMemberApprovedAt: input.approvedAt,
    },
  });
}

export function revokeSellerGuildMember(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; revokedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, guildLevel: "GUILD_MEMBER" },
    data: {
      guildLevel: "NONE",
      isVerifiedMaker: false,
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      listingsBelowThresholdSince: null,
      lastMetricCheckAt: input.revokedAt,
    },
  });
}

export function approveSellerGuildMaster(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; approvedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, ownerAccountActive: true },
    data: {
      guildLevel: "GUILD_MASTER",
      guildMasterApprovedAt: input.approvedAt,
    },
  });
}

export function recordSellerGuildMasterRejection(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; reviewNotes: string | null },
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId },
    data: { guildMasterReviewNotes: input.reviewNotes },
  });
}

export function revokeSellerGuildMaster(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; revokedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, guildLevel: "GUILD_MASTER" },
    data: {
      guildLevel: "GUILD_MEMBER",
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      lastMetricCheckAt: input.revokedAt,
      guildMasterApprovedAt: null,
      guildMasterAppliedAt: null,
      guildMasterReviewNotes: null,
    },
  });
}

export function reinstateSellerGuildMember(
  client: SellerGuildStaffPrivateClient,
  input: { sellerProfileId: string; reinstatedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      guildLevel: "NONE",
      guildMemberApprovedAt: { not: null },
      ownerAccountActive: true,
    },
    data: {
      guildLevel: "GUILD_MEMBER",
      isVerifiedMaker: true,
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      listingsBelowThresholdSince: null,
      lastMetricCheckAt: input.reinstatedAt,
    },
  });
}

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
