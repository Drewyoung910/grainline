import { Prisma, type SupportRequestKind, type SupportRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import type { NormalizedSupportRequest } from "@/lib/supportRequest";

type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const STATUSES = new Set<SupportRequestStatus>(["OPEN", "IN_PROGRESS", "CLOSED"]);
const KINDS = new Set<SupportRequestKind>(["SUPPORT", "DATA_REQUEST"]);

type SubmittedRow = {
  id: unknown;
  slaDueAt: unknown;
  emailDeliveryToken: unknown;
};

export type SupportRequestStaffRow = {
  id: string;
  kind: SupportRequestKind;
  status: SupportRequestStatus;
  name: string | null;
  email: string;
  topic: string;
  orderId: string | null;
  listingId: string | null;
  message: string;
  slaDueAt: Date;
  emailSentAt: Date | null;
  emailLastError: string | null;
  closureEvidence: string | null;
  closureEvidenceAt: Date | null;
  closureEvidenceById: string | null;
  createdAt: Date;
};

export type SupportRequestExportRow = Omit<SupportRequestStaffRow, "closureEvidenceById"> & {
  closedAt: Date | null;
  updatedAt: Date;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function date(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = /(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function staffRow(value: unknown): SupportRequestStaffRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const slaDueAt = date(row.slaDueAt);
  const createdAt = date(row.createdAt);
  const emailSentAt = row.emailSentAt === null ? null : date(row.emailSentAt);
  const closureEvidenceAt = row.closureEvidenceAt === null ? null : date(row.closureEvidenceAt);
  if (
    typeof row.id !== "string"
    || !KINDS.has(row.kind as SupportRequestKind)
    || !STATUSES.has(row.status as SupportRequestStatus)
    || !nullableString(row.name)
    || typeof row.email !== "string"
    || typeof row.topic !== "string"
    || !nullableString(row.orderId)
    || !nullableString(row.listingId)
    || typeof row.message !== "string"
    || !slaDueAt
    || (row.emailSentAt !== null && !emailSentAt)
    || !nullableString(row.emailLastError)
    || !nullableString(row.closureEvidence)
    || (row.closureEvidenceAt !== null && !closureEvidenceAt)
    || !nullableString(row.closureEvidenceById)
    || !createdAt
  ) return null;
  return {
    id: row.id,
    kind: row.kind as SupportRequestKind,
    status: row.status as SupportRequestStatus,
    name: row.name,
    email: row.email,
    topic: row.topic,
    orderId: row.orderId,
    listingId: row.listingId,
    message: row.message,
    slaDueAt,
    emailSentAt,
    emailLastError: row.emailLastError,
    closureEvidence: row.closureEvidence,
    closureEvidenceAt,
    closureEvidenceById: row.closureEvidenceById,
    createdAt,
  };
}

async function submitWithClient(
  client: RawClient,
  request: NormalizedSupportRequest,
) {
  const rows = await client.$queryRaw<SubmittedRow[]>`
    SELECT * FROM public.grainline_support_request_submit(
      ${request.kind}::text,
      ${request.name}::text,
      ${request.email}::text,
      ${request.topic}::text,
      ${request.orderId}::text,
      ${request.listingId}::text,
      ${request.message}::text
    )
  `;
  const row = rows[0];
  const slaDueAt = date(row?.slaDueAt);
  if (
    rows.length !== 1
    || !row
    || typeof row.id !== "string"
    || !slaDueAt
    || typeof row.emailDeliveryToken !== "string"
    || !UUID_PATTERN.test(row.emailDeliveryToken)
  ) {
    throw new Error("Support request submit authority returned an invalid result");
  }
  return {
    id: row.id,
    slaDueAt,
    emailDeliveryToken: row.emailDeliveryToken,
  };
}

export function submitSupportRequest(
  request: NormalizedSupportRequest,
  requesterUserId: string | null,
) {
  return requesterUserId
    ? withDbUserContext(requesterUserId, (client) => submitWithClient(client, request))
    : submitWithClient(prisma, request);
}

export async function recordSupportRequestDelivery(input: {
  requestId: string;
  deliveryToken: string;
  sent: boolean;
  error: string | null;
}) {
  const rows = await prisma.$queryRaw<Array<{ applied: unknown }>>`
    SELECT public.grainline_support_request_delivery_record(
      ${input.requestId}::text,
      ${input.deliveryToken}::uuid,
      ${input.sent}::boolean,
      ${input.error}::text
    ) AS applied
  `;
  if (rows.length !== 1 || typeof rows[0]?.applied !== "boolean") {
    throw new Error("Support request delivery authority returned an invalid result");
  }
  return rows[0].applied;
}

async function ownerExport(client: DbUserContextTransactionClient) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_support_request_owner_export()
  `;
  return rows.map((row) => {
    const base = staffRow({ ...row, closureEvidenceById: null });
    const closedAt = row.closedAt === null ? null : date(row.closedAt);
    const updatedAt = date(row.updatedAt);
    if (!base || (row.closedAt !== null && !closedAt) || !updatedAt) {
      throw new Error("Support request owner export authority returned an invalid result");
    }
    const { closureEvidenceById: _closureEvidenceById, ...withoutActor } = base;
    return { ...withoutActor, closedAt, updatedAt } satisfies SupportRequestExportRow;
  });
}

export function exportOwnerSupportRequests(userId: string) {
  return withDbUserContext(userId, ownerExport);
}

async function staffState(
  client: DbUserContextTransactionClient,
  page: number,
  pageSize: number,
  recentLimit: number,
) {
  const rows = await client.$queryRaw<Array<{ state: unknown }>>`
    SELECT public.grainline_support_request_staff_state(
      ${page}::integer,
      ${pageSize}::integer,
      ${recentLimit}::integer
    ) AS state
  `;
  const state = rows[0]?.state;
  if (rows.length !== 1 || !state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Support request staff-state authority returned an invalid result");
  }
  const value = state as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.activeCount)
    || (value.activeCount as number) < 0
    || !Array.isArray(value.active)
    || !Array.isArray(value.recent)
  ) {
    throw new Error("Support request staff-state authority returned invalid counts");
  }
  const active = value.active.map(staffRow);
  const recent = value.recent.map(staffRow);
  if (active.some((row) => !row) || recent.some((row) => !row)) {
    throw new Error("Support request staff-state authority returned invalid rows");
  }
  return {
    activeCount: value.activeCount as number,
    active: active as SupportRequestStaffRow[],
    recent: recent as SupportRequestStaffRow[],
  };
}

export function readSupportRequestStaffState(
  actorUserId: string,
  page: number,
  pageSize: number,
  recentLimit: number,
) {
  return withDbUserContext(actorUserId, (client) =>
    staffState(client, page, pageSize, recentLimit));
}

export async function transitionSupportRequest(input: {
  actorUserId: string;
  requestId: string;
  status: SupportRequestStatus;
  closureEvidence: string | null;
}) {
  return withDbUserContext(input.actorUserId, async (client) => {
    const rows = await client.$queryRaw<Array<{ result: unknown }>>`
      SELECT public.grainline_support_request_staff_transition(
        ${input.requestId}::text,
        ${input.status}::text,
        ${input.closureEvidence}::text
      ) AS result
    `;
    const result = rows[0]?.result;
    if (
      rows.length !== 1
      || typeof result !== "string"
      || !["updated", "missing", "closed_terminal", "missing_closure_evidence"].includes(result)
    ) {
      throw new Error("Support request transition authority returned an invalid result");
    }
    return result as "updated" | "missing" | "closed_terminal" | "missing_closure_evidence";
  });
}

export async function redactSupportRequestsForAccountDeletion(
  client: DbUserContextTransactionClient,
  sensitiveValues: string[],
  auditSensitiveValues: string[],
) {
  let requestCount = 0;
  let closureCount = 0;
  do {
    const rows = await client.$queryRaw<Array<{ requestCount: unknown; closureCount: unknown }>>`
      SELECT * FROM public.grainline_support_request_account_deletion_redact_batch(
        ${sensitiveValues}::text[],
        ${auditSensitiveValues}::text[]
      )
    `;
    const row = rows[0];
    const safeRequestCount = typeof row?.requestCount === "bigint" ? Number(row.requestCount) : row?.requestCount;
    const safeClosureCount = typeof row?.closureCount === "bigint" ? Number(row.closureCount) : row?.closureCount;
    if (
      rows.length !== 1
      || !Number.isSafeInteger(safeRequestCount)
      || !Number.isSafeInteger(safeClosureCount)
      || (safeRequestCount as number) < 0
      || (safeClosureCount as number) < 0
      || (safeRequestCount as number) > 500
      || (safeClosureCount as number) > 500
    ) {
      throw new Error("Support request account-deletion authority returned an invalid result");
    }
    requestCount = safeRequestCount as number;
    closureCount = safeClosureCount as number;
  } while (requestCount === 500 || closureCount === 500);
}

export async function upsertProviderDeletionSupportRequest(
  client: DbUserContextTransactionClient,
  message: string,
) {
  const rows = await client.$queryRaw<Array<{ id: unknown }>>`
    SELECT public.grainline_support_request_provider_deletion_upsert(
      ${message}::text
    ) AS id
  `;
  if (rows.length !== 1 || typeof rows[0]?.id !== "string") {
    throw new Error("Support request provider-deletion authority returned an invalid result");
  }
  return rows[0].id;
}

export async function overdueSupportRequestCount() {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_support_request_overdue_count() AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Support request overdue-count authority returned an invalid result");
  }
  return value as number;
}

export async function deleteSupportRequestRetentionBatch(limit: number) {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_support_request_retention_delete_batch(${limit}::integer) AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (
    rows.length !== 1
    || !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > limit
  ) {
    throw new Error("Support request retention authority returned an invalid result");
  }
  return value as number;
}
