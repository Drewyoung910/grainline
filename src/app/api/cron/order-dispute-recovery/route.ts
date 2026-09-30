import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import {
  beginCronRun,
  completeCronRun,
  failCronRun,
  skippedCronRunResponse,
} from "@/lib/cronRun";
import { processOrderDisputeRecoveryBatch } from "@/lib/orderDisputeRecoveryRetry";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

function halfHourBucket(date = new Date()) {
  const minute = date.getUTCMinutes() < 30 ? "05" : "35";
  return `${date.toISOString().slice(0, 14)}${minute}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: HTTP_STATUS.UNAUTHORIZED },
    );
  }

  return withSentryCronMonitor(
    "order-dispute-recovery",
    { value: "5,35 * * * *", maxRuntimeMinutes: 1 },
    async () => {
      const cronRun = await beginCronRun(
        "order-dispute-recovery",
        halfHourBucket(),
      );
      if (!cronRun.acquired) {
        return NextResponse.json(skippedCronRunResponse(cronRun));
      }

      try {
        const result = await processOrderDisputeRecoveryBatch({ take: 10 });
        await completeCronRun(cronRun, result);
        return NextResponse.json(result);
      } catch (error) {
        await failCronRun(cronRun, error);
        Sentry.captureException(error, {
          tags: { source: "cron_order_dispute_recovery" },
        });
        return NextResponse.json(
          { error: "Order dispute recovery failed" },
          { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
        );
      }
    },
  );
}
