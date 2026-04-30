import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { mapWithConcurrency } from "@/lib/concurrency";

export const runtime = "nodejs";
export const maxDuration = 60;
const CASE_AUTO_CLOSE_BATCH_SIZE = 100;
const CASE_AUTO_CLOSE_MAX_BATCHES = 5;
const CASE_AUTO_CLOSE_RECORD_CONCURRENCY = 5;

type CaseAutoCloseRecord = {
  id: string;
  buyerId: string | null;
  sellerId: string;
  orderId: string;
};

function cronErrorCode(error: unknown) {
  const err = error as { code?: string; name?: string };
  return err.code ?? err.name ?? "UNKNOWN";
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronRun = await beginCronRun("case-auto-close");
  if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

  try {
    // Auto-close PENDING_CLOSE cases older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let closed = 0;
    let stalePendingClose = 0;
    let stalePendingClosed = 0;
    let abandonedOpen = 0;
    let abandonedEscalated = 0;
    let stalePendingCloseBatches = 0;
    let abandonedOpenBatches = 0;
    let stalePendingCloseHasMore = false;
    let abandonedOpenHasMore = false;
    const failures: Array<{ caseId: string; action: "close" | "escalate"; code: string }> = [];

    async function closePendingCase(c: CaseAutoCloseRecord) {
      try {
        const updated = await prisma.case.updateMany({
          where: { id: c.id, status: "PENDING_CLOSE", updatedAt: { lt: cutoff } },
          data: { status: "RESOLVED", resolution: "DISMISSED", resolvedAt: new Date() },
        });
        if (updated.count === 0) return;

        const notifications: Array<() => Promise<unknown>> = [];
        if (c.buyerId) {
          const buyerId = c.buyerId;
          notifications.push(() => createNotification({
            userId: buyerId,
            type: "CASE_RESOLVED",
            title: "Case closed",
            body: "This case was closed automatically after the resolution window expired.",
            link: `/dashboard/orders/${c.orderId}`,
            dedupScope: c.id,
          }));
        }
        notifications.push(() => createNotification({
          userId: c.sellerId,
          type: "CASE_RESOLVED",
          title: "Case closed",
          body: "This case was closed automatically after the resolution window expired.",
          link: `/dashboard/sales/${c.orderId}`,
          dedupScope: c.id,
        }));
        await mapWithConcurrency(notifications, 2, (send) => send());
        stalePendingClosed++;
        closed++;
      } catch (error) {
        const code = cronErrorCode(error);
        failures.push({ caseId: c.id, action: "close", code });
        Sentry.captureException(error, {
          tags: { source: "cron_case_auto_close_record", action: "close", code },
          extra: { caseId: c.id },
        });
      }
    }

    const checkedPendingCaseIds = new Set<string>();
    for (let batch = 0; batch < CASE_AUTO_CLOSE_MAX_BATCHES; batch++) {
      const staleCases = await prisma.case.findMany({
        where: {
          status: "PENDING_CLOSE",
          updatedAt: { lt: cutoff },
          ...(checkedPendingCaseIds.size ? { id: { notIn: [...checkedPendingCaseIds] } } : {}),
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: CASE_AUTO_CLOSE_BATCH_SIZE,
        select: { id: true, buyerId: true, sellerId: true, orderId: true },
      });
      if (staleCases.length === 0) break;
      stalePendingCloseBatches++;
      stalePendingClose += staleCases.length;
      for (const c of staleCases) checkedPendingCaseIds.add(c.id);
      await mapWithConcurrency(staleCases, CASE_AUTO_CLOSE_RECORD_CONCURRENCY, closePendingCase);
      if (staleCases.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
      if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) stalePendingCloseHasMore = true;
    }

    // Escalate OPEN cases where seller never responded (14+ days past sellerRespondBy)
    const openCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    async function escalateOpenCase(c: CaseAutoCloseRecord) {
      try {
        const updated = await prisma.case.updateMany({
          where: { id: c.id, status: "OPEN", sellerRespondBy: { lt: openCutoff } },
          data: { status: "UNDER_REVIEW" },
        });
        if (updated.count === 0) return;

        const notifications: Array<() => Promise<unknown>> = [];
        if (c.buyerId) {
          const buyerId = c.buyerId;
          notifications.push(() => createNotification({
            userId: buyerId,
            type: "CASE_MESSAGE",
            title: "Case under review",
            body: "The seller did not respond in time, so Grainline staff will review this case.",
            link: `/dashboard/orders/${c.orderId}`,
            dedupScope: c.id,
          }));
        }
        notifications.push(() => createNotification({
          userId: c.sellerId,
          type: "CASE_MESSAGE",
          title: "Case escalated",
          body: "This case was escalated to Grainline staff because the response window expired.",
          link: `/dashboard/sales/${c.orderId}`,
          dedupScope: c.id,
        }));
        await mapWithConcurrency(notifications, 2, (send) => send());
        abandonedEscalated++;
        closed++;
      } catch (error) {
        const code = cronErrorCode(error);
        failures.push({ caseId: c.id, action: "escalate", code });
        Sentry.captureException(error, {
          tags: { source: "cron_case_auto_close_record", action: "escalate", code },
          extra: { caseId: c.id },
        });
      }
    }

    const checkedOpenCaseIds = new Set<string>();
    for (let batch = 0; batch < CASE_AUTO_CLOSE_MAX_BATCHES; batch++) {
      const abandonedOpenCases = await prisma.case.findMany({
        where: {
          status: "OPEN",
          sellerRespondBy: { lt: openCutoff },
          ...(checkedOpenCaseIds.size ? { id: { notIn: [...checkedOpenCaseIds] } } : {}),
        },
        orderBy: [{ sellerRespondBy: "asc" }, { id: "asc" }],
        take: CASE_AUTO_CLOSE_BATCH_SIZE,
        select: { id: true, buyerId: true, sellerId: true, orderId: true },
      });
      if (abandonedOpenCases.length === 0) break;
      abandonedOpenBatches++;
      abandonedOpen += abandonedOpenCases.length;
      for (const c of abandonedOpenCases) checkedOpenCaseIds.add(c.id);
      await mapWithConcurrency(abandonedOpenCases, CASE_AUTO_CLOSE_RECORD_CONCURRENCY, escalateOpenCase);
      if (abandonedOpenCases.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
      if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) abandonedOpenHasMore = true;
    }

    const response = {
      closed,
      stalePendingClose,
      stalePendingClosed,
      abandonedOpen,
      abandonedEscalated,
      stalePendingCloseBatches,
      abandonedOpenBatches,
      stalePendingCloseHasMore,
      abandonedOpenHasMore,
      failures,
    };
    await completeCronRun(cronRun, response);
    return NextResponse.json(response);
  } catch (error) {
    await failCronRun(cronRun, error);
    console.error("[case-auto-close cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_case_auto_close" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
