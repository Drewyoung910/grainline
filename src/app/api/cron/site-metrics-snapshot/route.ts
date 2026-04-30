import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { calculateSiteMetricsSnapshot } from "@/lib/site-metrics-snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("site-metrics-snapshot", { value: "30 5 * * *", maxRuntimeMinutes: 5 }, async () => {
    const cronRun = await beginCronRun("site-metrics-snapshot");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const snapshot = await calculateSiteMetricsSnapshot();
      const response = {
        ok: true,
        avgConversion: snapshot.avgConversion,
        avgCtr: snapshot.avgCtr,
        avgRating: snapshot.avgRating,
        calculatedAt: snapshot.calculatedAt.toISOString(),
      };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_site_metrics_snapshot" } });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  });
}
