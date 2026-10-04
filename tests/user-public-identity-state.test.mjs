import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicActiveMemberCountFromRows } from "../src/lib/userPublicIdentityState.ts";

describe("User public identity state", () => {
  it("accepts one non-negative safe active-member count", () => {
    assert.equal(publicActiveMemberCountFromRows([{ value: 0n }]), 0);
    assert.equal(publicActiveMemberCountFromRows([{ value: 12n }]), 12);
  });

  it("rejects malformed or unsafe aggregate rows", () => {
    for (const rows of [
      [],
      [{ value: 1n }, { value: 2n }],
      [{ value: -1n }],
      [{ value: BigInt(Number.MAX_SAFE_INTEGER) + 1n }],
      [{ value: "12" }],
    ]) {
      assert.throws(() => publicActiveMemberCountFromRows(rows), /invalid/i);
    }
  });
});
