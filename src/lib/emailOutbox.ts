import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { isEmailProviderConfigured, sendRenderedEmail } from "@/lib/email";
import { redis } from "@/lib/ratelimit";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { classifyEmailOutboxFailure } from "@/lib/emailOutboxFailure";
import { truncateText } from "@/lib/sanitize";
import { emailOutboxDedupKey } from "@/lib/emailOutboxState";
import {
  EMAIL_OUTBOX_GLOBAL_ALLOWANCE_SCRIPT,
  EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT,
  EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT,
  reserveEmailOutboxGlobalSendAllowance,
  reserveEmailOutboxRecipientDailySendAllowance,
  rollbackEmailOutboxDailySendAllowance,
  rollbackEmailOutboxRecipientDailySendAllowance,
} from "@/lib/emailOutboxQuota";
import { isValidEmailPreferenceKey } from "@/lib/notificationPreferenceKeys";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  beginEmailOutboxProviderAttempt,
  claimEmailOutboxBatch,
  claimEmailOutboxJob,
  completeEmailOutboxClaim,
  deferEmailOutboxClaim,
  enqueueLegacyEmailOutbox,
  failEmailOutboxClaim,
  type ClaimedEmailOutboxJob,
} from "@/lib/emailOutboxAccess";
import { processClaimedEmailOutboxJob } from "@/lib/emailOutboxWorker";
import { renderStructuredEmailOutboxClaim } from "@/lib/emailOutboxStructuredRenderer";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;
export const EMAIL_OUTBOX_HTML_MAX_CHARS = 200_000;
export const EMAIL_OUTBOX_TEMPLATE_VERSION = 1;
export const EMAIL_OUTBOX_TEMPLATE_NAMES = [
  "back_in_stock",
  "case_message",
  "case_opened",
  "case_resolved",
  "first_listing_congrats",
  "first_sale_congrats",
  "followed_maker_new_listing",
  "order_confirmed_buyer",
  "order_confirmed_seller",
  "order_shipped",
  "ready_for_pickup",
  "refund_issued",
  "seller_broadcast",
  "welcome",
] as const;
export const EMAIL_OUTBOX_SOURCE_TYPES = [
  "seller_broadcast",
  "followed_maker_new_listing",
  "order_payment",
  "order_fulfillment",
  "case",
] as const;
const globalDailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_GLOBAL_ALLOWANCE_SCRIPT);
const globalDailySendAllowanceRollbackScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT);
const recipientDailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);
const recipientDailySendAllowanceRollbackScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT);

export type EmailOutboxTemplateName = typeof EMAIL_OUTBOX_TEMPLATE_NAMES[number];
export type EmailOutboxSourceType = typeof EMAIL_OUTBOX_SOURCE_TYPES[number];

export type QueuedEmail = {
  to: string;
  subject: string;
  html: string;
  dedupKey: string;
  templateName: EmailOutboxTemplateName;
  templateVersion?: number;
  userId?: string;
  preferenceKey?: string;
  sourceType?: EmailOutboxSourceType;
  sourceId?: string;
};

export type EnqueueEmailOutboxResult = {
  job: { id: string } | null;
  created: boolean;
};

type EmailOutboxClient = Parameters<typeof enqueueLegacyEmailOutbox>[1];

function normalizeTemplateVersion(version: number | undefined) {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return EMAIL_OUTBOX_TEMPLATE_VERSION;
  }
  return version;
}

async function reserveDailySendAllowance(
  lane: ClaimedEmailOutboxJob["lane"],
  requested: number,
  now: Date,
) {
  return reserveEmailOutboxGlobalSendAllowance({
    lane,
    requested,
    now,
    counter: ({ key, requested: requestedCount, limit, reserve, lane: quotaLane, ttlSeconds }) =>
      globalDailySendAllowanceScript.eval(
        [key],
        [
          String(requestedCount),
          String(limit),
          String(reserve),
          quotaLane,
          String(ttlSeconds),
        ],
      ),
    onCounterError: (error) =>
      Sentry.captureException(error, { tags: { source: "email_outbox_daily_quota" } }),
  });
}

async function rollbackDailySendAllowance(requested: number, now: Date) {
  return rollbackEmailOutboxDailySendAllowance({
    requested,
    now,
    counter: ({ key, requested: requestedCount }) =>
      globalDailySendAllowanceRollbackScript.eval(
        [key],
        [String(requestedCount)],
      ),
    onCounterError: (error) =>
      Sentry.captureException(error, { tags: { source: "email_outbox_daily_quota_rollback" } }),
  });
}

async function reserveRecipientDailySendAllowance(recipientEmail: string, requested: number, now: Date) {
  return reserveEmailOutboxRecipientDailySendAllowance({
    recipientHash: hashEmailForTelemetry(recipientEmail) ?? "unknown",
    requested,
    now,
    counter: ({ key, requested: requestedCount, limit, ttlSeconds }) =>
      recipientDailySendAllowanceScript.eval(
        [key],
        [String(requestedCount), String(limit), String(ttlSeconds)],
      ),
    onCounterError: (error) =>
      Sentry.captureException(error, { tags: { source: "email_outbox_recipient_quota" } }),
  });
}

async function rollbackRecipientDailySendAllowance(recipientEmail: string, requested: number, now: Date) {
  return rollbackEmailOutboxRecipientDailySendAllowance({
    recipientHash: hashEmailForTelemetry(recipientEmail) ?? "unknown",
    requested,
    now,
    counter: ({ key, requested: requestedCount }) =>
      recipientDailySendAllowanceRollbackScript.eval(
        [key],
        [String(requestedCount)],
      ),
    onCounterError: (error) =>
      Sentry.captureException(error, { tags: { source: "email_outbox_recipient_quota_rollback" } }),
  });
}

export async function enqueueEmailOutboxOnce(
  email: QueuedEmail,
  client: EmailOutboxClient = prisma,
): Promise<EnqueueEmailOutboxResult> {
  const recipient = normalizeEmailAddress(email.to);
  if (!recipient) return { job: null, created: false };
  if (email.preferenceKey && !isValidEmailPreferenceKey(email.preferenceKey)) {
    Sentry.captureMessage("Skipping email outbox enqueue with invalid preference key", {
      level: "warning",
      tags: { source: "email_outbox", reason: "invalid_preference_key" },
      extra: { preferenceKey: email.preferenceKey, userId: email.userId },
    });
    return { job: null, created: false };
  }
  const dedupKey = emailOutboxDedupKey(email.dedupKey);

  const result = await enqueueLegacyEmailOutbox({
    id: randomUUID(),
    recipientEmail: recipient,
    userId: email.userId ?? null,
    preferenceKey: email.preferenceKey ?? null,
    templateName: email.templateName,
    templateVersion: normalizeTemplateVersion(email.templateVersion),
    sourceType: email.sourceType ? truncateText(email.sourceType, 80) : null,
    sourceId: email.sourceId ? truncateText(email.sourceId, 191) : null,
    subject: email.subject.slice(0, 300),
    html: truncateText(email.html, EMAIL_OUTBOX_HTML_MAX_CHARS),
    dedupKey,
  }, client);
  return {
    job: result.jobId ? { id: result.jobId } : null,
    created: result.created,
  };
}

export async function enqueueEmailOutbox(
  email: QueuedEmail,
  client: EmailOutboxClient = prisma,
) {
  const { job } = await enqueueEmailOutboxOnce(email, client);
  return job;
}

async function processEmailOutboxClaim(claim: ClaimedEmailOutboxJob) {
  return processClaimedEmailOutboxJob(claim, {
    providerConfigured: isEmailProviderConfigured(),
    reserveRecipient: reserveRecipientDailySendAllowance,
    reserveGlobal: reserveDailySendAllowance,
    rollbackRecipient: rollbackRecipientDailySendAllowance,
    rollbackGlobal: rollbackDailySendAllowance,
    defer: deferEmailOutboxClaim,
    beginProviderAttempt: beginEmailOutboxProviderAttempt,
    sendLegacy: async (claimedJob) => {
      if (claimedJob.legacySubject === null || claimedJob.legacyHtml === null) {
        throw new TypeError("Structured email outbox payload requires the compatible renderer");
      }
      const providerMessageId = await sendRenderedEmail(
        {
          to: claimedJob.recipientEmail,
          subject: claimedJob.legacySubject,
          html: claimedJob.legacyHtml,
        },
        {
          throwOnFailure: true,
          idempotencyKey: claimedJob.dedupKey,
          preferenceKey: isValidEmailPreferenceKey(claimedJob.preferenceKey)
            ? claimedJob.preferenceKey
            : undefined,
          unsubscribeIssuedAt: claimedJob.createdAt,
          deliveryEligibilityAlreadyVerified: true,
        },
      );
      if (!providerMessageId) {
        throw new TypeError("Email provider returned success without a message id");
      }
      return providerMessageId;
    },
    renderStructured: renderStructuredEmailOutboxClaim,
    sendStructured: async (claimedJob, rendered) => {
      const providerMessageId = await sendRenderedEmail(
        {
          to: claimedJob.recipientEmail,
          subject: rendered.subject,
          html: rendered.html,
        },
        {
          throwOnFailure: true,
          idempotencyKey: claimedJob.dedupKey,
          preferenceKey: isValidEmailPreferenceKey(claimedJob.preferenceKey)
            ? claimedJob.preferenceKey
            : undefined,
          unsubscribeIssuedAt: claimedJob.createdAt,
          deliveryEligibilityAlreadyVerified: true,
        },
      );
      if (!providerMessageId) {
        throw new TypeError("Email provider returned success without a message id");
      }
      return providerMessageId;
    },
    complete: completeEmailOutboxClaim,
    fail: failEmailOutboxClaim,
    classifyFailure: classifyEmailOutboxFailure,
    sanitizeFailure: sanitizeEmailOutboxError,
    onFailure: (error, errorClass, claimedJob) => {
      Sentry.captureException(error, {
        tags: { source: "email_outbox", errorClass },
        extra: {
          emailOutboxId: claimedJob.jobId,
          claimGeneration: claimedJob.claimGeneration.toString(),
        },
      });
    },
  });
}

/**
 * Attempts one exact durable job immediately. A process exit before this call
 * or a retryable send failure leaves the same row for the scheduled batch.
 */
export async function processEmailOutboxJobById(id: string) {
  const claim = await claimEmailOutboxJob(id);
  if (!claim) return "unclaimed" as const;
  return processEmailOutboxClaim(claim);
}

export async function processEmailOutboxBatch({
  take = DEFAULT_BATCH_SIZE,
  concurrency = DEFAULT_CONCURRENCY,
}: {
  take?: number;
  concurrency?: number;
} = {}) {
  const claims = await claimEmailOutboxBatch(take);
  const results = await mapWithConcurrency(claims, concurrency, (claim) =>
    processEmailOutboxClaim(claim),
  );
  const rejected = results.filter((result) => result.status === "rejected");
  for (const result of rejected) {
    Sentry.captureException(result.reason, {
      tags: { source: "email_outbox", status: "worker_rejected" },
    });
  }

  return {
    picked: claims.length,
    sent: results.filter((result) => result.status === "fulfilled" && result.value === "sent").length,
    failed: results.filter((result) => result.status === "fulfilled" && result.value === "failed").length,
    skipped: results.filter((result) => result.status === "fulfilled" && result.value === "unclaimed").length,
    capped: results.filter((result) => result.status === "fulfilled" && result.value === "capped").length,
    deferred: results.filter((result) => result.status === "fulfilled" && result.value === "deferred").length,
    rejected: rejected.length,
  };
}
