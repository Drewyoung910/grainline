import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTIFICATION_PRUNE_BATCH_SIZE = 1000;
const PRUNE_TIME_BUDGET_MS = 45_000;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const [pruned, staleRefundLocks] = await Promise.all([
      pruneReadNotifications(cutoff),
      releaseStaleRefundLocks(),
    ]);

    return NextResponse.json({
      pruned: pruned.count,
      pruneComplete: pruned.complete,
      staleRefundLocksReleased: staleRefundLocks.count,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "cron_notification_prune" } });
    return NextResponse.json({ error: "Prune failed" }, { status: 500 });
  }
}

async function pruneReadNotifications(cutoff: Date): Promise<{ count: number; complete: boolean }> {
  const deadline = Date.now() + PRUNE_TIME_BUDGET_MS;
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
        LIMIT ${NOTIFICATION_PRUNE_BATCH_SIZE}
      )
    `;
    const count = Number(deleted);
    totalDeleted += count;
    if (count === 0 || count < NOTIFICATION_PRUNE_BATCH_SIZE) {
      return { count: totalDeleted, complete: true };
    }
  }

  return { count: totalDeleted, complete: false };
}
