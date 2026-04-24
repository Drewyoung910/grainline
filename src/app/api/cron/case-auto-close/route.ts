import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (!cronSecret || bearer !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Auto-close PENDING_CLOSE cases older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const staleCases = await prisma.case.findMany({
      where: { status: "PENDING_CLOSE", updatedAt: { lt: cutoff } },
      select: { id: true },
    });

    let closed = 0;
    for (const c of staleCases) {
      await prisma.case.update({
        where: { id: c.id },
        data: { status: "RESOLVED", resolution: "DISMISSED" },
      });
      closed++;
    }

    // Escalate OPEN cases where seller never responded (14+ days past sellerRespondBy)
    const openCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const abandonedOpen = await prisma.case.findMany({
      where: { status: "OPEN", sellerRespondBy: { lt: openCutoff } },
      select: { id: true },
    });

    for (const c of abandonedOpen) {
      await prisma.case.update({
        where: { id: c.id },
        data: { status: "UNDER_REVIEW" },
      });
      closed++;
    }

    return NextResponse.json({ closed, stalePendingClose: staleCases.length, abandonedOpen: abandonedOpen.length });
  } catch (error) {
    console.error("[case-auto-close cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_case_auto_close" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
