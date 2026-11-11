import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

type EmailServiceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type EmailServiceOwnerExportData = {
  emailSuppressions: unknown[];
  emailOutboxRows: unknown[];
  emailFailureCounts: unknown[];
  newsletterSubscriptions: unknown[];
};

export type EmailServiceAccountDeletionResult = {
  skippedOutboxCount: number;
  redactedOutboxCount: number;
  deletedFailureCount: number;
  deletedNewsletterCount: number;
  updatedSuppressionCount: number;
  createdSuppressionCount: number;
};

export type EmailSuppressionMode = "any" | "newsletter" | "delivery";
export type ResendWebhookLease = {
  action: "process";
  claimGeneration: number;
  claimToken: string;
};

export type ResendWebhookReservation =
  | ResendWebhookLease
  | { action: "processed" }
  | { action: "in_progress" };

export type EmailServiceOpsHealth = {
  staleEmailCount: number;
  deadEmailCount: number;
  stalledResendCount: number;
};

function scalarBoolean(
  rows: Array<{ result: unknown }>,
  operation: string,
): boolean {
  if (rows.length !== 1 || typeof rows[0]?.result !== "boolean") {
    throw new Error(`${operation} returned an invalid result`);
  }
  return rows[0].result;
}

function scalarCount(
  rows: Array<{ result: unknown }>,
  operation: string,
): number {
  const result = rows[0]?.result;
  if (
    rows.length !== 1
    || typeof result !== "number"
    || !Number.isSafeInteger(result)
    || result < 0
  ) {
    throw new Error(`${operation} returned an invalid result`);
  }
  return result;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function scalarJsonRecord(
  rows: Array<{ result: unknown }>,
  operation: string,
): Record<string, unknown> {
  const result = rows.length === 1 ? record(rows[0]?.result) : null;
  if (!result) throw new Error(`${operation} returned an invalid result`);
  return result;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

export async function emailSuppressionExistsAuthority(
  client: EmailServiceClient,
  input: { email: string; mode: EmailSuppressionMode },
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_suppression_exists(
      ${input.email}::text,
      ${input.mode}::text
    ) AS result
  `;
  return scalarBoolean(rows, "Email suppression lookup authority");
}

export async function clearOneClickEmailSuppressionAuthority(
  client: EmailServiceClient,
  email: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_one_click_suppression_clear(
      ${email}::text
    )::integer AS result
  `;
  return scalarCount(rows, "Email suppression clear authority");
}

export async function reserveNewsletterSignup(
  client: EmailServiceClient,
  input: {
    email: string;
    name: string | null;
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
    resendCutoff: Date;
  },
): Promise<"reserved" | "hidden"> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_signup_reserve(
      ${input.email}::text,
      ${input.name}::text,
      ${input.tokenHash}::text,
      ${input.expiresAt}::timestamp,
      ${input.sentAt}::timestamp,
      ${input.resendCutoff}::timestamp
    ) AS result
  `;
  const result = rows[0]?.result;
  if (
    rows.length !== 1
    || (result !== "reserved" && result !== "hidden")
  ) {
    throw new Error("Newsletter signup reservation authority returned an invalid result");
  }
  return result;
}

export async function releaseNewsletterSignup(
  client: EmailServiceClient,
  input: { email: string; tokenHash: string },
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_signup_release(
      ${input.email}::text,
      ${input.tokenHash}::text
    )::integer AS result
  `;
  return scalarCount(rows, "Newsletter signup release authority");
}

export async function newsletterConfirmationValid(
  client: EmailServiceClient,
  input: { tokenHash: string; now: Date },
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_confirmation_valid(
      ${input.tokenHash}::text,
      ${input.now}::timestamp
    ) AS result
  `;
  return scalarBoolean(rows, "Newsletter confirmation preview authority");
}

export async function confirmNewsletterSubscription(
  client: EmailServiceClient,
  input: { tokenHash: string; now: Date },
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_confirm(
      ${input.tokenHash}::text,
      ${input.now}::timestamp
    ) AS result
  `;
  return scalarBoolean(rows, "Newsletter confirmation authority");
}

export async function newsletterTokenSuperseded(
  client: EmailServiceClient,
  input: { email: string; issuedAt: Date },
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_token_superseded(
      ${input.email}::text,
      ${input.issuedAt}::timestamp
    ) AS result
  `;
  return scalarBoolean(rows, "Newsletter token supersession authority");
}

export async function applyEmailUnsubscribe(
  client: EmailServiceClient,
  input: { email: string; disabledPreferences: readonly string[] },
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_unsubscribe_apply(
      ${input.email}::text,
      ${JSON.stringify(input.disabledPreferences)}::jsonb
    )::integer AS result
  `;
  return scalarCount(rows, "Email unsubscribe authority");
}

export async function clearAccountDeletionEmailSuppressions(
  client: EmailServiceClient,
  userId: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_account_deletion_suppression_clear(
      ${userId}::text
    )::integer AS result
  `;
  return scalarCount(rows, "Account-deletion suppression clear authority");
}

export async function exportOwnerEmailServiceData(
  client: EmailServiceClient,
): Promise<EmailServiceOwnerExportData> {
  const result = scalarJsonRecord(
    await client.$queryRaw<Array<{ result: unknown }>>`
      SELECT public.grainline_email_service_owner_export() AS result
    `,
    "Email service owner export authority",
  );
  const {
    emailSuppressions,
    emailOutboxRows,
    emailFailureCounts,
    newsletterSubscriptions,
  } = result;
  if (
    !Array.isArray(emailSuppressions)
    || !Array.isArray(emailOutboxRows)
    || !Array.isArray(emailFailureCounts)
    || !Array.isArray(newsletterSubscriptions)
  ) {
    throw new Error("Email service owner export authority returned invalid collections");
  }
  return {
    emailSuppressions,
    emailOutboxRows,
    emailFailureCounts,
    newsletterSubscriptions,
  };
}

export async function applyEmailServiceAccountDeletion(
  client: EmailServiceClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
): Promise<EmailServiceAccountDeletionResult> {
  const result = scalarJsonRecord(
    await client.$queryRaw<Array<{ result: unknown }>>`
      SELECT public.grainline_email_service_account_deletion_apply(
        ${input.sideEffectId}::text,
        ${input.claimGeneration}::bigint,
        ${input.claimToken}::uuid
      ) AS result
    `,
    "Email service account-deletion authority",
  );
  const keys = [
    "skippedOutboxCount",
    "redactedOutboxCount",
    "deletedFailureCount",
    "deletedNewsletterCount",
    "updatedSuppressionCount",
    "createdSuppressionCount",
  ] as const satisfies readonly (keyof EmailServiceAccountDeletionResult)[];
  for (const key of keys) {
    if (!nonnegativeInteger(result[key])) {
      throw new Error("Email service account-deletion authority returned invalid counts");
    }
  }
  return Object.fromEntries(
    keys.map((key) => [key, result[key]]),
  ) as EmailServiceAccountDeletionResult;
}

export async function reserveResendWebhookEvent(
  client: EmailServiceClient,
  input: {
    svixId: string;
    type: string;
    now: Date;
    retryBefore: Date;
  },
): Promise<ResendWebhookReservation> {
  const claimToken = randomUUID();
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_resend_webhook_event_reserve(
      ${input.svixId}::text,
      ${input.type}::text,
      ${input.now}::timestamp,
      ${input.retryBefore}::timestamp,
      ${claimToken}::uuid
    ) AS result
  `;
  const result = rows.length === 1 ? record(rows[0]?.result) : null;
  const action = result?.action;
  if (action === "processed" || action === "in_progress") {
    return { action };
  }
  if (
    !result
    ||
    action !== "process"
    || !nonnegativeInteger(result.claimGeneration)
    || result.claimGeneration < 1
    || typeof result.claimToken !== "string"
    || result.claimToken !== claimToken
  ) {
    throw new Error("Resend webhook reservation authority returned an invalid result");
  }
  return {
    action,
    claimGeneration: result.claimGeneration,
    claimToken: result.claimToken,
  };
}

export async function completeResendWebhookEvent(
  client: EmailServiceClient,
  input: ResendWebhookLease & { svixId: string; now: Date },
): Promise<void> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_resend_webhook_event_complete(
      ${input.svixId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid,
      ${input.now}::timestamp
    ) AS result
  `;
  if (!scalarBoolean(rows, "Resend webhook completion authority")) {
    throw new Error("Resend webhook completion authority refused the event");
  }
}

export async function failResendWebhookEvent(
  client: EmailServiceClient,
  input: ResendWebhookLease & { svixId: string; error: string; now: Date },
): Promise<void> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_resend_webhook_event_fail(
      ${input.svixId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid,
      ${input.error}::text,
      ${input.now}::timestamp
    ) AS result
  `;
  if (!scalarBoolean(rows, "Resend webhook failure authority")) {
    throw new Error("Resend webhook failure authority refused the event");
  }
}

export async function deleteEmailOutboxRetentionBatch(
  client: EmailServiceClient,
  input: { sentOrSkippedCutoff: Date; deadCutoff: Date; limit: number },
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_retention_delete_batch(
      ${input.sentOrSkippedCutoff}::timestamp,
      ${input.deadCutoff}::timestamp,
      ${input.limit}::integer
    )::integer AS result
  `;
  return scalarCount(rows, "Email outbox retention authority");
}

export async function deleteExpiredUnconfirmedNewsletterBatch(
  client: EmailServiceClient,
  input: { cutoff: Date; limit: number },
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_newsletter_expired_unconfirmed_delete_batch(
      ${input.cutoff}::timestamp,
      ${input.limit}::integer
    )::integer AS result
  `;
  return scalarCount(rows, "Newsletter retention authority");
}

export async function deleteResendWebhookEventRetentionBatch(
  client: EmailServiceClient,
  input: { cutoff: Date; limit: number },
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_resend_webhook_event_retention_delete_batch(
      ${input.cutoff}::timestamp,
      ${input.limit}::integer
    )::integer AS result
  `;
  return scalarCount(rows, "Resend webhook retention authority");
}

export async function emailServiceOpsHealth(
  client: EmailServiceClient,
  input: { staleEmailBefore: Date; staleSvixBefore: Date },
): Promise<EmailServiceOpsHealth> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
      FROM public.grainline_email_service_ops_health(
        ${input.staleEmailBefore}::timestamp,
        ${input.staleSvixBefore}::timestamp
      )
  `;
  const row = rows.length === 1 ? rows[0] : null;
  if (
    !row
    || !nonnegativeInteger(row.staleEmailCount)
    || !nonnegativeInteger(row.deadEmailCount)
    || !nonnegativeInteger(row.stalledResendCount)
  ) {
    throw new Error("Email service health authority returned invalid counts");
  }
  return {
    staleEmailCount: row.staleEmailCount,
    deadEmailCount: row.deadEmailCount,
    stalledResendCount: row.stalledResendCount,
  };
}

export async function cancelSellerBroadcastEmails(
  client: EmailServiceClient,
  broadcastId: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_cancel_seller_broadcast(
      ${broadcastId}::text
    )::integer AS result
  `;
  return scalarCount(rows, "Seller broadcast email cancellation authority");
}

export async function redactDeletedSellerEmailOutbox(
  client: EmailServiceClient,
  sellerProfileId: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_email_outbox_redact_deleted_seller(
      ${sellerProfileId}::text
    )::integer AS result
  `;
  return scalarCount(rows, "Deleted-seller email redaction authority");
}
