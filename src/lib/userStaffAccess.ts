import type { Prisma, Role } from "@prisma/client";

type UserStaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type UserStaffDirectoryRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  banned: boolean;
  bannedAt: Date | null;
  banReason: string | null;
  createdAt: Date;
  sellerDisplayName: string | null;
};

export type UserStaffEmailTarget = {
  id: string;
  name: string | null;
  email: string;
};

export type UserStaffReportLabel = UserStaffEmailTarget & {
  deletedAt: Date | null;
};

export type UserStaffAdminLabel = UserStaffReportLabel & {
  createdAt: Date;
};

export type UserStaffRecipient = UserStaffReportLabel & {
  banned: boolean;
};

export type UserStaffBanTarget = {
  role: Role;
  deletedAt: Date | null;
  banned: boolean;
  bannedAt: Date | null;
  clerkId: string;
};

export type UserBanRepairTarget = {
  clerkId: string;
  banned: boolean;
  deletedAt: Date | null;
  sellerProfileId: string | null;
  stripeAccountId: string | null;
};

export type UserStaffUnbanPriorState = {
  clerkId: string;
  banned: boolean;
  bannedAt: Date | null;
  banReason: string | null;
  bannedBy: string | null;
};

const ROLES = new Set<Role>(["USER", "EMPLOYEE", "ADMIN"]);
const CAPABILITY_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function optionalDate(value: unknown): value is Date | null {
  return value === null || value instanceof Date;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 254
    && value === value.trim().toLowerCase()
    && value.indexOf("@") > 0;
}

function validStaffEmailTarget(row: UserStaffEmailTarget | undefined): row is UserStaffEmailTarget {
  return Boolean(
    row
    && typeof row.id === "string"
    && optionalString(row.name)
    && validEmail(row.email),
  );
}

function validBanTarget(row: UserStaffBanTarget | undefined): row is UserStaffBanTarget {
  return Boolean(
    row
    && ROLES.has(row.role)
    && optionalDate(row.deletedAt)
    && typeof row.banned === "boolean"
    && optionalDate(row.bannedAt)
    && typeof row.clerkId === "string",
  );
}

export async function userStaffDirectoryCount(
  client: UserStaffClient,
  input: { actorId: string; query: string },
) {
  const rows = await client.$queryRaw<Array<{ value: bigint }>>`
    SELECT public.grainline_user_staff_directory_count(
      ${input.actorId}::text,
      ${input.query}::text
    ) AS value
  `;
  const value = rows[0]?.value;
  if (rows.length !== 1 || typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("User staff directory count authority returned an invalid result");
  }
  return Number(value);
}

export async function userStaffDirectoryPage(
  client: UserStaffClient,
  input: { actorId: string; query: string; page: number },
) {
  const rows = await client.$queryRaw<UserStaffDirectoryRow[]>`
    SELECT * FROM public.grainline_user_staff_directory_page(
      ${input.actorId}::text,
      ${input.query}::text,
      ${input.page}::integer
    )
  `;
  const ids = new Set<string>();
  if (rows.length > 30 || rows.some((row) => {
    const valid = typeof row.id === "string"
      && !ids.has(row.id)
      && validEmail(row.email)
      && optionalString(row.name)
      && ROLES.has(row.role)
      && typeof row.banned === "boolean"
      && optionalDate(row.bannedAt)
      && optionalString(row.banReason)
      && row.createdAt instanceof Date
      && optionalString(row.sellerDisplayName);
    ids.add(row.id);
    return !valid;
  })) {
    throw new Error("User staff directory authority returned an invalid result");
  }
  return rows;
}

export async function userStaffExactEmailTarget(
  client: UserStaffClient,
  input: { actorId: string; email: string },
) {
  const rows = await client.$queryRaw<UserStaffEmailTarget[]>`
    SELECT * FROM public.grainline_user_staff_exact_email_target(
      ${input.actorId}::text,
      ${input.email}::text
    )
  `;
  if (rows.length > 1 || (rows[0] && !validStaffEmailTarget(rows[0]))) {
    throw new Error("User staff exact-email authority returned an invalid result");
  }
  return rows[0] ?? null;
}

export async function userStaffReportLabels(
  client: UserStaffClient,
  input: { actorId: string; userIds: string[] },
) {
  if (input.userIds.length === 0) return [];
  const requested = new Set(input.userIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<UserStaffReportLabel[]>`
    SELECT * FROM public.grainline_user_staff_report_labels(
      ${input.actorId}::text,
      ${input.userIds}::text[]
    )
  `;
  if (rows.length > 5 || rows.some((row) => {
    const valid = validStaffEmailTarget(row)
      && optionalDate(row.deletedAt)
      && requested.has(row.id)
      && !returned.has(row.id);
    returned.add(row.id);
    return !valid;
  })) {
    throw new Error("User staff report-label authority returned an invalid result");
  }
  return rows;
}

export async function userStaffAdminLabels(
  client: UserStaffClient,
  input: { actorId: string; userIds: string[] },
) {
  if (input.userIds.length === 0) return [];
  if (input.userIds.length > 200) {
    throw new Error("User staff admin-label authority input exceeds its bound");
  }
  const requested = new Set(input.userIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<UserStaffAdminLabel[]>`
    SELECT * FROM public.grainline_user_staff_admin_labels(
      ${input.actorId}::text,
      ${input.userIds}::text[]
    )
  `;
  if (rows.length > requested.size || rows.some((row) => {
    const valid = validStaffEmailTarget(row)
      && optionalDate(row.deletedAt)
      && row.createdAt instanceof Date
      && requested.has(row.id)
      && !returned.has(row.id);
    returned.add(row.id);
    return !valid;
  })) {
    throw new Error("User staff admin-label authority returned an invalid result");
  }
  return rows;
}

export async function userStaffEmailRecipient(
  client: UserStaffClient,
  input: { actorId: string; userId?: string | null; email?: string | null },
) {
  const rows = await client.$queryRaw<UserStaffRecipient[]>`
    SELECT * FROM public.grainline_user_staff_email_recipient(
      ${input.actorId}::text,
      ${input.userId ?? null}::text,
      ${input.email ?? null}::text
    )
  `;
  const row = rows[0];
  if (
    rows.length > 1
    || (row && (!validStaffEmailTarget(row) || !optionalDate(row.deletedAt) || typeof row.banned !== "boolean"))
  ) {
    throw new Error("User staff email-recipient authority returned an invalid result");
  }
  return row ?? null;
}

export async function userStaffBanTarget(
  client: UserStaffClient,
  input: { actorId: string; targetId: string },
) {
  const rows = await client.$queryRaw<UserStaffBanTarget[]>`
    SELECT * FROM public.grainline_user_staff_ban_target(
      ${input.actorId}::text,
      ${input.targetId}::text
    )
  `;
  if (rows.length > 1 || (rows[0] && !validBanTarget(rows[0]))) {
    throw new Error("User staff ban-target authority returned an invalid result");
  }
  return rows[0] ?? null;
}

export async function userStaffBanApply(
  client: UserStaffClient,
  input: { capabilityId: string; targetId: string; bannedAt: Date; reason: string },
) {
  const rows = await client.$queryRaw<Array<{ clerkId: string }>>`
    SELECT * FROM public.grainline_user_staff_ban_apply(
      ${input.capabilityId}::text,
      ${input.targetId}::text,
      ${input.bannedAt}::timestamp,
      ${input.reason}::text
    )
  `;
  if (rows.length !== 1 || typeof rows[0]?.clerkId !== "string") {
    throw new Error("User staff ban authority returned an invalid result");
  }
  return rows[0];
}

export async function userStaffUnbanApply(
  client: UserStaffClient,
  input: { capabilityId: string; targetId: string; expectedBannedAt: Date | null },
) {
  const rows = await client.$queryRaw<UserStaffUnbanPriorState[]>`
    SELECT * FROM public.grainline_user_staff_unban_apply(
      ${input.capabilityId}::text,
      ${input.targetId}::text,
      ${input.expectedBannedAt}::timestamp
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || typeof row.clerkId !== "string"
    || typeof row.banned !== "boolean"
    || !optionalDate(row.bannedAt)
    || !optionalString(row.banReason)
    || !optionalString(row.bannedBy)
  ) {
    throw new Error("User staff unban authority returned an invalid result");
  }
  return row;
}

export async function mintUserStaffCapability(
  client: UserStaffClient,
  input: {
    actorId: string;
    targetId: string;
    operation: "USER_BAN" | "USER_UNBAN";
    expectedBannedAt: Date | null;
  },
) {
  const rows = await client.$queryRaw<Array<{ capabilityId: unknown }>>`
    SELECT public.grainline_user_staff_capability_mint(
      ${input.actorId}::text,
      ${input.targetId}::text,
      ${input.operation}::text,
      ${input.expectedBannedAt}::timestamp
    ) AS "capabilityId"
  `;
  const capabilityId = rows[0]?.capabilityId;
  if (
    rows.length !== 1
    || typeof capabilityId !== "string"
    || !CAPABILITY_ID_PATTERN.test(capabilityId)
  ) {
    throw new Error("User staff capability mint returned an invalid result");
  }
  return capabilityId;
}

export async function userBanRepairTarget(
  client: UserStaffClient,
  input: { originalActionId: string; targetId: string },
) {
  const rows = await client.$queryRaw<UserBanRepairTarget[]>`
    SELECT * FROM public.grainline_user_ban_repair_target(
      ${input.originalActionId}::text,
      ${input.targetId}::text
    )
  `;
  const row = rows[0];
  if (
    rows.length > 1
    || (row && (
      typeof row.clerkId !== "string"
      || typeof row.banned !== "boolean"
      || !optionalDate(row.deletedAt)
      || !optionalString(row.sellerProfileId)
      || !optionalString(row.stripeAccountId)
    ))
  ) {
    throw new Error("User ban repair-target authority returned an invalid result");
  }
  return row ?? null;
}
