import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CASE_DESCRIPTION_BODY_MAX_CODE_POINTS,
  CASE_DESCRIPTION_BODY_MAX_UTF8_BYTES,
  normalizeCaseDescriptionBody,
} from "../src/lib/caseMessageBody.ts";

describe("Case-opening description durable text bounds", () => {
  it("counts the minimum in Unicode code points after sanitization", () => {
    assert.deepEqual(normalizeCaseDescriptionBody("😀".repeat(19)), {
      ok: false,
      reason: "too_short",
    });
    assert.equal(normalizeCaseDescriptionBody("😀".repeat(20)).ok, true);
  });

  it("rejects entity expansion before the fixed database authority", () => {
    assert.deepEqual(normalizeCaseDescriptionBody("&".repeat(2_000)), {
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts the exact code-point and database-byte boundary", () => {
    const body = "😀".repeat(CASE_DESCRIPTION_BODY_MAX_CODE_POINTS);
    const result = normalizeCaseDescriptionBody(body);
    assert.equal(new TextEncoder().encode(body).byteLength, CASE_DESCRIPTION_BODY_MAX_UTF8_BYTES);
    assert.deepEqual(result, { ok: true, body });
  });
});
