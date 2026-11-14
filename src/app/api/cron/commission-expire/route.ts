import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { mapWithConcurrency } from "@/lib/concurrency";
import { truncateText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";
import {
  expireCommissionRequestBatch,
  expiredCommissionRequestCount,
} from "@/lib/commissionRequestAccess";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMISSION_EXPIRE_BATCH_SIZE = 200;
const COMMISSION_EXPIRE_MAX_BATCHES = 5;
const COMMISSION_EXPIRE_REQUEST_CONCURRENCY = 5;

function cronErrorCode(error: unknown) {
  const err = error as { code?: string; name?: string };
  return err.code ?? err.name ?? "UNKNOWN";
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("commission-expire", { value: "40 9 * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("commission-expire");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      let expired = 0;
      let checked = 0;
      let batches = 0;
      let lastBatchFull = false;
      const failures: Array<{ requestId: string; code: string }> = [];

      for (let batch = 0; batch < COMMISSION_EXPIRE_MAX_BATCHES; batch += 1) {
        const expiring = await expireCommissionRequestBatch(COMMISSION_EXPIRE_BATCH_SIZE);
        if (expiring.length === 0) {
          lastBatchFull = false;
          break;
        }

        batches += 1;
        checked += expiring.length;
        expired += expiring.length;
        lastBatchFull = expiring.length === COMMISSION_EXPIRE_BATCH_SIZE;

        await mapWithConcurrency(expiring, COMMISSION_EXPIRE_REQUEST_CONCURRENCY, async (request) => {
          try {
            const title = truncateText(request.title, 80);
            await createNotification({
              userId: request.buyerUserId,
              type: "COMMISSION_INTEREST",
              title: "Commission request expired",
              body: `"${title}" is now closed to new maker interest.`,
              link: `/commission/${request.requestId}`,
              dedupScope: request.requestId,
              sourceType: NOTIFICATION_SOURCE_TYPES.COMMISSION_REQUEST,
              sourceId: request.requestId,
            });
            await mapWithConcurrency(request.sellerUserIds, 10, (userId) =>
              createNotification({
                userId,
                type: "COMMISSION_INTEREST",
                title: "Commission request expired",
                body: `"${title}" is no longer accepting interest.`,
                link: `/commission/${request.requestId}`,
                dedupScope: request.requestId,
                relatedUserId: request.buyerUserId,
                sourceType: NOTIFICATION_SOURCE_TYPES.COMMISSION_REQUEST,
                sourceId: request.requestId,
              }),
            );
          } catch (error) {
            const code = cronErrorCode(error);
            failures.push({ requestId: request.requestId, code });
            Sentry.captureException(error, {
              tags: { source: "cron_commission_expire_record", code },
              extra: { requestId: request.requestId },
            });
          }
        });

        if (!lastBatchFull) {
          break;
        }
      }

      const remainingOpenExpired = lastBatchFull
        ? await expiredCommissionRequestCount()
        : 0;
      const hasMore = remainingOpenExpired > 0;

      const response = { ok: true, expired, checked, batches, hasMore, failures };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      logServerError(error, { source: "cron_commission_expire" });
      return NextResponse.json({ error: "Internal server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
