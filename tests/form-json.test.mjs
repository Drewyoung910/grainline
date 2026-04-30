import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { parseJsonArrayField, parseJsonObjectField } = await import("../src/lib/formJson.ts");

describe("form JSON helpers", () => {
  it("parses JSON array fields without trusting casts", () => {
    assert.deepEqual(parseJsonArrayField('["a",1,true]'), { ok: true, value: ["a", 1, true] });
    assert.deepEqual(parseJsonArrayField(""), { ok: true, value: [] });
    assert.deepEqual(parseJsonArrayField(null), { ok: true, value: [] });
  });

  it("reports malformed or wrong-shape array fields", () => {
    const malformed = parseJsonArrayField("[");
    assert.equal(malformed.ok, false);
    assert.match(malformed.error, /JSON|Expected|Unexpected/i);

    assert.deepEqual(parseJsonArrayField('{"a":1}'), { ok: false, error: "Expected JSON array" });
  });

  it("parses object fields for structured message bodies", () => {
    assert.deepEqual(parseJsonObjectField('{"description":"chair"}'), {
      ok: true,
      value: { description: "chair" },
    });
    assert.deepEqual(parseJsonObjectField("[]"), { ok: false, error: "Expected JSON object" });
    assert.deepEqual(parseJsonObjectField(null), { ok: true, value: null });
  });
});
