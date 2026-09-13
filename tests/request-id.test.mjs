import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  REQUEST_ID_HEADER,
  normalizeRequestId,
  requestHeadersWithRequestId,
} = await import("../src/lib/requestId.ts");

describe("request id helpers", () => {
  it("preserves safe incoming request ids", () => {
    assert.equal(normalizeRequestId(" req_abc-123:456 ", () => "generated"), "req_abc-123:456");
  });

  it("generates an id when incoming values are missing or unsafe", () => {
    assert.equal(normalizeRequestId(null, () => "generated"), "generated");
    assert.equal(normalizeRequestId("short", () => "generated"), "generated");
    assert.equal(normalizeRequestId("bad header", () => "generated"), "generated");
    assert.equal(normalizeRequestId("x".repeat(129), () => "generated"), "generated");
  });

  it("adds the request id to downstream request headers", () => {
    const headers = requestHeadersWithRequestId(new Headers({ accept: "application/json" }), "req_12345678");

    assert.equal(headers.get(REQUEST_ID_HEADER), "req_12345678");
    assert.equal(headers.get("accept"), "application/json");
  });
});
