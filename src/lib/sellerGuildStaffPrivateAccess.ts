import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerGuildStaffPrivateClient = Pick<
  Prisma.TransactionClient,
  "sellerProfile" | "makerVerification"
>;

const sellerGuildStaffContactSelect = {
  userId: true,
  displayName: true,
} satisfies Prisma.SellerProfileSelect;

const sellerGuildStaffReinstatementSelect = {
  userId: true,
  displayName: true,
  ownerAccountActive: true,
} satisfies Prisma.SellerProfileSelect;

/** Compatibility boundary for staff Guild reads and transitions. The
 * implementation intentionally uses SellerProfile until the additive private
 * companion is installed and its fixed database operations are available. */
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

export function sellerGuildStaffMemberList(
  client: SellerGuildStaffPrivateClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: { guildLevel: "GUILD_MEMBER" },
    select: {
      id: true,
      displayName: true,
      guildMemberApprovedAt: true,
      featuredUntil: true,
    },
    orderBy: { guildMemberApprovedAt: "desc" },
    take: 50,
  });
}

export function sellerGuildStaffMasterList(
  client: SellerGuildStaffPrivateClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: { guildLevel: "GUILD_MASTER" },
    select: {
      id: true,
      displayName: true,
      guildMasterApprovedAt: true,
      featuredUntil: true,
    },
    orderBy: { guildMasterApprovedAt: "desc" },
    take: 50,
  });
}

export function sellerGuildStaffRevokedMemberList(
  client: SellerGuildStaffPrivateClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: { guildLevel: "NONE", guildMemberApprovedAt: { not: null } },
    select: { id: true, displayName: true, guildMemberApprovedAt: true },
    orderBy: { guildMemberApprovedAt: "desc" },
    take: 50,
  });
}

export function sellerGuildStaffMasterPendingList(
  client: SellerGuildStaffPrivateClient = prisma,
) {
  return client.makerVerification.findMany({
    where: { status: "GUILD_MASTER_PENDING" },
    orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
    take: 50,
    include: {
      sellerProfile: {
        select: {
          displayName: true,
          id: true,
          guildMasterAppliedAt: true,
          sellerMetrics: {
            select: {
              calculatedAt: true,
              periodMonths: true,
              averageRating: true,
              reviewCount: true,
              onTimeShippingRate: true,
              responseRate: true,
              totalSalesCents: true,
              completedOrderCount: true,
              activeCaseCount: true,
              accountAgeDays: true,
            },
          },
        },
      },
    },
  });
}
