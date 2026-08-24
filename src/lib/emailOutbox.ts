import { randomUUID } from "node:crypto";
import type { EmailOutbox } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { isEmailDeliverySuppressed, normalizeEmailAddress } from "@/lib/emailSuppression";
import { sendRenderedEmail } from "@/lib/email";
import { shouldSendEmail } from "@/lib/notifications";
import { redis } from "@/lib/ratelimit";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { truncateText } from "@/lib/sanitize";
import {
  emailOutboxProcessingStaleCutoff,
  emailOutboxDedupKey,
  emailOutboxFailureState,
  emailOutboxQuotaDeferralState,
} from "@/lib/emailOutboxState";
import {
  EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT,
  EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT,
  reserveEmailOutboxDailySendAllowance,
  reserveEmailOutboxRecipientDailySendAllowance,
  rollbackEmailOutboxRecipientDailySendAllowance,
} from "@/lib/emailOutboxQuota";
import { isValidEmailPreferenceKey } from "@/lib/notificationPreferenceKeys";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;
export const EMAIL_OUTBOX_HTML_MAX_CHARS = 200_000;
export const EMAIL_OUTBOX_TEMPLATE_VERSION = 1;
export const EMAIL_OUTBOX_TEMPLATE_NAMES = [
  "back_in_stock",
  "case_resolved",
  "first_listing_congrats",
  "first_sale_congrats",
  "followed_maker_new_listing",
  "order_confirmed_buyer",
  "order_confirmed_seller",
  "refund_issued",
  "seller_broadcast",
  "welcome",
] as const;
const dailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);
const recipientDailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);
const recipientDailySendAllowanceRollbackScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT);

export type EmailOutboxTemplateName = typeof EMAIL_OUTBOX_TEMPLATE_NAMES[number];

export type QueuedEmail = {
  to: string;
  subject: string;
  html: string;
  dedupKey: string;
  templateName: EmailOutboxTemplateName;
  templateVersion?: number;
  userId?: string;
  preferenceKey?: string;
  sourceType?: string;
  sourceId?: string;
};

export type EnqueueEmailOutboxResult = {
  job: EmailOutbox | null;
  created: boolean;
};

type EmailOutboxClient = Pick<typeof prisma, "emailOutbox">;

function normalizeTemplateVersion(version: number | undefined) {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return EMAIL_OUTBOX_TEMPLATE_VERSION;
  }
  return version;
}

async function reserveDailySendAllowance(requested: number, now: Date) {
  return reserveEmailOutboxDailySendAllowance({
    requested,
    now,
    counter: ({ key, requested: requestedCount, limit, ttlSeconds }) =>
      dailySendAllowanceScript.eval(
        [key],
        [String(requestedCount), String(limit), String(ttlSeconds)],
      ),
    onCounterError: (error) =>
      Sentry.captureException(error, { tags: { source: "email_outbox_daily_quota" } }),
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

async function inactiveQueuedEmailRecipientReason(job: {
  userId: string | null;
  recipientEmail: string;
}) {
  if (job.userId) {
    const user = await prisma.user.findUnique({
      where: { id: job.userId },
      select: { banned: true, deletedAt: true },
    });
    if (!user) return "Recipient account no longer exists";
    if (user.banned) return "Recipient account is banned";
    if (user.deletedAt) return "Recipient account is deleted";
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: job.recipientEmail },
    select: { banned: true, deletedAt: true },
  });
  if (user?.banned) return "Recipient account is banned";
  if (user?.deletedAt) return "Recipient account is deleted";
  return null;
}

async function skipEmailOutboxJob(id: string, lastError: string) {
  await prisma.emailOutbox.update({
    where: { id },
    data: {
      status: "SKIPPED",
      sentAt: new Date(),
      nextAttemptAt: null,
      lastError,
    },
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

  // PostgreSQL marks a transaction failed after a uniqueness error. Use the
  // provider's ON CONFLICT path so an exact replay can read the retained row
  // without aborting a caller-owned transaction.
  const inserted = await client.emailOutbox.createMany({
    data: {
      id: randomUUID(),
      recipientEmail: recipient,
      userId: email.userId,
      preferenceKey: email.preferenceKey,
      templateName: email.templateName,
      templateVersion: normalizeTemplateVersion(email.templateVersion),
      sourceType: email.sourceType ? truncateText(email.sourceType, 80) : undefined,
      sourceId: email.sourceId ? truncateText(email.sourceId, 191) : undefined,
      subject: email.subject.slice(0, 300),
      html: truncateText(email.html, EMAIL_OUTBOX_HTML_MAX_CHARS),
      dedupKey,
    },
    skipDuplicates: true,
  });
  const job = await client.emailOutbox.findUnique({ where: { dedupKey } });
  if (!job) {
    throw new Error("Email outbox insert completed without a durable row");
  }
  return { job, created: inserted.count === 1 };
}

export async function enqueueEmailOutbox(
  email: QueuedEmail,
  client: EmailOutboxClient = prisma,
) {
  const { job } = await enqueueEmailOutboxOnce(email, client);
  return job;
}

type EmailOutboxProcessResult = "sent" | "failed" | "skipped" | "capped" | "unclaimed";

async function processEmailOutboxJob(
  job: EmailOutbox,
  staleProcessingCutoff: Date,
): Promise<EmailOutboxProcessResult> {
  const claimed = await prisma.emailOutbox.updateMany({
    where: {
      id: job.id,
      OR: [
        {
          status: { in: ["PENDING", "FAILED"] },
          nextAttemptAt: { lte: new Date() },
        },
        {
          status: "PROCESSING",
          updatedAt: { lt: staleProcessingCutoff },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      nextAttemptAt: null,
      lastError: null,
    },
  });
  if (claimed.count !== 1) return "unclaimed";

  const claimedJob = await prisma.emailOutbox.findUnique({
    where: { id: job.id },
    select: { attempts: true },
  });
  const attempts = claimedJob?.attempts ?? job.attempts + 1;
  try {
    const inactiveReason = await inactiveQueuedEmailRecipientReason(job);
    if (inactiveReason) {
      await skipEmailOutboxJob(job.id, inactiveReason);
      return "skipped";
    }

    if (job.userId && job.preferenceKey && !isValidEmailPreferenceKey(job.preferenceKey)) {
      await skipEmailOutboxJob(job.id, `Invalid email preference key: ${job.preferenceKey}`);
      return "skipped";
    }

    if (job.userId && job.preferenceKey && !(await shouldSendEmail(job.userId, job.preferenceKey))) {
      await skipEmailOutboxJob(job.id, "Email preference disabled before send");
      return "skipped";
    }

    if (await isEmailDeliverySuppressed(job.recipientEmail)) {
      await skipEmailOutboxJob(job.id, "Recipient email is suppressed after a bounce, complaint, or account deletion");
      return "skipped";
    }

    const quotaCheckedAt = new Date();
    const recipientQuota = await reserveRecipientDailySendAllowance(job.recipientEmail, 1, quotaCheckedAt);
    if (recipientQuota.allowed < 1) {
      const deferral = emailOutboxQuotaDeferralState({
        counterAvailable: recipientQuota.counterAvailable,
        resetAt: recipientQuota.resetAt,
        attempts,
        now: quotaCheckedAt,
      });
      await prisma.emailOutbox.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          attempts: deferral.attempts,
          nextAttemptAt: deferral.nextAttemptAt,
          lastError: recipientQuota.counterAvailable
            ? `Daily per-recipient email outbox send cap reached (${recipientQuota.limit}/recipient/day)`
            : "Daily per-recipient email outbox send cap unavailable",
        },
      });
      Sentry.captureMessage(recipientQuota.counterAvailable
        ? "Email outbox recipient daily send cap reached"
        : "Email outbox recipient daily send cap unavailable", {
        level: "warning",
        tags: { source: "email_outbox_recipient_quota" },
        extra: {
          emailOutboxId: job.id,
          limit: recipientQuota.limit,
          nextAttemptAt: deferral.nextAttemptAt.toISOString(),
          resetAt: recipientQuota.resetAt.toISOString(),
          counterAvailable: recipientQuota.counterAvailable,
        },
      });
      return "capped";
    }

    const quota = await reserveDailySendAllowance(1, quotaCheckedAt);
    if (quota.allowed < 1) {
      await rollbackRecipientDailySendAllowance(job.recipientEmail, recipientQuota.allowed, quotaCheckedAt);
      const deferral = emailOutboxQuotaDeferralState({
        counterAvailable: quota.counterAvailable,
        resetAt: quota.resetAt,
        attempts,
        now: quotaCheckedAt,
      });
      await prisma.emailOutbox.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          attempts: deferral.attempts,
          nextAttemptAt: deferral.nextAttemptAt,
          lastError: quota.counterAvailable
            ? `${deferral.lastError} (${quota.limit}/day)`
            : deferral.lastError,
        },
      });
      Sentry.captureMessage(quota.counterAvailable
        ? "Email outbox daily send cap reached"
        : "Email outbox daily send cap unavailable", {
        level: "warning",
        tags: { source: "email_outbox_daily_quota" },
        extra: {
          emailOutboxId: job.id,
          limit: quota.limit,
          nextAttemptAt: deferral.nextAttemptAt.toISOString(),
          resetAt: quota.resetAt.toISOString(),
          counterAvailable: quota.counterAvailable,
        },
      });
      return "capped";
    }

    await sendRenderedEmail(
      { to: job.recipientEmail, subject: job.subject, html: job.html },
      { throwOnFailure: true, idempotencyKey: job.dedupKey },
    );
    await prisma.emailOutbox.update({
      where: { id: job.id },
      data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null, lastError: null },
    });
    return "sent";
  } catch (error) {
    const failureState = emailOutboxFailureState(attempts);
    await prisma.emailOutbox.update({
      where: { id: job.id },
      data: {
        status: failureState.status,
        nextAttemptAt: failureState.nextAttemptAt,
        lastError: sanitizeEmailOutboxError(error),
      },
    });
    Sentry.captureException(error, {
      tags: { source: "email_outbox", status: failureState.terminal ? "dead" : "retry" },
      extra: { emailOutboxId: job.id, attempts },
    });
    return "failed";
  }
}

/**
 * Attempts one exact durable job immediately. A process exit before this call
 * or a retryable send failure leaves the same row for the scheduled batch.
 */
export async function processEmailOutboxJobById(id: string) {
  const job = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!job) return "missing" as const;
  return processEmailOutboxJob(job, emailOutboxProcessingStaleCutoff(new Date()));
}

export async function processEmailOutboxBatch({
  take = DEFAULT_BATCH_SIZE,
  concurrency = DEFAULT_CONCURRENCY,
}: {
  take?: number;
  concurrency?: number;
} = {}) {
  const now = new Date();
  const staleProcessingCutoff = emailOutboxProcessingStaleCutoff(now);
  const jobs = await prisma.emailOutbox.findMany({
    where: {
      OR: [
        {
          status: { in: ["PENDING", "FAILED"] },
          nextAttemptAt: { lte: now },
        },
        {
          status: "PROCESSING",
          updatedAt: { lt: staleProcessingCutoff },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take,
  });

  const results = await mapWithConcurrency(jobs, concurrency, (job) =>
    processEmailOutboxJob(job, staleProcessingCutoff),
  );

  return {
    picked: jobs.length,
    sent: results.filter((result) => result.status === "fulfilled" && result.value === "sent").length,
    failed: results.filter((result) => result.status === "fulfilled" && result.value === "failed").length,
    skipped: results.filter((result) => result.status === "fulfilled"
      && (result.value === "skipped" || result.value === "unclaimed")).length,
    capped: results.filter((result) => result.status === "fulfilled" && result.value === "capped").length,
  };
}
