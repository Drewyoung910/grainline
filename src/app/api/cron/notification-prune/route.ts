import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { pruneEmailOutboxRetention } from "@/lib/emailOutboxRetention";
import { notificationRetentionCutoffs, NOTIFICATION_RETENTION_BATCH_SIZE, NOTIFICATION_RETENTION_TIME_BUDGET_MS } from "@/lib/notificationRetentionState";
import { pruneWebhookEventRetention } from "@/lib/webhookEventRetention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("notification-prune", { value: "10 11 * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("notification-prune");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    const { readCutoff, unreadCutoff } = notificationRetentionCutoffs();

    try {
      const [readPruned, unreadPruned, staleRefundLocks, emailOutboxPruned, webhookEventsPruned] = await Promise.all([
        pruneReadNotifications(readCutoff),
        pruneUnreadNotifications(unreadCutoff),
        releaseStaleRefundLocksForPrune(),
        pruneEmailOutboxRetention(),
        pruneWebhookEventRetention(),
      ]);

      const response = {
        pruned: readPruned.count,
        pruneComplete: readPruned.complete,
        unreadPruned: unreadPruned.count,
        unreadPruneComplete: unreadPruned.complete,
        staleRefundLocksReleased: staleRefundLocks.count,
        staleRefundLocksReleaseFailed: staleRefundLocks.failed,
        emailOutboxPruned: emailOutboxPruned.count,
        emailOutboxPruneComplete: emailOutboxPruned.complete,
        webhookEventsPruned: webhookEventsPruned.count,
        webhookEventsPruneComplete: webhookEventsPruned.complete,
      };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_notification_prune" } });
      return NextResponse.json({ error: "Prune failed" }, { status: 500 });
    }
  });
}

async function releaseStaleRefundLocksForPrune(): Promise<{ count: number; failed: boolean }> {
  try {
    const result = await releaseStaleRefundLocks();
    return { count: result.count, failed: false };
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "cron_refund_lock_release" } });
    return { count: 0, failed: true };
  }
}

async function pruneReadNotifications(cutoff: Date): Promise<{ count: number; complete: boolean }> {
  const deadline = Date.now() + NOTIFICATION_RETENTION_TIME_BUDGET_MS;
  let totalDeleted = 0;

  while (Date.now() < deadline) {
    const deleted = await prisma.$executeRaw<number>`
      DELETE FROM "Notification"
      WHERE id IN (
        SELECT id
        FROM "Notification"
        WHERE "read" = true
          AND "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${NOTIFICATION_RETENTION_BATCH_SIZE}
      )
    `;
    const count = Number(deleted);
    totalDeleted += count;
    if (count === 0 || count < NOTIFICATION_RETENTION_BATCH_SIZE) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}

async function pruneUnreadNotifications(cutoff: Date): Promise<{ count: number; complete: boolean }> {
  const deadline = Date.now() + NOTIFICATION_RETENTION_TIME_BUDGET_MS;
  let totalDeleted = 0;

  while (Date.now() < deadline) {
    const deleted = await prisma.$executeRaw<number>`
      DELETE FROM "Notification"
      WHERE id IN (
        SELECT id
        FROM "Notification"
        WHERE "read" = false
          AND "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${NOTIFICATION_RETENTION_BATCH_SIZE}
      )
    `;
    const count = Number(deleted);
    totalDeleted += count;
    if (count === 0 || count < NOTIFICATION_RETENTION_BATCH_SIZE) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}
