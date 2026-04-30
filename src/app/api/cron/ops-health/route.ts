import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILED_CRON_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_EMAIL_OUTBOX_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("ops-health", { value: "20 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("ops-health");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const now = new Date();
      const failedCronSince = new Date(now.getTime() - FAILED_CRON_LOOKBACK_MS);
      const staleEmailBefore = new Date(now.getTime() - STALE_EMAIL_OUTBOX_MS);

      const [failedCronRuns, staleEmailOutboxCount, overdueSupportRequestCount] = await Promise.all([
        prisma.cronRun.findMany({
          where: {
            status: "FAILED",
            startedAt: { gte: failedCronSince },
            jobName: { not: "ops-health" },
          },
          orderBy: { startedAt: "desc" },
          take: 25,
          select: { id: true, jobName: true, bucket: true, startedAt: true },
        }),
        prisma.emailOutbox.count({
          where: {
            status: { in: ["PENDING", "PROCESSING"] },
            nextAttemptAt: { lt: staleEmailBefore },
          },
        }),
        prisma.supportRequest.count({
          where: {
            status: { in: ["OPEN", "IN_PROGRESS"] },
            slaDueAt: { lt: now },
          },
        }),
      ]);

      const issues = {
        failedCronRunCount: failedCronRuns.length,
        staleEmailOutboxCount,
        overdueSupportRequestCount,
      };

      if (
        issues.failedCronRunCount > 0 ||
        issues.staleEmailOutboxCount > 0 ||
        issues.overdueSupportRequestCount > 0
      ) {
        Sentry.captureMessage("Ops health check found actionable issues", {
          level: "warning",
          tags: { source: "cron_ops_health" },
          extra: {
            ...issues,
            failedCronRuns: failedCronRuns.map((run) => ({
              id: run.id,
              jobName: run.jobName,
              bucket: run.bucket,
              startedAt: run.startedAt.toISOString(),
            })),
          },
        });
      }

      const response = { ok: Object.values(issues).every((count) => count === 0), ...issues };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_ops_health" } });
      return NextResponse.json({ error: "Ops health check failed" }, { status: 500 });
    }
  });
}
