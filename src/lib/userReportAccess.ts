import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type UserReportClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export const USER_REPORT_TARGET_TYPES = [
  "LISTING",
  "MESSAGE_THREAD",
  "REVIEW",
  "BLOG_COMMENT",
  "SELLER_PROFILE",
] as const;

export type UserReportTargetType = (typeof USER_REPORT_TARGET_TYPES)[number];
export type UserReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "FAKE_LISTING"
  | "INAPPROPRIATE"
  | "OTHER";

type UserReportSubmittedExportRow = Readonly<{
  id: string;
  reportedId: string;
  reason: string;
  details: string | null;
  targetType: string | null;
  targetId: string | null;
  resolved: boolean;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}>;

type UserReportReceivedExportRow = Omit<
  UserReportSubmittedExportRow,
  "reportedId" | "details"
>;

export type UserReportStaffRow = Readonly<{
  id: string;
  reason: string;
  details: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: Date;
  reporterId: string;
  reportedId: string;
}>;

export type UserReportStaffCursor = Readonly<{
  createdAt: Date;
  id: string;
}>;

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;
const REASONS = new Set<UserReportReason>([
  "SPAM",
  "HARASSMENT",
  "FAKE_LISTING",
  "INAPPROPRIATE",
  "OTHER",
]);
const TARGET_TYPES = new Set<UserReportTargetType>(USER_REPORT_TARGET_TYPES);

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function nullableBoundedText(value: unknown, maximum: number): value is string | null {
  return value === null
    || (typeof value === "string" && isTextWithinCodePointRange(value, 0, maximum));
}

function nullableDate(value: unknown): value is Date | null {
  return value === null || (value instanceof Date && Number.isFinite(value.getTime()));
}

function validExportBase(row: UserReportReceivedExportRow | undefined) {
  return Boolean(
    row
    && validId(row.id)
    && typeof row.reason === "string"
    && nullableBoundedText(row.targetType, 100)
    && nullableBoundedText(row.targetId, 255)
    && typeof row.resolved === "boolean"
    && nullableDate(row.resolvedAt)
    && nullableBoundedText(row.resolutionNote, 500)
    && row.createdAt instanceof Date
    && Number.isFinite(row.createdAt.getTime()),
  );
}

async function readSubmittedExport(client: UserReportClient) {
  const rows = await client.$queryRaw<UserReportSubmittedExportRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_user_report_owner_submitted_export()
  `);
  if (rows.some((row) => (
    !validExportBase(row)
    || !validId(row.reportedId)
    || !nullableBoundedText(row.details, 500)
  ))) {
    throw new Error("Submitted UserReport export returned invalid data");
  }
  return rows;
}

async function readReceivedExport(client: UserReportClient) {
  const rows = await client.$queryRaw<UserReportReceivedExportRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_user_report_owner_received_export()
  `);
  if (rows.some((row) => !validExportBase(row))) {
    throw new Error("Received UserReport export returned invalid data");
  }
  return rows;
}

export async function createUserReport(input: {
  actorUserId: string;
  reportedUserId: string;
  reason: UserReportReason;
  details: string | null;
  targetType: UserReportTargetType | null;
  targetId: string | null;
}) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  if (
    !validId(input.reportedUserId)
    || input.reportedUserId === actorUserId
    || !REASONS.has(input.reason)
    || !nullableBoundedText(input.details, 500)
    || (input.targetType === null) !== (input.targetId === null)
    || (input.targetType !== null && !TARGET_TYPES.has(input.targetType))
    || (input.targetId !== null && !validId(input.targetId))
  ) {
    throw new RangeError("UserReport submission input is invalid");
  }
  const reportId = randomUUID();
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      reportId: string;
      reportedId: string;
      targetType: string | null;
      targetId: string | null;
    }>>(Prisma.sql`
      SELECT * FROM public.grainline_user_report_submit(
        ${reportId}::text,
        ${input.reportedUserId}::text,
        ${input.reason}::text,
        ${input.details}::text,
        ${input.targetType}::text,
        ${input.targetId}::text
      )
    `);
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || row.reportId !== reportId
      || row.reportedId !== input.reportedUserId
      || row.targetType !== input.targetType
      || row.targetId !== input.targetId
    ) {
      throw new Error("UserReport submit authority returned an invalid result");
    }
    return Object.freeze(row);
  });
}

export function exportSubmittedUserReports(actorUserId: string) {
  return withDbUserContext(actorUserId, readSubmittedExport);
}

export function exportReceivedUserReports(actorUserId: string) {
  return withDbUserContext(actorUserId, readReceivedExport);
}

function requireStaffActor(actorUserId: string) {
  return normalizeDbUserContextUserId(actorUserId);
}

export async function userReportStaffOpenCount(
  client: UserReportClient,
  actorUserId: string,
) {
  const actorId = requireStaffActor(actorUserId);
  const rows = await client.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`
    SELECT public.grainline_user_report_staff_open_count(${actorId}::text) AS value
  `);
  const value = rows[0]?.value;
  if (
    rows.length !== 1
    || typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("UserReport staff count authority returned an invalid result");
  }
  return Number(value);
}

export async function userReportStaffOpenPage(
  client: UserReportClient,
  input: {
    actorUserId: string;
    cursor: UserReportStaffCursor | null;
    limit?: number;
  },
) {
  const actorId = requireStaffActor(input.actorUserId);
  const limit = input.limit ?? 50;
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 50
    || (
      input.cursor !== null
      && (
        !(input.cursor.createdAt instanceof Date)
        || !Number.isFinite(input.cursor.createdAt.getTime())
        || !validId(input.cursor.id)
      )
    )
  ) {
    throw new RangeError("UserReport staff page input is invalid");
  }
  const rows = await client.$queryRaw<UserReportStaffRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_user_report_staff_open_page(
      ${actorId}::text,
      ${input.cursor?.createdAt ?? null}::timestamp,
      ${input.cursor?.id ?? null}::text,
      ${limit}::integer
    )
  `);
  const ids = new Set<string>();
  if (rows.length > limit || rows.some((row) => {
    const valid = validId(row.id)
      && !ids.has(row.id)
      && typeof row.reason === "string"
      && nullableBoundedText(row.details, 500)
      && nullableBoundedText(row.targetType, 100)
      && nullableBoundedText(row.targetId, 255)
      && row.createdAt instanceof Date
      && Number.isFinite(row.createdAt.getTime())
      && validId(row.reporterId)
      && validId(row.reportedId);
    ids.add(row.id);
    return !valid;
  })) {
    throw new Error("UserReport staff page authority returned invalid data");
  }
  return rows;
}

export async function userReportStaffTopReporters(
  client: UserReportClient,
  input: { actorUserId: string; since: Date; limit?: number },
) {
  const actorId = requireStaffActor(input.actorUserId);
  const limit = input.limit ?? 5;
  if (
    !(input.since instanceof Date)
    || !Number.isFinite(input.since.getTime())
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 20
  ) {
    throw new RangeError("UserReport staff aggregate input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ reporterId: string; value: bigint }>>(Prisma.sql`
    SELECT * FROM public.grainline_user_report_staff_top_reporters(
      ${actorId}::text,
      ${input.since}::timestamp,
      ${limit}::integer
    )
  `);
  if (rows.length > limit || rows.some((row) => (
    !validId(row.reporterId)
    || typeof row.value !== "bigint"
    || row.value < 1n
    || row.value > BigInt(Number.MAX_SAFE_INTEGER)
  ))) {
    throw new Error("UserReport staff aggregate authority returned invalid data");
  }
  return rows.map((row) => ({ reporterId: row.reporterId, count: Number(row.value) }));
}

export async function resolveUserReport(
  client: UserReportClient,
  input: {
    actorUserId: string;
    reportId: string;
    participantRationale: string;
    internalNote: string | null;
  },
) {
  const actorId = requireStaffActor(input.actorUserId);
  if (
    !validId(input.reportId)
    || !isTextWithinCodePointRange(input.participantRationale, 1, 500)
    || !nullableBoundedText(input.internalNote, 1000)
  ) {
    throw new RangeError("UserReport resolution input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT public.grainline_user_report_staff_resolve(
      ${actorId}::text,
      ${input.reportId}::text,
      ${input.participantRationale}::text,
      ${input.internalNote}::text
    ) AS value
  `);
  const value = rows[0]?.value;
  if (rows.length !== 1 || (value !== "UPDATED" && value !== "UNCHANGED")) {
    throw new Error("UserReport resolution authority returned an invalid result");
  }
  return value;
}

export async function redactUserReportsForAccountDeletion(
  client: UserReportClient,
  input: {
    expectedUserId: string;
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const expectedUserId = normalizeDbUserContextUserId(input.expectedUserId);
  if (!validId(input.sideEffectId)) {
    throw new RangeError("UserReport account-deletion input is invalid");
  }
  const rows = await client.$queryRaw<Array<{
    userId: string;
    detailsRedacted: number;
    resolvedNotesRedacted: number;
    reportsAutoResolved: number;
  }>>(Prisma.sql`
    SELECT * FROM public.grainline_user_report_account_deletion_redact(
      ${input.sideEffectId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    )
  `);
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || row.userId !== expectedUserId
    || ![row.detailsRedacted, row.resolvedNotesRedacted, row.reportsAutoResolved]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new Error("UserReport account-deletion authority returned an invalid result");
  }
  return Object.freeze(row);
}
