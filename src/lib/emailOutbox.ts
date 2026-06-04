import { Prisma, type EmailOutbox } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
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
  reserveEmailOutboxDailySendAllowance,
  reserveEmailOutboxRecipientDailySendAllowance,
} from "@/lib/emailOutboxQuota";
import { isValidEmailPreferenceKey } from "@/lib/notificationPreferenceKeys";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;
export const EMAIL_OUTBOX_HTML_MAX_CHARS = 200_000;
export const EMAIL_OUTBOX_TEMPLATE_VERSION = 1;
export const EMAIL_OUTBOX_TEMPLATE_NAMES = [
  "back_in_stock",
  "first_listing_congrats",
  "first_sale_congrats",
  "followed_maker_new_listing",
  "order_confirmed_buyer",
  "order_confirmed_seller",
  "seller_broadcast",
  "welcome",
] as const;
const dailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);
const recipientDailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);

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
};

export type EnqueueEmailOutboxResult = {
  job: EmailOutbox | null;
  created: boolean;
};

function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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

export async function enqueueEmailOutboxOnce(email: QueuedEmail): Promise<EnqueueEmailOutboxResult> {
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

  try {
    const job = await prisma.emailOutbox.create({
      data: {
        recipientEmail: recipient,
        userId: email.userId,
        preferenceKey: email.preferenceKey,
        templateName: email.templateName,
        templateVersion: normalizeTemplateVersion(email.templateVersion),
        subject: email.subject.slice(0, 300),
        html: truncateText(email.html, EMAIL_OUTBOX_HTML_MAX_CHARS),
        dedupKey,
      },
    });
    return { job, created: true };
  } catch (error) {
    if (isUniqueError(error)) {
      const job = await prisma.emailOutbox.findUnique({ where: { dedupKey } });
      return { job, created: false };
    }
    throw error;
  }
}

export async function enqueueEmailOutbox(email: QueuedEmail) {
  const { job } = await enqueueEmailOutboxOnce(email);
  return job;
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

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let capped = 0;

  await mapWithConcurrency(jobs, concurrency, async (job) => {
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
    if (claimed.count !== 1) {
      skipped += 1;
      return;
    }

    const claimedJob = await prisma.emailOutbox.findUnique({
      where: { id: job.id },
      select: { attempts: true },
    });
    const attempts = claimedJob?.attempts ?? job.attempts + 1;
    try {
      const inactiveReason = await inactiveQueuedEmailRecipientReason(job);
      if (inactiveReason) {
        await skipEmailOutboxJob(job.id, inactiveReason);
        skipped += 1;
        return;
      }

      if (job.userId && job.preferenceKey && !isValidEmailPreferenceKey(job.preferenceKey)) {
        await skipEmailOutboxJob(job.id, `Invalid email preference key: ${job.preferenceKey}`);
        skipped += 1;
        return;
      }

      if (job.userId && job.preferenceKey && !(await shouldSendEmail(job.userId, job.preferenceKey))) {
        await skipEmailOutboxJob(job.id, "Email preference disabled before send");
        skipped += 1;
        return;
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
        capped += 1;
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
        return;
      }

      const quota = await reserveDailySendAllowance(1, quotaCheckedAt);
      if (quota.allowed < 1) {
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
        capped += 1;
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
        return;
      }

      await sendRenderedEmail(
        { to: job.recipientEmail, subject: job.subject, html: job.html },
        { throwOnFailure: true, idempotencyKey: job.dedupKey },
      );
      await prisma.emailOutbox.update({
        where: { id: job.id },
        data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null, lastError: null },
      });
      sent += 1;
    } catch (error) {
      const failureState = emailOutboxFailureState(attempts);
      failed += 1;
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
    }
  });

  return { picked: jobs.length, sent, failed, skipped, capped };
}
