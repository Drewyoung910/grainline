import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  normalizeSupportRequest,
  supportRequestHtml,
  supportRequestRecipient,
  supportRequestSlaDueAt,
  supportRequestStorageKind,
  supportRequestSubject,
} = await import("../src/lib/supportRequest.ts");

describe("support request helpers", () => {
  it("normalizes support requests before email delivery", () => {
    const result = normalizeSupportRequest("support", {
      name: " Alice ",
      email: "ALICE@example.com",
      topic: "order",
      message: "I need help with order 123.",
      orderId: "<ord_123>",
    });

    assert.equal(result.ok, true);
    assert.equal(result.request.email, "alice@example.com");
    assert.equal(result.request.name, "Alice");
    assert.equal(result.request.orderId, "ord_123");
    assert.equal(supportRequestStorageKind(result.request.kind), "SUPPORT");
  });

  it("rejects invalid or empty requests", () => {
    assert.deepEqual(
      normalizeSupportRequest("support", { email: "bad", topic: "bug", message: "hello there" }),
      { ok: false, error: "Enter a valid email address." },
    );
    assert.deepEqual(
      normalizeSupportRequest("support", { email: "a@example.com", topic: "bug", message: "short" }),
      { ok: false, error: "Add a few details so we can help." },
    );
  });

  it("routes data requests to legal and escapes email HTML", () => {
    const result = normalizeSupportRequest("data_request", {
      email: "person@example.com",
      topic: "delete",
      message: "Please delete <script>alert(1)</script> my data.",
    });

    assert.equal(result.ok, true);
    assert.equal(supportRequestRecipient(result.request.kind), "legal@thegrainline.com");
    assert.equal(supportRequestSubject(result.request), "Data request: delete");
    assert.match(supportRequestHtml(result.request), /Please delete\s+my data\./);
    assert.doesNotMatch(supportRequestHtml(result.request), /script|alert/i);
  });

  it("computes a 45-day SLA due date for verifiable data requests", () => {
    assert.equal(
      supportRequestSlaDueAt(new Date("2026-04-30T12:00:00.000Z")).toISOString(),
      "2026-06-14T12:00:00.000Z",
    );
  });
});
