import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeUsState } = await import("../src/lib/usStates.ts");

describe("US state normalization", () => {
  it("normalizes supported state codes and names", () => {
    assert.equal(normalizeUsState("ny"), "NY");
    assert.equal(normalizeUsState(" New York "), "NY");
    assert.equal(normalizeUsState("california"), "CA");
  });

  it("does not invent state codes for unknown regions", () => {
    assert.equal(normalizeUsState("Quebec"), "");
    assert.equal(normalizeUsState("District of Columbia"), "");
    assert.equal(normalizeUsState(""), "");
    assert.equal(normalizeUsState(null), "");
  });
});
