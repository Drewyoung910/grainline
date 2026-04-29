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
  EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT,
  reserveEmailOutboxDailySendAllowance,
} from "@/lib/emailOutboxQuota";

const MAX_ATTEMPTS = 10;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 5;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
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

function retryDelayMs(attempts: number) {
  const seconds = Math.min(6 * 60 * 60, 60 * 2 ** Math.max(0, attempts - 1));
  return seconds * 1000;
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

  try {
    return await prisma.emailOutbox.create({
      data: {
        recipientEmail: recipient,
        userId: email.userId,
        preferenceKey: email.preferenceKey,
        subject: email.subject.slice(0, 300),
        html: email.html,
        dedupKey: email.dedupKey.slice(0, 128),
      },
    });
  } catch (error) {
    if (isUniqueError(error)) {
      return prisma.emailOutbox.findUnique({ where: { dedupKey: email.dedupKey.slice(0, 128) } });
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
  const staleProcessingCutoff = new Date(now.getTime() - PROCESSING_STALE_MS);
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
        lastError: null,
      },
    });
    if (claimed.count !== 1) {
      skipped += 1;
      return;
    }

    const attempts = job.attempts + 1;
    try {
      if (job.userId && job.preferenceKey && !(await shouldSendEmail(job.userId, job.preferenceKey))) {
        await prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: "SKIPPED",
            sentAt: new Date(),
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
            lastError: `Daily email outbox send cap reached (${quota.limit}/day)`,
          },
        });
        capped += 1;
        Sentry.captureMessage("Email outbox daily send cap reached", {
          level: "warning",
          tags: { source: "email_outbox_daily_quota" },
          extra: { emailOutboxId: job.id, limit: quota.limit, resetAt: quota.resetAt.toISOString() },
        });
        return;
      }

      await sendRenderedEmail(
        { to: job.recipientEmail, subject: job.subject, html: job.html },
        { throwOnFailure: true },
      );
      await prisma.emailOutbox.update({
        where: { id: job.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } catch (error) {
      const terminal = attempts >= MAX_ATTEMPTS;
      failed += 1;
      await prisma.emailOutbox.update({
        where: { id: job.id },
        data: {
          status: terminal ? "DEAD" : "FAILED",
          nextAttemptAt: terminal ? new Date("9999-12-31T00:00:00.000Z") : new Date(Date.now() + retryDelayMs(attempts)),
          lastError: sanitizeEmailOutboxError(error),
        },
      });
      Sentry.captureException(error, {
        tags: { source: "email_outbox", status: terminal ? "dead" : "retry" },
        extra: { emailOutboxId: job.id, attempts },
      });
    }
  });

  return { picked: jobs.length, sent, failed, skipped, capped };
}
