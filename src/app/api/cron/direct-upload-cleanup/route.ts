import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { processExpiredDirectUploadBatch } from "@/lib/directUploadLifecycle";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("direct-upload-cleanup", { value: "50 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("direct-upload-cleanup");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await processExpiredDirectUploadBatch();
      await completeCronRun(cronRun, result);
      return NextResponse.json(result);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_direct_upload_cleanup" } });
      return NextResponse.json(
        { error: "Direct upload cleanup failed" },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
      );
    }
  });
}
