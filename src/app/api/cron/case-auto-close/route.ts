import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;
const CASE_AUTO_CLOSE_BATCH_SIZE = 100;
const CASE_AUTO_CLOSE_MAX_BATCHES = 5;
const CASE_AUTO_CLOSE_RECORD_CONCURRENCY = 5;
const STALE_DISCUSSION_DAYS = 30;

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
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("case-auto-close", { value: "10 8 * * *", maxRuntimeMinutes: 1 }, async () => {
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
      let staleDiscussion = 0;
      let staleDiscussionEscalated = 0;
      let stalePendingCloseBatches = 0;
      let abandonedOpenBatches = 0;
      let staleDiscussionBatches = 0;
      let stalePendingCloseHasMore = false;
      let abandonedOpenHasMore = false;
      let staleDiscussionHasMore = false;
      const failures: Array<{ caseId: string; action: "close" | "escalate"; code: string }> = [];

    async function closePendingCase(c: CaseAutoCloseRecord) {
      try {
        const updated = await prisma.$transaction(async (tx) => {
          const resolvedAt = new Date();
          const result = await tx.case.updateMany({
            where: { id: c.id, status: "PENDING_CLOSE", updatedAt: { lt: cutoff } },
            data: { status: "RESOLVED", resolution: "DISMISSED", resolvedAt },
          });
          if (result.count === 0) return false;
          await logSystemActionOrThrow({
            client: tx,
            actorType: "cron",
            actorId: "case-auto-close",
            action: "AUTO_CLOSE_CASE",
            targetType: "CASE",
            targetId: c.id,
            reason: "Resolution window expired",
            metadata: {
              jobName: "case-auto-close",
              previousStatus: "PENDING_CLOSE",
              newStatus: "RESOLVED",
              orderId: c.orderId,
              cutoff: cutoff.toISOString(),
              resolvedAt: resolvedAt.toISOString(),
            },
          });
          return true;
        });
        if (!updated) return;

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
        const updated = await prisma.$transaction(async (tx) => {
          const result = await tx.case.updateMany({
            where: { id: c.id, status: "OPEN", sellerRespondBy: { lt: openCutoff } },
            data: { status: "UNDER_REVIEW" },
          });
          if (result.count === 0) return false;
          await logSystemActionOrThrow({
            client: tx,
            actorType: "cron",
            actorId: "case-auto-close",
            action: "AUTO_ESCALATE_CASE",
            targetType: "CASE",
            targetId: c.id,
            reason: "Seller response window expired",
            metadata: {
              jobName: "case-auto-close",
              previousStatus: "OPEN",
              newStatus: "UNDER_REVIEW",
              orderId: c.orderId,
              cutoff: openCutoff.toISOString(),
            },
          });
          return true;
        });
        if (!updated) return;

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

    // Escalate IN_DISCUSSION cases that have stalled for 30+ days. A seller
    // reply moves OPEN cases into discussion; without this, either party can
    // abandon the thread indefinitely after the first response.
    const discussionCutoff = new Date(Date.now() - STALE_DISCUSSION_DAYS * 24 * 60 * 60 * 1000);
    async function escalateStaleDiscussionCase(c: CaseAutoCloseRecord) {
      try {
        const updated = await prisma.$transaction(async (tx) => {
          const result = await tx.case.updateMany({
            where: { id: c.id, status: "IN_DISCUSSION", updatedAt: { lt: discussionCutoff } },
            data: { status: "UNDER_REVIEW" },
          });
          if (result.count === 0) return false;
          await logSystemActionOrThrow({
            client: tx,
            actorType: "cron",
            actorId: "case-auto-close",
            action: "AUTO_ESCALATE_CASE",
            targetType: "CASE",
            targetId: c.id,
            reason: "Discussion inactivity window expired",
            metadata: {
              jobName: "case-auto-close",
              previousStatus: "IN_DISCUSSION",
              newStatus: "UNDER_REVIEW",
              orderId: c.orderId,
              cutoff: discussionCutoff.toISOString(),
            },
          });
          return true;
        });
        if (!updated) return;

        const notifications: Array<() => Promise<unknown>> = [];
        if (c.buyerId) {
          const buyerId = c.buyerId;
          notifications.push(() => createNotification({
            userId: buyerId,
            type: "CASE_MESSAGE",
            title: "Case under review",
            body: "This case has been inactive, so Grainline staff will review it.",
            link: `/dashboard/orders/${c.orderId}`,
            dedupScope: c.id,
          }));
        }
        notifications.push(() => createNotification({
          userId: c.sellerId,
          type: "CASE_MESSAGE",
          title: "Case escalated",
          body: "This case was escalated to Grainline staff after the discussion stalled.",
          link: `/dashboard/sales/${c.orderId}`,
          dedupScope: c.id,
        }));
        await mapWithConcurrency(notifications, 2, (send) => send());
        staleDiscussionEscalated++;
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

    const checkedDiscussionCaseIds = new Set<string>();
    for (let batch = 0; batch < CASE_AUTO_CLOSE_MAX_BATCHES; batch++) {
      const staleDiscussionCases = await prisma.case.findMany({
        where: {
          status: "IN_DISCUSSION",
          updatedAt: { lt: discussionCutoff },
          ...(checkedDiscussionCaseIds.size ? { id: { notIn: [...checkedDiscussionCaseIds] } } : {}),
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: CASE_AUTO_CLOSE_BATCH_SIZE,
        select: { id: true, buyerId: true, sellerId: true, orderId: true },
      });
      if (staleDiscussionCases.length === 0) break;
      staleDiscussionBatches++;
      staleDiscussion += staleDiscussionCases.length;
      for (const c of staleDiscussionCases) checkedDiscussionCaseIds.add(c.id);
      await mapWithConcurrency(staleDiscussionCases, CASE_AUTO_CLOSE_RECORD_CONCURRENCY, escalateStaleDiscussionCase);
      if (staleDiscussionCases.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
      if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) staleDiscussionHasMore = true;
    }

    const response = {
      closed,
      stalePendingClose,
      stalePendingClosed,
      abandonedOpen,
      abandonedEscalated,
      staleDiscussion,
      staleDiscussionEscalated,
      stalePendingCloseBatches,
      abandonedOpenBatches,
      staleDiscussionBatches,
      stalePendingCloseHasMore,
      abandonedOpenHasMore,
      staleDiscussionHasMore,
      failures,
    };
    await completeCronRun(cronRun, response);
    return NextResponse.json(response);
  } catch (error) {
    await failCronRun(cronRun, error);
    logServerError(error, { source: "cron_case_auto_close" });
    return NextResponse.json({ error: "Internal server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
  });
}
