import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sanitizeShippoProviderErrorBody } = await import("../src/lib/shippoErrorSanitize.ts");

describe("Shippo provider error sanitization", () => {
  it("scrubs address fields from JSON provider errors", () => {
    const body = JSON.stringify({
      address_to: {
        name: "Drew Young",
        street1: "123 Main Street",
        city: "Austin",
        state: "TX",
        zip: "78731",
        phone: "512-555-1212",
      },
      messages: [{ text: "Invalid phone 512-555-1212 for 123 Main Street" }],
      code: "ADDRESS_VALIDATION_FAILED",
    });

    const sanitized = sanitizeShippoProviderErrorBody(body);

    assert.match(sanitized, /ADDRESS_VALIDATION_FAILED/);
    for (const leaked of ["Drew Young", "123 Main", "Austin", "78731", "512-555-1212"]) {
      assert.doesNotMatch(sanitized, new RegExp(leaked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("scrubs labelled address text from non-JSON provider errors", () => {
    const sanitized = sanitizeShippoProviderErrorBody(
      "street1: 123 Main Street, zip=78731, name=Drew Young, phone: 512-555-1212",
    );

    assert.doesNotMatch(sanitized, /123 Main/);
    assert.doesNotMatch(sanitized, /78731/);
    assert.doesNotMatch(sanitized, /Drew Young/);
    assert.doesNotMatch(sanitized, /512-555-1212/);
    assert.match(sanitized, /\[redacted\]/);
  });
});
