import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { inactiveAdminEmailRecipientReason } = await import("../src/lib/adminEmailRecipient.ts");

describe("admin email recipient state", () => {
  it("allows unknown or active accounts", () => {
    assert.equal(inactiveAdminEmailRecipientReason(null), null);
    assert.equal(inactiveAdminEmailRecipientReason({ banned: false, deletedAt: null }), null);
  });

  it("blocks banned and deleted accounts", () => {
    assert.match(inactiveAdminEmailRecipientReason({ banned: true, deletedAt: null }), /banned/);
    assert.match(
      inactiveAdminEmailRecipientReason({ banned: false, deletedAt: new Date("2026-04-30T00:00:00.000Z") }),
      /deleted/,
    );
  });
});
