import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  EXPECTED_NOTIFICATION_EMISSION_PATHS,
  evaluateNotificationActivationReadiness,
  notificationActivationReadiness,
} from "../scripts/notification-rls-activation-readiness.mjs";

describe("Notification RLS activation completeness gate", () => {
  it("inventories all emission paths and reports the exact current fail-closed gap", () => {
    const result = notificationActivationReadiness();

    assert.equal(result.expectedCount, 54);
    assert.equal(result.totalCount, 54);
    assert.equal(result.coveredCount, 29);
    assert.equal(result.uncoveredCount, 25);
    assert.equal(result.unresolvedCalls.length, 0);
    assert.equal(result.ready, false);
    assert.equal(result.uncovered.every((path) => path.hasSourcePair === false), true);
  });

  it("cannot become ready through count drift or an unreviewed source constant", () => {
    const reviewed = Array.from({ length: EXPECTED_NOTIFICATION_EMISSION_PATHS }, (_, index) => ({
      id: `fixture:${index}`,
      hasSourcePair: true,
      reviewedFamily: true,
    }));

    assert.equal(evaluateNotificationActivationReadiness({ emissions: reviewed }).ready, true);
    assert.equal(evaluateNotificationActivationReadiness({ emissions: reviewed.slice(1) }).ready, false);
    assert.equal(evaluateNotificationActivationReadiness({
      emissions: reviewed.map((emission, index) => index === 0
        ? { ...emission, reviewedFamily: false }
        : emission),
    }).ready, false);
    assert.equal(evaluateNotificationActivationReadiness({
      emissions: reviewed,
      unresolvedCalls: ["fixture:dynamic-call"],
    }).ready, false);
  });

  it("exits nonzero while any production emission path lacks reviewed authority", () => {
    const result = spawnSync(process.execPath, ["scripts/notification-rls-activation-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Notification RLS activation blocked: 29\/54/);
    assert.match(result.stdout, /"uncoveredCount": 25/);
  });
});
