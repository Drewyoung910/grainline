import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const vercel = JSON.parse(source("vercel.json"));
const scheduleByPath = new Map(vercel.crons.map((cron) => [cron.path, cron.schedule]));

const lowFrequencyMaintenanceCrons = [
  "/api/cron/quality-score",
  "/api/cron/site-metrics-snapshot",
  "/api/cron/case-auto-close",
  "/api/cron/commission-expire",
  "/api/cron/notification-prune",
  "/api/cron/order-pii-prune",
  "/api/cron/guild-member-check",
  "/api/cron/guild-metrics",
];

function cronMinuteOfDay(schedule) {
  const [minute, hour] = schedule.split(" ");
  assert.match(minute, /^\d+$/, `expected a fixed minute in ${schedule}`);
  assert.match(hour, /^\d+$/, `expected a fixed hour in ${schedule}`);
  return Number(hour) * 60 + Number(minute);
}

describe("cron schedule guardrails", () => {
  it("keeps Vercel cron schedules aligned with Sentry cron monitor schedules", () => {
    for (const { path, schedule } of vercel.crons) {
      const jobName = path.split("/").at(-1);
      const route = source(`src/app${path}/route.ts`);
      const monitorPattern = new RegExp(
        `withSentryCronMonitor\\("${escapeRegExp(jobName)}", \\{ value: "${escapeRegExp(schedule)}"`,
      );

      assert.match(route, monitorPattern, `${path} should report the same cron schedule to Sentry`);
    }
  });

  it("keeps low-frequency maintenance crons spread across the UTC day", () => {
    const scheduled = lowFrequencyMaintenanceCrons
      .map((path) => {
        const schedule = scheduleByPath.get(path);
        assert.ok(schedule, `${path} must be registered in vercel.json`);
        return { path, minuteOfDay: cronMinuteOfDay(schedule) };
      })
      .sort((a, b) => a.minuteOfDay - b.minuteOfDay);

    for (let index = 0; index < scheduled.length; index += 1) {
      const current = scheduled[index];
      const next = scheduled[(index + 1) % scheduled.length];
      const nextMinute = index === scheduled.length - 1 ? next.minuteOfDay + 24 * 60 : next.minuteOfDay;
      const gapMinutes = nextMinute - current.minuteOfDay;

      assert.ok(
        gapMinutes >= 60,
        `${current.path} and ${next.path} should not run within ${gapMinutes} minutes of each other`,
      );
    }
  });
});
