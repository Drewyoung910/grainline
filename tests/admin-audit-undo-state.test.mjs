import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ADMIN_AUDIT_UNDO_WINDOW_HOURS,
  adminUndoActorBlockReason,
  adminUndoWindowBlockReason,
  canUndoAdminActionForActor,
} = await import("../src/lib/adminAuditUndoState.ts");

describe("admin audit undo actor policy", () => {
  it("blocks admins from undoing their own audit actions", () => {
    assert.equal(
      canUndoAdminActionForActor({ actionAdminId: "admin_1", actingAdminId: "admin_1" }),
      false,
    );
    assert.equal(
      adminUndoActorBlockReason({ actionAdminId: "admin_1", actingAdminId: "admin_1" }),
      "Admins cannot undo their own actions",
    );
  });

  it("allows a different admin to undo an eligible action", () => {
    assert.equal(
      canUndoAdminActionForActor({ actionAdminId: "admin_1", actingAdminId: "admin_2" }),
      true,
    );
    assert.equal(
      adminUndoActorBlockReason({ actionAdminId: "admin_1", actingAdminId: "admin_2" }),
      null,
    );
  });

  it("blocks undo after the documented 24-hour window", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");

    assert.equal(ADMIN_AUDIT_UNDO_WINDOW_HOURS, 24);
    assert.equal(
      adminUndoWindowBlockReason({
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        now,
      }),
      null,
    );
    assert.equal(
      adminUndoWindowBlockReason({
        createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
        now,
      }),
      "Undo window expired (24 hours)",
    );
  });
});
