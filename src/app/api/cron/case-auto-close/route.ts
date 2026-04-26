import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;
const CASE_AUTO_CLOSE_BATCH_SIZE = 100;

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Auto-close PENDING_CLOSE cases older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const staleCases = await prisma.case.findMany({
      where: { status: "PENDING_CLOSE", updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: "asc" },
      take: CASE_AUTO_CLOSE_BATCH_SIZE,
      select: { id: true, buyerId: true, sellerId: true, orderId: true },
    });

    let closed = 0;
    for (const c of staleCases) {
      await prisma.case.update({
        where: { id: c.id },
        data: { status: "RESOLVED", resolution: "DISMISSED", resolvedAt: new Date() },
      });
      await Promise.allSettled([
        createNotification({
          userId: c.buyerId,
          type: "CASE_RESOLVED",
          title: "Case closed",
          body: "This case was closed automatically after the resolution window expired.",
          link: `/dashboard/orders/${c.orderId}`,
        }),
        createNotification({
          userId: c.sellerId,
          type: "CASE_RESOLVED",
          title: "Case closed",
          body: "This case was closed automatically after the resolution window expired.",
          link: `/dashboard/sales/${c.orderId}`,
        }),
      ]);
      closed++;
    }

    // Escalate OPEN cases where seller never responded (14+ days past sellerRespondBy)
    const openCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const abandonedOpen = await prisma.case.findMany({
      where: { status: "OPEN", sellerRespondBy: { lt: openCutoff } },
      orderBy: { sellerRespondBy: "asc" },
      take: CASE_AUTO_CLOSE_BATCH_SIZE,
      select: { id: true, buyerId: true, sellerId: true, orderId: true },
    });

    for (const c of abandonedOpen) {
      await prisma.case.update({
        where: { id: c.id },
        data: { status: "UNDER_REVIEW" },
      });
      await Promise.allSettled([
        createNotification({
          userId: c.buyerId,
          type: "CASE_MESSAGE",
          title: "Case under review",
          body: "The seller did not respond in time, so Grainline staff will review this case.",
          link: `/dashboard/orders/${c.orderId}`,
        }),
        createNotification({
          userId: c.sellerId,
          type: "CASE_MESSAGE",
          title: "Case escalated",
          body: "This case was escalated to Grainline staff because the response window expired.",
          link: `/dashboard/sales/${c.orderId}`,
        }),
      ]);
      closed++;
    }

    return NextResponse.json({ closed, stalePendingClose: staleCases.length, abandonedOpen: abandonedOpen.length });
  } catch (error) {
    console.error("[case-auto-close cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_case_auto_close" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
