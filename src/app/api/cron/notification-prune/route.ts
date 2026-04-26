import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const [result, staleRefundLocks] = await Promise.all([
      prisma.notification.deleteMany({
        where: {
          read: true,
          createdAt: { lt: cutoff },
        },
      }),
      releaseStaleRefundLocks(),
    ]);

    return NextResponse.json({ pruned: result.count, staleRefundLocksReleased: staleRefundLocks.count });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "cron_notification_prune" } });
    return NextResponse.json({ error: "Prune failed" }, { status: 500 });
  }
}
