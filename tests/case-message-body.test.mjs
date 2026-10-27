import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CASE_MESSAGE_BODY_MAX_CODE_POINTS,
  CASE_MESSAGE_BODY_MAX_UTF8_BYTES,
  isStoredCaseMessageBody,
  normalizeCaseMessageBody,
} from "../src/lib/caseMessageBody.ts";

describe("Case-message stored text bounds", () => {
  it("accepts a sanitized body that exceeds 5,000 UTF-16 units but fits durable bounds", () => {
    const result = normalizeCaseMessageBody(
      `${"😀".repeat(900)}${"&".repeat(800)}`,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.body.length > CASE_MESSAGE_BODY_MAX_CODE_POINTS);
    assert.equal(isStoredCaseMessageBody(result.body), true);
  });

  it("rejects empty and post-sanitization oversized bodies before persistence", () => {
    assert.deepEqual(normalizeCaseMessageBody("<b></b>"), {
      ok: false,
      reason: "required",
    });
    assert.deepEqual(normalizeCaseMessageBody("😀".repeat(5_001)), {
      ok: false,
      reason: "too_long",
    });
    assert.deepEqual(normalizeCaseMessageBody("&".repeat(5_000)), {
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts the exact code-point and database-byte boundary", () => {
    const body = "😀".repeat(CASE_MESSAGE_BODY_MAX_CODE_POINTS);
    assert.equal(new TextEncoder().encode(body).byteLength, CASE_MESSAGE_BODY_MAX_UTF8_BYTES);
    assert.equal(isStoredCaseMessageBody(body), true);
  });
});
