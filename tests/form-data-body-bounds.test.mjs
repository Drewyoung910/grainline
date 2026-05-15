import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("form-data body bounds", () => {
  it("bounds multipart image uploads before parsing form data", () => {
    const route = source("src/app/api/upload/image/route.ts");
    assert.match(route, /IMAGE_UPLOAD_MULTIPART_BODY_MAX_BYTES = 12 \* 1024 \* 1024/);
    assert.match(route, /assertContentLengthUnder\(req, IMAGE_UPLOAD_MULTIPART_BODY_MAX_BYTES\)/);
    assert.match(route, /await req\.formData\(\)/);
    assert.match(route, /isRequestBodyTooLargeError/);
    assert.match(route, /status: 413/);
    assert.ok(
      route.indexOf("assertContentLengthUnder(req, IMAGE_UPLOAD_MULTIPART_BODY_MAX_BYTES)") <
        route.indexOf("await req.formData()"),
    );
  });

  it("bounds order fulfillment and unsubscribe form fallbacks before formData parsing", () => {
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const unsubscribe = source("src/app/api/email/unsubscribe/route.ts");

    assert.match(fulfillment, /assertContentLengthUnder\(req, FULFILLMENT_FORM_BODY_MAX_BYTES\)/);
    assert.ok(
      fulfillment.indexOf("assertContentLengthUnder(req, FULFILLMENT_FORM_BODY_MAX_BYTES)") <
        fulfillment.indexOf("await req.formData()"),
    );

    assert.match(unsubscribe, /assertContentLengthUnder\(req, UNSUBSCRIBE_FORM_BODY_MAX_BYTES\)/);
    assert.ok(
      unsubscribe.indexOf("assertContentLengthUnder(req, UNSUBSCRIBE_FORM_BODY_MAX_BYTES)") <
        unsubscribe.indexOf("await req.formData()"),
    );
  });
});
