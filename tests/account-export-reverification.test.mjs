import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ACCOUNT_EXPORT_REVERIFICATION,
  hasFreshAccountExportSession,
} = await import("../src/lib/accountExportReverification.ts");

describe("account export reverification state", () => {
  it("requires a recent first-factor verification", () => {
    assert.deepEqual(ACCOUNT_EXPORT_REVERIFICATION, {
      level: "first_factor",
      afterMinutes: 10,
    });

    assert.equal(hasFreshAccountExportSession([0, -1]), true);
    assert.equal(hasFreshAccountExportSession([9, -1]), true);
    assert.equal(hasFreshAccountExportSession([10, -1]), false);
    assert.equal(hasFreshAccountExportSession([-1, 0]), false);
    assert.equal(hasFreshAccountExportSession([-1, -1]), false);
    assert.equal(hasFreshAccountExportSession(null), false);
  });

  it("rejects malformed factor-age claims", () => {
    assert.equal(hasFreshAccountExportSession([Number.NaN, -1]), false);
    assert.equal(hasFreshAccountExportSession([0, Number.NaN]), false);
    assert.equal(hasFreshAccountExportSession([0]), false);
    assert.equal(hasFreshAccountExportSession([0, -1, 0]), false);
  });
});
