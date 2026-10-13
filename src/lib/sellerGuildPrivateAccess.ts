import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  guildMemberRevocationSellerWhere,
  type GuildMemberRevocationGuard,
} from "@/lib/guildMemberRevocationState";

type SellerGuildPrivateClient = Pick<Prisma.TransactionClient, "sellerProfile">;

/** Compatibility boundary for Guild cron reads and mutations. Phase 1 keeps
 * the predecessor table implementation; the post-Phase-0 cutover replaces
 * these purpose-specific operations without changing cron behavior. */
export function sellerGuildMemberCronBatch(
  cursorId: string | null,
  pageSize: number,
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: {
      guildLevel: "GUILD_MEMBER",
      vacationMode: false,
    },
    orderBy: { id: "asc" },
    take: pageSize,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      listingsBelowThresholdSince: true,
    },
  });
}

export type SellerGuildMemberCronRow = Awaited<
  ReturnType<typeof sellerGuildMemberCronBatch>
>[number];

export function sellerGuildMetricsCronBatch(
  cursorId: string | null,
  pageSize: number,
  client: SellerGuildPrivateClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: {
      guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] },
      vacationMode: false,
    },
    orderBy: { id: "asc" },
    take: pageSize,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      consecutiveMetricFailures: true,
      metricWarningSentAt: true,
    },
  });
}

export type SellerGuildMetricsCronRow = Awaited<
  ReturnType<typeof sellerGuildMetricsCronBatch>
>[number];

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
