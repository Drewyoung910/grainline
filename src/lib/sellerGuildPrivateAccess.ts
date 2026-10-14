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

export type SellerGuildMetricsAction =
  | "NOOP"
  | "MEMBER_CHECKED"
  | "MASTER_OK"
  | "MASTER_RECOVERED"
  | "MASTER_WARNED"
  | "MASTER_CONTINUED"
  | "MASTER_REVOKED";

export type SellerGuildMetricsTransition = {
  action: SellerGuildMetricsAction;
  auditId: string | null;
  warningSentAt: Date | null;
  sellerUserId: string;
};

/** Purpose-bound compatibility operations for Guild cron reads and mutations
 * during the additive SellerProfilePrivate transition. */
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

export async function applySellerGuildMetrics(input: {
  sellerProfileId: string;
  calculatedAt: Date;
}): Promise<SellerGuildMetricsTransition | null> {
  const rows = await prisma.$queryRaw<SellerGuildMetricsTransition[]>`
    SELECT *
      FROM public.grainline_seller_guild_metrics_apply(
        ${input.sellerProfileId},
        ${input.calculatedAt}
      )
  `;
  return rows[0] ?? null;
}
