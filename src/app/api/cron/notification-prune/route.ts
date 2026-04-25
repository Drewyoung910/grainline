import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.notification.deleteMany({
      where: {
        read: true,
        createdAt: { lt: cutoff },
      },
    });

    return NextResponse.json({ pruned: result.count });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "cron_notification_prune" } });
    return NextResponse.json({ error: "Prune failed" }, { status: 500 });
  }
}
