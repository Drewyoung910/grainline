import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import {
  beginCronRun,
  completeCronRun,
  failCronRun,
  skippedCronRunResponse,
} from "@/lib/cronRun";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";
import {
  runCaseCronTransitionBatch,
  type CaseCronTransitionResult,
} from "@/lib/caseCronTransitionAuthority";

export const runtime = "nodejs";
export const maxDuration = 60;
const CASE_AUTO_CLOSE_BATCH_SIZE = 100;
const CASE_AUTO_CLOSE_MAX_BATCHES = 5;
const CASE_AUTO_CLOSE_REPLAY_CONCURRENCY = 5;

async function replayPendingCloseNotifications(
  row: CaseCronTransitionResult,
) {
  const notifications: Array<() => Promise<unknown>> = [];
  if (row.buyerUserId) {
    notifications.push(() => createNotification({
      userId: row.buyerUserId!,
      type: "CASE_RESOLVED",
      title: "Case closed",
      body:
        "This case was closed automatically after the resolution window expired.",
      link: `/dashboard/orders/${row.orderId}`,
      dedupScope: row.caseId,
      sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
      sourceId: row.auditLogId,
    }));
  }
  notifications.push(() => createNotification({
    userId: row.sellerUserId,
    type: "CASE_RESOLVED",
    title: "Case closed",
    body:
      "This case was closed automatically after the resolution window expired.",
    link: `/dashboard/sales/${row.orderId}`,
    dedupScope: row.caseId,
    sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
    sourceId: row.auditLogId,
  }));
  await mapWithConcurrency(notifications, 2, (send) => send());
}

async function replayOpenEscalationNotifications(
  row: CaseCronTransitionResult,
) {
  const notifications: Array<() => Promise<unknown>> = [];
  if (row.buyerUserId) {
    notifications.push(() => createNotification({
      userId: row.buyerUserId!,
      type: "CASE_MESSAGE",
      title: "Case under review",
      body:
        "The seller did not respond in time, so Grainline staff will review this case.",
      link: `/dashboard/orders/${row.orderId}`,
      dedupScope: row.caseId,
      sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
      sourceId: row.auditLogId,
    }));
  }
  notifications.push(() => createNotification({
    userId: row.sellerUserId,
    type: "CASE_MESSAGE",
    title: "Case escalated",
    body:
      "This case was escalated to Grainline staff because the response window expired.",
    link: `/dashboard/sales/${row.orderId}`,
    dedupScope: row.caseId,
    sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
    sourceId: row.auditLogId,
  }));
  await mapWithConcurrency(notifications, 2, (send) => send());
}

async function replayStaleDiscussionNotifications(
  row: CaseCronTransitionResult,
) {
  const notifications: Array<() => Promise<unknown>> = [];
  if (row.buyerUserId) {
    notifications.push(() => createNotification({
      userId: row.buyerUserId!,
      type: "CASE_MESSAGE",
      title: "Case under review",
      body: "This case has been inactive, so Grainline staff will review it.",
      link: `/dashboard/orders/${row.orderId}`,
      dedupScope: row.caseId,
      sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
      sourceId: row.auditLogId,
    }));
  }
  notifications.push(() => createNotification({
    userId: row.sellerUserId,
    type: "CASE_MESSAGE",
    title: "Case escalated",
    body:
      "This case was escalated to Grainline staff after the discussion stalled.",
    link: `/dashboard/sales/${row.orderId}`,
    dedupScope: row.caseId,
    sourceType: NOTIFICATION_SOURCE_TYPES.CASE_SYSTEM_ACTION,
    sourceId: row.auditLogId,
  }));
  await mapWithConcurrency(notifications, 2, (send) => send());
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: HTTP_STATUS.UNAUTHORIZED },
    );
  }

  return withSentryCronMonitor(
    "case-auto-close",
    { value: "10 8 * * *", maxRuntimeMinutes: 1 },
    async () => {
      const cronRun = await beginCronRun("case-auto-close");
      if (!cronRun.acquired) {
        return NextResponse.json(skippedCronRunResponse(cronRun));
      }

      try {
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

        for (
          let batch = 0;
          batch < CASE_AUTO_CLOSE_MAX_BATCHES;
          batch++
        ) {
          const rows = await runCaseCronTransitionBatch({
            family: "PENDING_CLOSE_EXPIRED",
            limit: CASE_AUTO_CLOSE_BATCH_SIZE,
          });
          if (rows.length === 0) break;
          stalePendingCloseBatches++;
          stalePendingClose += rows.length;
          stalePendingClosed += rows.length;
          closed += rows.length;
          await mapWithConcurrency(
            rows,
            CASE_AUTO_CLOSE_REPLAY_CONCURRENCY,
            replayPendingCloseNotifications,
          );
          if (rows.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
          if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) {
            stalePendingCloseHasMore = true;
          }
        }

        for (
          let batch = 0;
          batch < CASE_AUTO_CLOSE_MAX_BATCHES;
          batch++
        ) {
          const rows = await runCaseCronTransitionBatch({
            family: "OPEN_RESPONSE_DUE",
            limit: CASE_AUTO_CLOSE_BATCH_SIZE,
          });
          if (rows.length === 0) break;
          abandonedOpenBatches++;
          abandonedOpen += rows.length;
          abandonedEscalated += rows.length;
          closed += rows.length;
          await mapWithConcurrency(
            rows,
            CASE_AUTO_CLOSE_REPLAY_CONCURRENCY,
            replayOpenEscalationNotifications,
          );
          if (rows.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
          if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) {
            abandonedOpenHasMore = true;
          }
        }

        for (
          let batch = 0;
          batch < CASE_AUTO_CLOSE_MAX_BATCHES;
          batch++
        ) {
          const rows = await runCaseCronTransitionBatch({
            family: "STALE_DISCUSSION",
            limit: CASE_AUTO_CLOSE_BATCH_SIZE,
          });
          if (rows.length === 0) break;
          staleDiscussionBatches++;
          staleDiscussion += rows.length;
          staleDiscussionEscalated += rows.length;
          closed += rows.length;
          await mapWithConcurrency(
            rows,
            CASE_AUTO_CLOSE_REPLAY_CONCURRENCY,
            replayStaleDiscussionNotifications,
          );
          if (rows.length < CASE_AUTO_CLOSE_BATCH_SIZE) break;
          if (batch === CASE_AUTO_CLOSE_MAX_BATCHES - 1) {
            staleDiscussionHasMore = true;
          }
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
          failures: [],
        };
        await completeCronRun(cronRun, response);
        return NextResponse.json(response);
      } catch (error) {
        await failCronRun(cronRun, error);
        logServerError(error, { source: "cron_case_auto_close" });
        return NextResponse.json(
          { error: "Internal server error" },
          { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
        );
      }
    },
  );
}
