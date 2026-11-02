import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type QueryClient = Pick<DbUserContextTransactionClient, "$queryRaw">;
type StaffQueryClient = Pick<PrismaClient, "$queryRaw">;

export type AdminAuditLogAppendInput = Readonly<{
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}>;

export type AdminAuditLogStaffRow = Readonly<{
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  undone: boolean;
  createdAt: Date;
  actorKind: "staff" | "user" | "automated";
}>;

export type AdminAuditLogUndoSource = Readonly<{
  id: string;
  adminId: string;
  action: "BAN_USER" | "REMOVE_LISTING" | "HOLD_LISTING";
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata: Prisma.JsonValue;
  undone: boolean;
  createdAt: Date;
  latestUndoSyncAction:
    | "UNDO_BAN_USER_CLERK_SYNC"
    | "UNDO_BAN_USER_CLERK_SYNC_FAILED"
    | null;
}>;

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/u;
const ACTOR_KINDS = new Set(["staff", "user", "automated"]);
const BAN_REPAIR_ACTIONS = new Set([
  "BAN_USER_CLERK_SYNC",
  "BAN_USER_CLERK_SYNC_FAILED",
  "BAN_USER_CHECKOUT_SESSIONS_EXPIRED",
]);
const UNDOABLE_ACTIONS = new Set(["BAN_USER", "REMOVE_LISTING", "HOLD_LISTING"]);

function validId(value: unknown, maximum = 255): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && ID_PATTERN.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validActionFilter(value: string | null) {
  return value === null || isTextWithinCodePointRange(value, 1, 100);
}

function validRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validJsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === undefined) return false;
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

export async function appendAdminAuditLog(
  client: QueryClient,
  input: AdminAuditLogAppendInput,
) {
  const metadata = input.metadata ?? {};
  if (
    !validId(input.adminId, 191)
    || !isTextWithinCodePointRange(input.action, 1, 100)
    || !isTextWithinCodePointRange(input.targetType, 1, 100)
    || !isTextWithinCodePointRange(input.targetId, 1, 255)
    || (input.reason !== undefined && !isTextWithinCodePointRange(input.reason, 0, 1000))
    || Array.isArray(metadata)
  ) {
    throw new RangeError("Admin audit append input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ id: unknown; createdAt: unknown }>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_append(
      ${input.adminId}::text,
      ${input.action}::text,
      ${input.targetType}::text,
      ${input.targetId}::text,
      ${input.reason ?? null}::text,
      ${JSON.stringify(metadata)}::jsonb
    )
  `);
  const row = rows[0];
  if (rows.length !== 1 || !row || !validId(row.id, 191) || !validDate(row.createdAt)) {
    throw new TypeError("Admin audit append authority returned an invalid result");
  }
  return Object.freeze({ id: row.id, createdAt: row.createdAt });
}

export function appendAdminAuditLogForActor(input: AdminAuditLogAppendInput) {
  return withDbUserContext(input.adminId, (client) => appendAdminAuditLog(client, input));
}

export async function adminAuditLogStaffCount(
  client: StaffQueryClient,
  input: { actorId: string; action: string | null },
) {
  if (!validId(input.actorId, 191) || !validActionFilter(input.action)) {
    throw new RangeError("Admin audit staff count input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>(Prisma.sql`
    SELECT public.grainline_admin_audit_staff_count(
      ${input.actorId}::text,
      ${input.action}::text
    ) AS value
  `);
  const value = rows[0]?.value;
  if (
    rows.length !== 1
    || typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("Admin audit staff count authority returned an invalid result");
  }
  return Number(value);
}

export async function adminAuditLogStaffPage(
  client: StaffQueryClient,
  input: { actorId: string; action: string | null; offset: number; limit: number },
) {
  if (
    !validId(input.actorId, 191)
    || !validActionFilter(input.action)
    || !Number.isSafeInteger(input.offset)
    || input.offset < 0
    || input.offset > 29970
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new RangeError("Admin audit staff page input is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_staff_page(
      ${input.actorId}::text,
      ${input.action}::text,
      ${input.offset}::integer,
      ${input.limit}::integer
    )
  `);
  if (rows.length > input.limit) {
    throw new TypeError("Admin audit staff page returned too many rows");
  }
  return rows.map((row) => {
    if (
      !validId(row.id, 191)
      || !validId(row.adminId, 191)
      || !isTextWithinCodePointRange(row.action, 1, 100)
      || !isTextWithinCodePointRange(row.targetType, 1, 100)
      || !isTextWithinCodePointRange(row.targetId, 1, 255)
      || (row.reason !== null && !isTextWithinCodePointRange(row.reason, 0, 1000))
      || typeof row.undone !== "boolean"
      || !validDate(row.createdAt)
      || typeof row.actorKind !== "string"
      || !ACTOR_KINDS.has(row.actorKind)
    ) {
      throw new TypeError("Admin audit staff page authority returned an invalid row");
    }
    return Object.freeze({
      id: row.id,
      adminId: row.adminId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      undone: row.undone,
      createdAt: row.createdAt,
      actorKind: row.actorKind,
    }) as AdminAuditLogStaffRow;
  });
}

export async function adminAuditLogStaffUndoSource(
  client: StaffQueryClient,
  input: { actorId: string; logId: string },
): Promise<AdminAuditLogUndoSource | null> {
  if (!validId(input.actorId, 191) || !validId(input.logId, 191)) {
    throw new RangeError("Admin audit undo-source input is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_staff_undo_source(
      ${input.actorId}::text,
      ${input.logId}::text
    )
  `);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || !validId(row.id, 191)
    || !validId(row.adminId, 191)
    || typeof row.action !== "string"
    || !UNDOABLE_ACTIONS.has(row.action)
    || !isTextWithinCodePointRange(row.targetType, 1, 100)
    || !isTextWithinCodePointRange(row.targetId, 1, 255)
    || (row.reason !== null && !isTextWithinCodePointRange(row.reason, 0, 1000))
    || !validJsonValue(row.metadata)
    || typeof row.undone !== "boolean"
    || !validDate(row.createdAt)
    || (
      row.latestUndoSyncAction !== null
      && row.latestUndoSyncAction !== "UNDO_BAN_USER_CLERK_SYNC"
      && row.latestUndoSyncAction !== "UNDO_BAN_USER_CLERK_SYNC_FAILED"
    )
  ) {
    throw new TypeError("Admin audit undo-source authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    adminId: row.adminId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    metadata: row.metadata,
    undone: row.undone,
    createdAt: row.createdAt,
    latestUndoSyncAction: row.latestUndoSyncAction,
  }) as AdminAuditLogUndoSource;
}

export async function adminAuditLogUndoClaim(
  client: QueryClient,
  input: { actorId: string; reason: string; source: AdminAuditLogUndoSource },
) {
  if (
    !validId(input.actorId, 191)
    || !isTextWithinCodePointRange(input.reason, 1, 500)
    || !validId(input.source.id, 191)
    || !validId(input.source.adminId, 191)
    || !UNDOABLE_ACTIONS.has(input.source.action)
    || !isTextWithinCodePointRange(input.source.targetType, 1, 100)
    || !isTextWithinCodePointRange(input.source.targetId, 1, 255)
    || !validDate(input.source.createdAt)
    || !validJsonValue(input.source.metadata)
  ) {
    throw new RangeError("Admin audit undo-claim input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
    SELECT public.grainline_admin_audit_undo_claim(
      ${input.actorId}::text,
      ${input.source.id}::text,
      ${input.reason}::text,
      ${input.source.adminId}::text,
      ${input.source.action}::text,
      ${input.source.targetType}::text,
      ${input.source.targetId}::text,
      ${JSON.stringify(input.source.metadata)}::jsonb
    ) AS id
  `);
  const id = rows[0]?.id;
  if (rows.length !== 1 || !validId(id, 191)) {
    throw new TypeError("Admin audit undo-claim authority returned an invalid result");
  }
  return id;
}

export async function adminAuditLogStaffBanRows(
  client: StaffQueryClient,
  input: { actorId: string; targetId: string; onlyActive: boolean; limit?: number },
) {
  const limit = input.limit ?? 25;
  if (
    !validId(input.actorId, 191)
    || !validId(input.targetId, 191)
    || typeof input.onlyActive !== "boolean"
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 25
  ) {
    throw new RangeError("Admin audit ban-row input is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_staff_ban_rows(
      ${input.actorId}::text,
      ${input.targetId}::text,
      ${input.onlyActive}::boolean,
      ${limit}::integer
    )
  `);
  if (rows.length > limit) {
    throw new TypeError("Admin audit ban-row authority returned too many rows");
  }
  return rows.map((row) => {
    if (
      !validId(row.id, 191)
      || !validRecord(row.metadata)
      || typeof row.undone !== "boolean"
      || !validDate(row.createdAt)
    ) {
      throw new TypeError("Admin audit ban-row authority returned an invalid row");
    }
    return Object.freeze({
      id: row.id,
      metadata: row.metadata,
      undone: row.undone,
      createdAt: row.createdAt,
    });
  });
}

export async function adminAuditLogBanRepairCandidates(
  client: StaffQueryClient,
  input: { limit?: number } = {},
) {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Admin audit ban-repair candidate limit is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_ban_repair_candidates(
      ${limit}::integer
    )
  `);
  if (rows.length > limit) {
    throw new TypeError("Admin audit ban-repair candidate authority returned too many rows");
  }
  return rows.map((row) => {
    if (
      !validId(row.id, 191)
      || !validId(row.targetId, 191)
      || !validRecord(row.metadata)
      || !validDate(row.createdAt)
    ) {
      throw new TypeError("Admin audit ban-repair candidate authority returned an invalid row");
    }
    return Object.freeze({
      id: row.id,
      targetId: row.targetId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    });
  });
}

export async function adminAuditLogBanRepairState(
  client: StaffQueryClient,
  input: { originalActionId: string; targetId: string },
) {
  if (!validId(input.originalActionId, 191) || !validId(input.targetId, 191)) {
    throw new RangeError("Admin audit ban-repair state input is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT * FROM public.grainline_admin_audit_ban_repair_state(
      ${input.originalActionId}::text,
      ${input.targetId}::text
    )
  `);
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || (
      row.latestSyncAction !== null
      && row.latestSyncAction !== "BAN_USER_CLERK_SYNC"
      && row.latestSyncAction !== "BAN_USER_CLERK_SYNC_FAILED"
    )
    || typeof row.checkoutExpired !== "boolean"
  ) {
    throw new TypeError("Admin audit ban-repair state authority returned an invalid result");
  }
  return Object.freeze({
    latestSyncAction: row.latestSyncAction as
      | "BAN_USER_CLERK_SYNC"
      | "BAN_USER_CLERK_SYNC_FAILED"
      | null,
    checkoutExpired: row.checkoutExpired,
  });
}

export async function appendAdminAuditLogBanRepairEvent(
  client: StaffQueryClient,
  input: {
    originalActionId: string;
    action:
      | "BAN_USER_CLERK_SYNC"
      | "BAN_USER_CLERK_SYNC_FAILED"
      | "BAN_USER_CHECKOUT_SESSIONS_EXPIRED";
    targetId: string;
    metadata: Record<string, unknown>;
  },
) {
  if (
    !validId(input.originalActionId, 191)
    || !BAN_REPAIR_ACTIONS.has(input.action)
    || !validId(input.targetId, 191)
    || !validRecord(input.metadata)
  ) {
    throw new RangeError("Admin audit ban-repair append input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ id: unknown }>>(Prisma.sql`
    SELECT public.grainline_admin_audit_ban_repair_append(
      ${input.originalActionId}::text,
      ${input.action}::text,
      ${input.targetId}::text,
      ${JSON.stringify(input.metadata)}::jsonb
    ) AS id
  `);
  const id = rows[0]?.id;
  if (rows.length !== 1 || !validId(id, 191)) {
    throw new TypeError("Admin audit ban-repair append authority returned an invalid result");
  }
  return id;
}
