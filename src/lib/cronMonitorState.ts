export type CronMonitorCheckInStatus = "ok" | "error";

export function cronMonitorStatusForHttpStatus(status: number): CronMonitorCheckInStatus {
  return Number.isFinite(status) && status >= 500 ? "error" : "ok";
}
