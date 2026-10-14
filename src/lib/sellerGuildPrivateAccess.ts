import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  guildMemberRevocationSellerWhere,
  type GuildMemberRevocationGuard,
} from "@/lib/guildMemberRevocationState";

type SellerGuildPrivateClient = Pick<Prisma.TransactionClient, "sellerProfile">;

export type SellerGuildMemberCronRow = {
  id: string;
  userId: string;
  guildLevel: "GUILD_MEMBER";
  listingsBelowThresholdSince: Date | null;
};

export type SellerGuildMetricsCronRow = {
  id: string;
  userId: string;
  guildLevel: "GUILD_MEMBER" | "GUILD_MASTER";
  consecutiveMetricFailures: number;
  metricWarningSentAt: Date | null;
};

/** Compatibility boundary for Guild cron reads and mutations. Phase 1 keeps
 * the predecessor table implementation; the post-Phase-0 cutover replaces
 * these purpose-specific operations without changing cron behavior. */
export async function sellerGuildMemberCronBatch(
  cursorId: string | null,
  pageSize: number,
): Promise<SellerGuildMemberCronRow[]> {
  return prisma.$queryRaw<SellerGuildMemberCronRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_member_cron_batch(
        ${cursorId},
        ${pageSize}
      )
  `;
}

export async function sellerGuildMetricsCronBatch(
  cursorId: string | null,
  pageSize: number,
): Promise<SellerGuildMetricsCronRow[]> {
  return prisma.$queryRaw<SellerGuildMetricsCronRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_metrics_cron_batch(
        ${cursorId},
        ${pageSize}
      )
  `;
}

export function recordSellerGuildMemberRevocation(
  client: SellerGuildPrivateClient,
  input: {
    sellerProfileId: string;
    guard: GuildMemberRevocationGuard;
  },
) {
  return client.sellerProfile.updateMany({
    where: guildMemberRevocationSellerWhere(
      input.sellerProfileId,
      input.guard,
    ),
    data: {
      guildLevel: "NONE",
      isVerifiedMaker: false,
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
    },
  });
}

export function recordSellerGuildMetricCheck(
  input: {
    sellerProfileId: string;
    guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
    checkedAt: Date;
  },
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, guildLevel: input.guildLevel },
    data: { lastMetricCheckAt: input.checkedAt },
  });
}

export function resetSellerGuildMasterMetricFailures(
  input: { sellerProfileId: string; checkedAt: Date },
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.updateMany({
    where: { id: input.sellerProfileId, guildLevel: "GUILD_MASTER" },
    data: {
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      lastMetricCheckAt: input.checkedAt,
    },
  });
}

export function warnSellerGuildMasterMetrics(
  client: SellerGuildPrivateClient,
  input: { sellerProfileId: string; warnedAt: Date },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      guildLevel: "GUILD_MASTER",
      consecutiveMetricFailures: 0,
    },
    data: {
      consecutiveMetricFailures: 1,
      metricWarningSentAt: input.warnedAt,
      lastMetricCheckAt: input.warnedAt,
    },
  });
}

export function continueSellerGuildMasterWarning(
  input: {
    sellerProfileId: string;
    warningSentAt: Date;
    checkedAt: Date;
  },
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      guildLevel: "GUILD_MASTER",
      consecutiveMetricFailures: { gt: 0 },
    },
    data: {
      metricWarningSentAt: input.warningSentAt,
      lastMetricCheckAt: input.checkedAt,
    },
  });
}

export function recordSellerGuildMasterRecovery(
  input: { sellerProfileId: string; checkedAt: Date },
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      guildLevel: "GUILD_MASTER",
      consecutiveMetricFailures: { gt: 0 },
    },
    data: {
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      lastMetricCheckAt: input.checkedAt,
    },
  });
}

export function recordSellerGuildMasterRevocation(
  client: SellerGuildPrivateClient,
  input: {
    sellerProfileId: string;
    warningSentBefore: Date;
    checkedAt: Date;
  },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      guildLevel: "GUILD_MASTER",
      consecutiveMetricFailures: { gt: 0 },
      metricWarningSentAt: { lte: input.warningSentBefore },
    },
    data: {
      guildLevel: "GUILD_MEMBER",
      isVerifiedMaker: true,
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
      lastMetricCheckAt: input.checkedAt,
      guildMasterApprovedAt: null,
      guildMasterAppliedAt: null,
      guildMasterReviewNotes: null,
    },
  });
}
