// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const gate = readFileSync("src/lib/notificationRlsProviderGate.ts", "utf8");
const route = readFileSync("src/app/api/internal/rls-context-gate/route.ts", "utf8");

describe("temporary real Notification provider gate", () => {
  it("uses the real recipient application helpers and real service wrapper", () => {
    for (const helper of [
      "countUnreadOwnerNotifications",
      "findRecentOwnerLowStockNotification",
      "markOwnerMessageNotificationsRead",
      "markOwnerNotificationRead",
      "markOwnerNotificationsRead",
      "ownerNotificationBellData",
      "ownerNotificationExportRows",
      "ownerNotificationPageData",
    ]) {
      assert.match(gate, new RegExp(`\\b${helper}\\b`));
    }
    assert.match(gate, /grainline_notification_create_social_event/);
    assert.match(gate, /notification_social_source_target/);
    assert.match(gate, /serviceReplayId/);
    assert.match(gate, /let serviceReplayStable = true/);
    assert.match(gate, /serviceReplayStable = false/);
    assert.doesNotMatch(gate, /serviceReplayStable:\s*true/);
  });

  it("compares the one-statement RPC with a true one-statement RLS baseline", () => {
    assert.match(gate, /WITH context AS MATERIALIZED/);
    assert.match(gate, /set_config\('app\.user_id'/);
    assert.match(gate, /notification_bell_target/);
    assert.match(gate, /notification_bell_burst/);
    assert.match(gate, /candidate\[metric\] > baseline\[metric\] \* 2/);
    assert.match(gate, /candidate\.p95Ms > 250/);
    assert.match(gate, /config\.runSlot === 1/);
    assert.match(gate, /Math\.max\(config\.warmupRequests, concurrency \* 2\)/);
    assert.match(gate, /concurrency prime had request errors/);
    const pair = gate.slice(
      gate.indexOf("async function measurePair"),
      gate.indexOf("export function parseNotificationProviderGateConfig"),
    );
    assert.ok(pair.indexOf('await prime("baseline", baseline)') >= 0);
    assert.ok(
      pair.indexOf("const baselineResult = await baselineWork()")
        > pair.indexOf('await prime("baseline", baseline)'),
    );
    assert.ok(pair.indexOf('await prime("candidate", candidate)') >= 0);
    assert.ok(
      pair.indexOf("const candidateResult = await candidateWork()")
        > pair.indexOf('await prime("candidate", candidate)'),
    );
  });

  it("checks catalog, recipient shape, foreign denial, and context reset", () => {
    assert.match(gate, /CURRENT_USER AS "currentUser"/);
    assert.doesNotMatch(gate, /pg_catalog\.current_user/);
    assert.match(gate, /SELECT EXISTS \(/);
    assert.doesNotMatch(gate, /pg_catalog\.exists/);
    assert.match(gate, /currentUser !== "grainline_app_runtime"/);
    assert.match(gate, /catalog\[0\]\.rls !== true/);
    assert.match(gate, /catalog\[0\]\.forceRls !== false/);
    assert.match(gate, /bell RPC returned the wrong recipient data shape/);
    assert.match(gate, /mark-one RPC crossed recipient ownership/);
    assert.match(gate, /provider recipient context leaked beyond one statement/);
  });

  it("takes no caller-controlled fixture identity and emits only sanitized failures", () => {
    assert.match(route, /runSlot: z\.union/);
    assert.match(route, /token: z\.string/);
    assert.doesNotMatch(route, /userId: z\.|notificationId: z\.|sellerProfileId: z\./);
    assert.match(route, /failed before sanitized evidence was available/);
    assert.match(route, /stage: failureStage/);
    assert.match(
      route,
      /"configuration" \| "claim" \| "notification_gate" \| "completion"/,
    );
    assert.doesNotMatch(route, /error\?\.message|error\.message|detail:/);
    assert.match(route, /acceptanceEligible: false/);
  });
});
