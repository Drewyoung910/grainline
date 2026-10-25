import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type EmailOutboxAuthorityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const OUTCOMES = new Set(["applied", "stale_claim", "already_terminal", "missing"] as const);
const BEGIN_OUTCOMES = new Set(["ready", "expired", "stale_claim", "already_terminal", "missing"] as const);

export type EmailOutboxLane = "TRANSACTIONAL" | "OPTIONAL";

export type ClaimedEmailOutboxJob = {
  jobId: string;
  claimGeneration: bigint;
  claimToken: string;
  recipientEmail: string;
  recipientUserId: string | null;
  preferenceKey: string | null;
  templateName: string;
  templateVersion: number;
  payloadVersion: number | null;
  payload: unknown | null;
  dedupKey: string;
  createdAt: Date;
  legacySubject: string | null;
  legacyHtml: string | null;
  lane: EmailOutboxLane;
};

type RawClaim = Record<string, unknown>;

function date(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function bigint(value: unknown) {
  if (typeof value === "bigint" && value >= 1n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) return BigInt(value);
  return null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseClaim(row: RawClaim): ClaimedEmailOutboxJob {
  const claimGeneration = bigint(row.claimGeneration);
  const createdAt = date(row.createdAt);
  const lane = row.lane;
  const legacyRepresentation = typeof row.legacySubject === "string"
    && typeof row.legacyHtml === "string"
    && row.payloadVersion === null
    && row.payload === null;
  const structuredRepresentation = row.legacySubject === null
    && row.legacyHtml === null
    && Number.isInteger(row.payloadVersion)
    && (row.payloadVersion as number) > 0
    && row.payload !== null
    && typeof row.payload === "object";
  if (
    typeof row.jobId !== "string"
    || !claimGeneration
    || typeof row.claimToken !== "string"
    || !UUID_PATTERN.test(row.claimToken)
    || typeof row.recipientEmail !== "string"
    || !nullableString(row.recipientUserId)
    || !nullableString(row.preferenceKey)
    || typeof row.templateName !== "string"
    || !Number.isInteger(row.templateVersion)
    || (row.templateVersion as number) < 1
    || typeof row.dedupKey !== "string"
    || !createdAt
    || (lane !== "TRANSACTIONAL" && lane !== "OPTIONAL")
    || (!legacyRepresentation && !structuredRepresentation)
  ) {
    throw new Error("Email outbox claim authority returned an invalid row");
  }
  return {
    jobId: row.jobId,
    claimGeneration,
    claimToken: row.claimToken,
    recipientEmail: row.recipientEmail,
    recipientUserId: row.recipientUserId,
    preferenceKey: row.preferenceKey,
    templateName: row.templateName,
    templateVersion: row.templateVersion as number,
    payloadVersion: row.payloadVersion as number | null,
    payload: row.payload,
    dedupKey: row.dedupKey,
    createdAt,
    legacySubject: row.legacySubject as string | null,
    legacyHtml: row.legacyHtml as string | null,
    lane,
  };
}

async function claimRows(client: EmailOutboxAuthorityClient, query: Promise<RawClaim[]>) {
  const rows = await query;
  return rows.map(parseClaim);
}

export function claimEmailOutboxBatch(
  limit: number,
  client: EmailOutboxAuthorityClient = prisma,
) {
  return claimRows(client, client.$queryRaw<RawClaim[]>`
    SELECT * FROM public.grainline_email_outbox_claim_batch(${limit}::integer)
  `);
}

export async function claimEmailOutboxJob(
  jobId: string,
  client: EmailOutboxAuthorityClient = prisma,
) {
  const rows = await claimRows(client, client.$queryRaw<RawClaim[]>`
    SELECT * FROM public.grainline_email_outbox_claim_one(${jobId}::text)
  `);
  if (rows.length > 1) {
    throw new Error("Email outbox single-claim authority returned multiple rows");
  }
  return rows[0] ?? null;
}

type EmailOutboxOutcome = "applied" | "stale_claim" | "already_terminal" | "missing";
type ProviderAttemptOutcome = EmailOutboxOutcome | "ready" | "expired";

function exactOutcome(value: unknown, allowed: ReadonlySet<string>, operation: string) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${operation} returned an invalid result`);
  }
  return value;
}

async function scalarOutcome(
  rows: Array<{ result: unknown }>,
  allowed: ReadonlySet<string>,
  operation: string,
) {
  if (rows.length !== 1) throw new Error(`${operation} returned an invalid result`);
  return exactOutcome(rows[0]?.result, allowed, operation);
}

export async function deferEmailOutboxClaim(
  claim: ClaimedEmailOutboxJob,
  reason:
    | "recipient_optional_quota"
    | "optional_global_quota"
    | "transactional_global_quota"
    | "provider_unavailable",
  client: EmailOutboxAuthorityClient = prisma,
) {
  return scalarOutcome(await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_defer(
      ${claim.jobId}::text,
      ${claim.claimGeneration}::bigint,
      ${claim.claimToken}::uuid,
      ${reason}::text
    ) AS result
  `, OUTCOMES, "Email outbox defer authority") as Promise<EmailOutboxOutcome>;
}

export async function beginEmailOutboxProviderAttempt(
  claim: ClaimedEmailOutboxJob,
  client: EmailOutboxAuthorityClient = prisma,
) {
  return scalarOutcome(await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_begin_provider_attempt(
      ${claim.jobId}::text,
      ${claim.claimGeneration}::bigint,
      ${claim.claimToken}::uuid
    ) AS result
  `, BEGIN_OUTCOMES, "Email outbox provider-attempt authority") as Promise<ProviderAttemptOutcome>;
}

export async function completeEmailOutboxClaim(
  claim: ClaimedEmailOutboxJob,
  providerMessageId: string,
  client: EmailOutboxAuthorityClient = prisma,
) {
  return scalarOutcome(await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_complete(
      ${claim.jobId}::text,
      ${claim.claimGeneration}::bigint,
      ${claim.claimToken}::uuid,
      ${providerMessageId}::text
    ) AS result
  `, OUTCOMES, "Email outbox complete authority") as Promise<EmailOutboxOutcome>;
}

export async function failEmailOutboxClaim(
  claim: ClaimedEmailOutboxJob,
  errorClass:
    | "provider_retryable"
    | "provider_rejected"
    | "invalid_payload"
    | "configuration"
    | "unexpected_internal",
  summary: string,
  client: EmailOutboxAuthorityClient = prisma,
) {
  return scalarOutcome(await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_fail(
      ${claim.jobId}::text,
      ${claim.claimGeneration}::bigint,
      ${claim.claimToken}::uuid,
      ${errorClass}::text,
      ${summary}::text
    ) AS result
  `, OUTCOMES, "Email outbox failure authority") as Promise<EmailOutboxOutcome>;
}

export async function skipEmailOutboxClaim(
  claim: ClaimedEmailOutboxJob,
  reason:
    | "inactive_account"
    | "banned_account"
    | "deleted_account"
    | "email_changed"
    | "optional_preference_disabled"
    | "hard_suppression"
    | "invalid_legacy_shape"
    | "account_deletion",
  client: EmailOutboxAuthorityClient = prisma,
) {
  return scalarOutcome(await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_skip(
      ${claim.jobId}::text,
      ${claim.claimGeneration}::bigint,
      ${claim.claimToken}::uuid,
      ${reason}::text
    ) AS result
  `, OUTCOMES, "Email outbox skip authority") as Promise<EmailOutboxOutcome>;
}
