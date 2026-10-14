import { prisma } from "@/lib/db";

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

export type SellerGuildMemberRevocation = {
  applied: boolean;
  auditId: string | null;
  reason: string | null;
  sellerUserId: string | null;
  guardKind: "unresolved_case" | "listing_threshold" | null;
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

export async function applySellerGuildMemberRevocation(
  sellerProfileId: string,
): Promise<SellerGuildMemberRevocation | null> {
  const rows = await prisma.$queryRaw<SellerGuildMemberRevocation[]>`
    SELECT *
      FROM public.grainline_seller_guild_member_revoke(
        ${sellerProfileId}
      )
  `;
  return rows[0] ?? null;
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
