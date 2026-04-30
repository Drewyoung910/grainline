import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { cronMonitorStatusForHttpStatus } = await import("../src/lib/cronMonitorState.ts");

describe("cron monitor state", () => {
  it("treats 5xx cron responses as failed check-ins", () => {
    assert.equal(cronMonitorStatusForHttpStatus(200), "ok");
    assert.equal(cronMonitorStatusForHttpStatus(409), "ok");
    assert.equal(cronMonitorStatusForHttpStatus(500), "error");
    assert.equal(cronMonitorStatusForHttpStatus(503), "error");
  });
});
