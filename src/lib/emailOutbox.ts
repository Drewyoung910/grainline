import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { sendRenderedEmail } from "@/lib/email";
import { shouldSendEmail } from "@/lib/notifications";
import { redis } from "@/lib/ratelimit";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import {
  emailOutboxProcessingStaleCutoff,
  emailOutboxDedupKey,
  emailOutboxFailureState,
} from "@/lib/emailOutboxState";
import {
  EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT,
  reserveEmailOutboxDailySendAllowance,
} from "@/lib/emailOutboxQuota";
import { isValidEmailPreferenceKey } from "@/lib/notificationPreferenceKeys";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;
const dailySendAllowanceScript = redis.createScript<number>(EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT);

export type QueuedEmail = {
  to: string;
  subject: string;
  html: string;
  dedupKey: string;
  userId?: string;
  preferenceKey?: string;
};

function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

export async function enqueueEmailOutbox(email: QueuedEmail) {
  const recipient = normalizeEmailAddress(email.to);
  if (!recipient) return null;
  if (email.preferenceKey && !isValidEmailPreferenceKey(email.preferenceKey)) {
    Sentry.captureMessage("Skipping email outbox enqueue with invalid preference key", {
      level: "warning",
      tags: { source: "email_outbox", reason: "invalid_preference_key" },
      extra: { preferenceKey: email.preferenceKey, userId: email.userId },
    });
    return null;
  }
  const dedupKey = emailOutboxDedupKey(email.dedupKey);

  try {
    return await prisma.emailOutbox.create({
      data: {
        recipientEmail: recipient,
        userId: email.userId,
        preferenceKey: email.preferenceKey,
        subject: email.subject.slice(0, 300),
        html: email.html,
        dedupKey,
      },
    });
  } catch (error) {
    if (isUniqueError(error)) {
      return prisma.emailOutbox.findUnique({ where: { dedupKey } });
    }
    throw error;
  }
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
      if (job.userId && job.preferenceKey && !isValidEmailPreferenceKey(job.preferenceKey)) {
        await prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: "SKIPPED",
            sentAt: new Date(),
            nextAttemptAt: null,
            lastError: `Invalid email preference key: ${job.preferenceKey}`,
          },
        });
        skipped += 1;
        return;
      }

      if (job.userId && job.preferenceKey && !(await shouldSendEmail(job.userId, job.preferenceKey))) {
        await prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: "SKIPPED",
            sentAt: new Date(),
            nextAttemptAt: null,
            lastError: "Email preference disabled before send",
          },
        });
        skipped += 1;
        return;
      }

      const quota = await reserveDailySendAllowance(1, new Date());
      if (quota.allowed < 1) {
        await prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: "PENDING",
            nextAttemptAt: quota.resetAt,
            lastError: quota.counterAvailable
              ? `Daily email outbox send cap reached (${quota.limit}/day)`
              : "Daily email outbox send cap unavailable",
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
            resetAt: quota.resetAt.toISOString(),
            counterAvailable: quota.counterAvailable,
          },
        });
        return;
      }

      await sendRenderedEmail(
        { to: job.recipientEmail, subject: job.subject, html: job.html },
        { throwOnFailure: true },
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
