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

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/u;
const ACTOR_KINDS = new Set(["staff", "user", "automated"]);

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
