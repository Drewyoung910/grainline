// src/app/api/cron/quality-score/route.ts
//
// Daily cron job to recalculate listing quality scores.
// Schedule: 10 5 * * * (05:10 UTC daily)

import { NextResponse } from "next/server";
import { recalculateAllQualityScores } from "@/lib/quality-score";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("quality-score", { value: "10 5 * * *", maxRuntimeMinutes: 5 }, async () => {
    const cronRun = await beginCronRun("quality-score");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await recalculateAllQualityScores();
      const response = {
        ok: true,
        updated: result.updated,
        zeroed: result.zeroed,
      };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      logServerError(error, { source: "cron_quality_score" });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }
  });
}
