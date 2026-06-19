import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { processLabelClawbackRetryBatch } from "@/lib/labelClawbackRetry";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

function halfHourBucket(date = new Date()) {
  const minute = date.getUTCMinutes() < 30 ? "00" : "30";
  return `${date.toISOString().slice(0, 14)}${minute}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("label-clawback-retry", { value: "*/30 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("label-clawback-retry", halfHourBucket());
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await processLabelClawbackRetryBatch({ take: 10 });
      await completeCronRun(cronRun, result);
      return NextResponse.json(result);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_label_clawback_retry" } });
      return NextResponse.json({ error: "Label clawback retry failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
