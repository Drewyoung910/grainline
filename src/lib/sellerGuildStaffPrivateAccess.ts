import type { Prisma } from "@prisma/client";

type SellerGuildStaffReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerGuildStaffRosterRow = {
  id: string;
  displayName: string;
  guildMemberApprovedAt: Date | null;
  guildMasterApprovedAt: Date | null;
  featuredUntil: Date | null;
};

export type SellerGuildStaffRosterCohort =
  | "GUILD_MEMBER"
  | "GUILD_MASTER"
  | "REVOKED_MEMBER"
  | "FEATURED";

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

export type SellerGuildStaffMasterPendingRow = {
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
  metricsTotalSalesCents: bigint | number | null;
  metricsCompletedOrderCount: number | null;
  metricsActiveCaseCount: number | null;
  metricsAccountAgeDays: number | null;
};

function countResult(rows: Array<{ value: bigint | number }>, source: string) {
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new TypeError(`${source} returned an invalid count`);
  }
  return value as number;
}

function validateRosterRows(rows: SellerGuildStaffRosterRow[], take: number) {
  if (rows.length > take || rows.some((row) => (
    typeof row.id !== "string"
    || typeof row.displayName !== "string"
    || (row.guildMemberApprovedAt !== null && !(row.guildMemberApprovedAt instanceof Date))
    || (row.guildMasterApprovedAt !== null && !(row.guildMasterApprovedAt instanceof Date))
    || (row.featuredUntil !== null && !(row.featuredUntil instanceof Date))
  ))) {
    throw new TypeError("Seller Guild staff roster authority returned an invalid row");
  }
  return rows;
}

function mapMasterPendingRows(rows: SellerGuildStaffMasterPendingRow[], take?: number) {
  if ((take !== undefined && rows.length > take) || rows.some((row) => (
    typeof row.id !== "string"
    || typeof row.craftDescription !== "string"
    || (row.guildMasterCraftBusiness !== null && typeof row.guildMasterCraftBusiness !== "string")
    || !Number.isSafeInteger(row.yearsExperience)
    || (row.portfolioUrl !== null && typeof row.portfolioUrl !== "string")
    || !(row.appliedAt instanceof Date)
    || typeof row.sellerProfileId !== "string"
    || typeof row.sellerDisplayName !== "string"
    || (row.guildMasterAppliedAt !== null && !(row.guildMasterAppliedAt instanceof Date))
    || (row.metricsCalculatedAt !== null && !(row.metricsCalculatedAt instanceof Date))
    || (row.metricsPeriodMonths !== null && !Number.isSafeInteger(row.metricsPeriodMonths))
    || (row.metricsAverageRating !== null && typeof row.metricsAverageRating !== "number")
    || (row.metricsReviewCount !== null && !Number.isSafeInteger(row.metricsReviewCount))
    || (row.metricsOnTimeShippingRate !== null && typeof row.metricsOnTimeShippingRate !== "number")
    || (row.metricsResponseRate !== null && typeof row.metricsResponseRate !== "number")
    || (row.metricsTotalSalesCents !== null
      && typeof row.metricsTotalSalesCents !== "bigint"
      && !Number.isSafeInteger(row.metricsTotalSalesCents))
    || (row.metricsCompletedOrderCount !== null && !Number.isSafeInteger(row.metricsCompletedOrderCount))
    || (row.metricsActiveCaseCount !== null && !Number.isSafeInteger(row.metricsActiveCaseCount))
    || (row.metricsAccountAgeDays !== null && !Number.isSafeInteger(row.metricsAccountAgeDays))
    || (row.metricsCalculatedAt === null && (
      row.metricsPeriodMonths !== null
      || row.metricsAverageRating !== null
      || row.metricsReviewCount !== null
      || row.metricsOnTimeShippingRate !== null
      || row.metricsResponseRate !== null
      || row.metricsTotalSalesCents !== null
      || row.metricsCompletedOrderCount !== null
      || row.metricsActiveCaseCount !== null
      || row.metricsAccountAgeDays !== null
    ))
    || (row.metricsCalculatedAt !== null && (
      row.metricsPeriodMonths === null
      || row.metricsAverageRating === null
      || row.metricsReviewCount === null
      || row.metricsOnTimeShippingRate === null
      || row.metricsResponseRate === null
      || row.metricsTotalSalesCents === null
      || row.metricsCompletedOrderCount === null
      || row.metricsActiveCaseCount === null
      || row.metricsAccountAgeDays === null
    ))
  ))) {
    throw new TypeError("Seller Guild Master staff authority returned an invalid row");
  }

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

/** Fixed isolated-staff projections and atomic Guild transitions. */

export async function sellerGuildStaffRosterCount(
  client: SellerGuildStaffReadClient,
  input: { actorId: string; cohort: SellerGuildStaffRosterCohort },
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_seller_guild_staff_roster_count(
      ${input.actorId}::text,
      ${input.cohort}::text
    ) AS value
  `;
  return countResult(rows, "Seller Guild staff roster count authority");
}

export async function sellerGuildStaffRosterPage(
  client: SellerGuildStaffReadClient,
  input: {
    actorId: string;
    cohort: SellerGuildStaffRosterCohort;
    take?: number;
    cursorApprovedAt?: Date | null;
    cursorId?: string | null;
  },
) {
  const take = input.take ?? 50;
  if (!Number.isSafeInteger(take) || take < 1 || take > 100) {
    throw new RangeError("Seller Guild staff roster page size is outside the supported range");
  }
  const rows = await client.$queryRaw<SellerGuildStaffRosterRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_staff_roster_page(
        ${input.actorId}::text,
        ${input.cohort}::text,
        ${input.cursorApprovedAt ?? null}::timestamp,
        ${input.cursorId ?? null}::text,
        ${take}::integer
      )
  `;
  return validateRosterRows(rows, take);
}

export async function sellerGuildStaffMasterPendingCount(
  client: SellerGuildStaffReadClient,
  actorId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_seller_guild_staff_master_pending_count(
      ${actorId}::text
    ) AS value
  `;
  return countResult(rows, "Seller Guild Master pending count authority");
}

export async function sellerGuildStaffMasterPendingPage(
  client: SellerGuildStaffReadClient,
  input: {
    actorId: string;
    take?: number;
    cursorAppliedAt?: Date | null;
    cursorId?: string | null;
  },
) {
  const take = input.take ?? 50;
  if (!Number.isSafeInteger(take) || take < 1 || take > 100) {
    throw new RangeError("Seller Guild Master pending page size is outside the supported range");
  }
  const rows = await client.$queryRaw<SellerGuildStaffMasterPendingRow[]>`
    SELECT *
      FROM public.grainline_seller_guild_staff_master_pending_page(
        ${input.actorId}::text,
        ${input.cursorAppliedAt ?? null}::timestamp,
        ${input.cursorId ?? null}::text,
        ${take}::integer
      )
  `;
  return mapMasterPendingRows(rows, take);
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
  return mapMasterPendingRows(rows);
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
