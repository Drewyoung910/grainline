import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  EXPECTED_NOTIFICATION_EMISSION_PATHS,
  evaluateNotificationActivationReadiness,
  notificationActivationReadiness,
} from "../scripts/notification-rls-activation-readiness.mjs";

describe("Notification RLS activation completeness gate", () => {
  it("inventories all emission paths and reaches exact creation-authority coverage", () => {
    const result = notificationActivationReadiness();

    assert.equal(result.expectedCount, 54);
    assert.equal(result.totalCount, 54);
    assert.equal(result.coveredCount, 54);
    assert.equal(result.uncoveredCount, 0);
    assert.equal(result.unresolvedCalls.length, 0);
    assert.equal(result.ready, true);
    assert.deepEqual(result.uncovered, []);
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

  it("stays blocked when application dispatch exists but its SQL wrapper is absent", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notification-readiness-"));
    const authoritySql = fs.readFileSync(
      "docs/rls-drafts/notification-service-authority.sql",
      "utf8",
    );
    const authoritySqlPath = path.join(tempRoot, "authority.sql");
    fs.writeFileSync(
      authoritySqlPath,
      authoritySql.replaceAll(
        "grainline_notification_create_order_event",
        "grainline_notification_create_order_event_missing",
      ),
    );

    try {
      const result = notificationActivationReadiness({ authoritySqlPath });
      const uncoveredOrderPaths = result.uncovered.filter(
        (emission) => emission.authorityFunction === "grainline_notification_create_order_event",
      );

      assert.equal(result.ready, false);
      assert.equal(uncoveredOrderPaths.length, 9);
      assert.ok(uncoveredOrderPaths.every((emission) => emission.hasServiceDispatch));
      assert.ok(uncoveredOrderPaths.every((emission) => !emission.hasSqlAuthority));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("exits zero only for the exact reviewed 54-path contract", () => {
    const result = spawnSync(process.execPath, ["scripts/notification-rls-activation-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /"ready": true/);
    assert.match(result.stdout, /"coveredCount": 54/);
    assert.match(result.stdout, /"uncoveredCount": 0/);
  });
});
