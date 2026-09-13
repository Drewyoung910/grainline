import * as Sentry from "@sentry/nextjs";
import { cronMonitorStatusForHttpStatus } from "@/lib/cronMonitorState";

type CrontabSchedule = {
  value: string;
  maxRuntimeMinutes: number;
};

export async function withSentryCronMonitor<T extends Response>(
  monitorSlug: string,
  schedule: CrontabSchedule,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const monitorConfig = {
    schedule: { type: "crontab" as const, value: schedule.value },
    checkinMargin: 5,
    maxRuntime: schedule.maxRuntimeMinutes,
    timezone: "Etc/UTC",
    failureIssueThreshold: 1,
    recoveryThreshold: 1,
    isolateTrace: true,
  };
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug, status: "in_progress" },
    monitorConfig,
  );

  try {
    const response = await run();
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug,
      status: cronMonitorStatusForHttpStatus(response.status),
      duration: (Date.now() - startedAt) / 1000,
    });
    return response;
  } catch (error) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug,
      status: "error",
      duration: (Date.now() - startedAt) / 1000,
    });
    throw error;
  }
}
