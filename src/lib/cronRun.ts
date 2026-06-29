import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import * as Sentry from "@sentry/nextjs";
import { cronRunErrorMessage, cronUtcHourBucket, shouldReclaimFailedCronRun } from "@/lib/cronRunState";

export type CronRunHandle =
  | { acquired: true; runId: string; jobName: string; bucket: string }
  | { acquired: false; runId: string; jobName: string; bucket: string };

const MAX_RECLAIM_RETRIES = 2;

export { CRON_RUN_FAILED_RECLAIM_MS, cronRunErrorMessage, cronUtcHourBucket, shouldReclaimFailedCronRun } from "@/lib/cronRunState";

export async function beginCronRun(
  jobName: string,
  bucket = cronUtcHourBucket(),
  reclaimRetries = 0,
): Promise<CronRunHandle> {
  const runId = `${jobName}:${bucket}`;
  try {
    await prisma.cronRun.create({
      data: {
        id: runId,
        jobName,
        bucket,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    return { acquired: true, runId, jobName, bucket };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.cronRun.findUnique({
        where: { id: runId },
        select: { status: true, startedAt: true },
      });
      if (shouldReclaimFailedCronRun(existing)) {
        const failedStartedAt = existing?.startedAt;
        if (!(failedStartedAt instanceof Date)) {
          return { acquired: false, runId, jobName, bucket };
        }
        if (reclaimRetries >= MAX_RECLAIM_RETRIES) {
          Sentry.captureMessage("Cron run reclaim retry limit reached", {
            level: "warning",
            tags: { source: "cron_run_reclaim", jobName },
            extra: { runId, bucket, reclaimRetries },
          });
          return { acquired: false, runId, jobName, bucket };
        }
        await prisma.cronRun.deleteMany({
          where: {
            id: runId,
            status: "FAILED",
            startedAt: failedStartedAt,
          },
        });
        return beginCronRun(jobName, bucket, reclaimRetries + 1);
      }
      return { acquired: false, runId, jobName, bucket };
    }
    throw error;
  }
}

export async function completeCronRun(
  handle: Extract<CronRunHandle, { acquired: true }>,
  result: Prisma.InputJsonValue,
) {
  await prisma.cronRun.update({
    where: { id: handle.runId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      result,
    },
  });
}

export async function failCronRun(
  handle: Extract<CronRunHandle, { acquired: true }>,
  error: unknown,
) {
  const errorMessage = cronRunErrorMessage(error);
  await prisma.cronRun.update({
    where: { id: handle.runId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      result: {
        error: errorMessage,
      },
    },
  }).catch((updateError) => {
    Sentry.captureException(updateError, {
      tags: { source: "cron_run_failure_update", jobName: handle.jobName },
      extra: { runId: handle.runId, originalError: errorMessage },
    });
  });
}

export function skippedCronRunResponse(handle: Extract<CronRunHandle, { acquired: false }>) {
  return {
    ok: true,
    skipped: true,
    reason: "cron_run_already_claimed",
    jobName: handle.jobName,
    runId: handle.runId,
    bucket: handle.bucket,
  };
}
