// src/app/api/cron/quality-score/route.ts
//
// Daily cron job to recalculate listing quality scores.
// Schedule: 0 6 * * * (6am UTC daily)

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { recalculateAllQualityScores } from "@/lib/quality-score";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("quality-score", { value: "0 6 * * *", maxRuntimeMinutes: 5 }, async () => {
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
      console.error("[quality-score cron] Error:", error);
      Sentry.captureException(error, { tags: { source: "cron_quality_score" } });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
