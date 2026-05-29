import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  isSupportRequestStatus,
  supportRequestStatusTransition,
} = await import("../src/lib/supportRequestState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("support request state transitions", () => {
  it("accepts only known support request statuses", () => {
    assert.equal(isSupportRequestStatus("OPEN"), true);
    assert.equal(isSupportRequestStatus("IN_PROGRESS"), true);
    assert.equal(isSupportRequestStatus("CLOSED"), true);
    assert.equal(isSupportRequestStatus("RESOLVED"), false);
  });

  it("preserves closedAt and blocks reopening closed support requests", () => {
    const closedAt = new Date("2026-05-01T00:00:00.000Z");

    assert.deepEqual(
      supportRequestStatusTransition({ status: "CLOSED", closedAt }, "OPEN"),
      { ok: false, reason: "closed_terminal" },
    );
    assert.deepEqual(
      supportRequestStatusTransition({ status: "CLOSED", closedAt }, "IN_PROGRESS"),
      { ok: false, reason: "closed_terminal" },
    );

    const sameClosed = supportRequestStatusTransition({ status: "CLOSED", closedAt }, "CLOSED");
    assert.equal(sameClosed.ok, true);
    assert.equal(sameClosed.ok && sameClosed.data.closedAt, closedAt);
  });

  it("records previous and new status metadata for audit history", () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const transition = supportRequestStatusTransition({ status: "IN_PROGRESS", closedAt: null }, "CLOSED", now);

    assert.deepEqual(transition, {
      ok: true,
      data: { status: "CLOSED", closedAt: now },
      metadata: {
        previousStatus: "IN_PROGRESS",
        status: "CLOSED",
        previousClosedAt: null,
        closedAt: "2026-05-02T00:00:00.000Z",
      },
    });
  });

  it("wires the transition helper into the admin support action and UI", () => {
    const actions = source("src/app/admin/support/actions.ts");
    const page = source("src/app/admin/support/page.tsx");

    assert.match(actions, /select: \{ status: true, closedAt: true \}/);
    assert.match(actions, /supportRequestStatusTransition\(current, status\)/);
    assert.match(actions, /metadata: transition\.metadata/);
    assert.doesNotMatch(actions, /metadata:\s*\{\s*status\s*\}/);
    assert.match(page, /request\.status === "OPEN"[\s\S]*In progress/);
    assert.match(page, /request\.status === "IN_PROGRESS"[\s\S]*Reopen/);
  });
});
