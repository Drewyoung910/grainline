import type { Prisma } from "@prisma/client";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";

type StaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const VERIFICATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "GUILD_MASTER_PENDING",
  "GUILD_MASTER_APPROVED",
  "GUILD_MASTER_REJECTED",
] as const;

export type MakerVerificationStatus = typeof VERIFICATION_STATUSES[number];

type OwnerApplicationRow = {
  applied: boolean;
  id: string | null;
  status: string | null;
  appliedAt: Date | null;
};

export type MakerVerificationExportRow = {
  id: string;
  sellerProfileId: string;
  craftDescription: string;
  guildMasterCraftBusiness: string | null;
  yearsExperience: number;
  portfolioUrl: string | null;
  status: MakerVerificationStatus;
  reviewNotes: string | null;
  appliedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MakerVerificationStaffPendingRow = {
  id: string;
  craftDescription: string;
  yearsExperience: number;
  portfolioUrl: string | null;
  appliedAt: Date;
  sellerProfileId: string;
};

function isStatus(value: unknown): value is MakerVerificationStatus {
  return typeof value === "string"
    && VERIFICATION_STATUSES.includes(value as MakerVerificationStatus);
}

function validateApplicationRow(rows: OwnerApplicationRow[]) {
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || typeof row.applied !== "boolean"
    || (row.id !== null && typeof row.id !== "string")
    || (row.status !== null && !isStatus(row.status))
    || (row.appliedAt !== null && !(row.appliedAt instanceof Date))
    || (row.applied && (row.id === null || row.status === null || row.appliedAt === null))
  ) {
    throw new TypeError("Maker verification application authority returned an invalid result");
  }
  return row;
}

export function applyOwnerGuildMemberVerification(
  actorUserId: string,
  input: {
    craftDescription: string;
    yearsExperience: number;
    portfolioUrl: string | null;
    confirmedHandmade: boolean;
  },
) {
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<OwnerApplicationRow[]>`
      SELECT *
        FROM public.grainline_maker_verification_owner_member_apply(
          ${input.craftDescription}::text,
          ${input.yearsExperience}::integer,
          ${input.portfolioUrl}::text,
          ${input.confirmedHandmade}::boolean
        )
    `;
    return validateApplicationRow(rows);
  });
}

export function applyOwnerGuildMasterVerification(
  actorUserId: string,
  input: {
    craftBusiness: string;
    portfolioUrl: string | null;
    confirmedStandards: boolean;
  },
) {
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<OwnerApplicationRow[]>`
      SELECT *
        FROM public.grainline_maker_verification_owner_master_apply(
          ${input.craftBusiness}::text,
          ${input.portfolioUrl}::text,
          ${input.confirmedStandards}::boolean
        )
    `;
    return validateApplicationRow(rows);
  });
}

export function exportOwnerMakerVerification(actorUserId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<MakerVerificationExportRow[]>`
      SELECT * FROM public.grainline_maker_verification_owner_export()
    `;
    if (rows.length > 1 || rows.some((row) => (
      typeof row.id !== "string"
      || typeof row.sellerProfileId !== "string"
      || typeof row.craftDescription !== "string"
      || (row.guildMasterCraftBusiness !== null && typeof row.guildMasterCraftBusiness !== "string")
      || !Number.isSafeInteger(row.yearsExperience)
      || (row.portfolioUrl !== null && typeof row.portfolioUrl !== "string")
      || !isStatus(row.status)
      || (row.reviewNotes !== null && typeof row.reviewNotes !== "string")
      || !(row.appliedAt instanceof Date)
      || (row.reviewedAt !== null && !(row.reviewedAt instanceof Date))
      || !(row.createdAt instanceof Date)
      || !(row.updatedAt instanceof Date)
    ))) {
      throw new TypeError("Maker verification export authority returned an invalid result");
    }
    return rows[0] ?? null;
  });
}

export async function redactOwnerMakerVerificationForDeletion(
  client: DbUserContextTransactionClient,
  appliedAt: Date,
) {
  const rows = await client.$queryRaw<Array<{ redacted: boolean }>>`
    SELECT public.grainline_maker_verification_owner_delete_redact(
      ${appliedAt}::timestamp
    ) AS redacted
  `;
  if (rows.length !== 1 || typeof rows[0]?.redacted !== "boolean") {
    throw new TypeError("Maker verification deletion authority returned an invalid result");
  }
  return rows[0].redacted;
}

export async function makerVerificationStaffPendingCount(
  client: StaffClient,
  actorId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_maker_verification_staff_pending_count(
      ${actorId}::text
    ) AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new TypeError("Maker verification pending count authority returned an invalid result");
  }
  return value as number;
}

export async function makerVerificationStaffPendingPage(
  client: StaffClient,
  input: {
    actorId: string;
    take?: number;
    cursorAppliedAt?: Date | null;
    cursorId?: string | null;
  },
) {
  const take = input.take ?? 50;
  if (!Number.isSafeInteger(take) || take < 1 || take > 100) {
    throw new RangeError("Maker verification pending page size is outside the supported range");
  }
  const rows = await client.$queryRaw<MakerVerificationStaffPendingRow[]>`
    SELECT *
      FROM public.grainline_maker_verification_staff_pending_page(
        ${input.actorId}::text,
        ${input.cursorAppliedAt ?? null}::timestamp,
        ${input.cursorId ?? null}::text,
        ${take}::integer
      )
  `;
  if (rows.length > take || rows.some((row) => (
    typeof row.id !== "string"
    || typeof row.craftDescription !== "string"
    || !Number.isSafeInteger(row.yearsExperience)
    || (row.portfolioUrl !== null && typeof row.portfolioUrl !== "string")
    || !(row.appliedAt instanceof Date)
    || typeof row.sellerProfileId !== "string"
  ))) {
    throw new TypeError("Maker verification pending page authority returned an invalid row");
  }
  return rows;
}
