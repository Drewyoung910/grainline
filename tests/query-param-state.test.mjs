import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  parseBoundedPositiveIntParam,
  parseTimestampMsParam,
} = await import("../src/lib/queryParams.ts");

describe("query parameter parsing helpers", () => {
  it("parses bounded positive integers without accepting malformed numbers", () => {
    assert.equal(parseBoundedPositiveIntParam("25", 10, 50), 25);
    assert.equal(parseBoundedPositiveIntParam("5000", 10, 50), 50);
    assert.equal(parseBoundedPositiveIntParam("0", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("-1", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("12abc", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam("1.5", 10, 50), 10);
    assert.equal(parseBoundedPositiveIntParam(null, 10, 50), 10);
  });

  it("accepts only finite valid millisecond timestamps", () => {
    assert.equal(parseTimestampMsParam("0"), 0);
    assert.equal(parseTimestampMsParam("1710000000000"), 1710000000000);
    assert.equal(parseTimestampMsParam(""), null);
    assert.equal(parseTimestampMsParam("-1"), null);
    assert.equal(parseTimestampMsParam("abc"), null);
    assert.equal(parseTimestampMsParam("Infinity"), null);
    assert.equal(parseTimestampMsParam("1e309"), null);
    assert.equal(parseTimestampMsParam("999999999999999999999"), null);
  });
});
