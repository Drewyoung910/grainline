import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CronRunHandle =
  | { acquired: true; runId: string; jobName: string; bucket: string }
  | { acquired: false; runId: string; jobName: string; bucket: string };

export function cronUtcHourBucket(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

export async function beginCronRun(jobName: string, bucket = cronUtcHourBucket()): Promise<CronRunHandle> {
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
  await prisma.cronRun.update({
    where: { id: handle.runId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      result: {
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
      },
    },
  }).catch(() => {});
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
