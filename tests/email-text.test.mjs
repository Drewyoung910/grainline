import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { decodeHtmlEntities, htmlToText } = await import("../src/lib/emailText.ts");

describe("email text rendering", () => {
  it("decodes named and numeric HTML entities", () => {
    assert.equal(
      decodeHtmlEntities("Fish &amp; Chips &quot;shop&quot; &#169; &#x1F600; &nbsp;&hellip;"),
      'Fish & Chips "shop" © 😀  ...',
    );
  });

  it("keeps plain-text output aligned with rendered HTML content", () => {
    const text = htmlToText("<h1>Order &amp; Shipping</h1><p>Use code &quot;A&#x31;&quot;&nbsp;&hellip;</p>");
    assert.equal(text, 'Order & Shipping\nUse code "A1" ...');
  });
});
