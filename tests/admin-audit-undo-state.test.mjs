import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  adminUndoActorBlockReason,
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
});
