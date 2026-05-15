import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("signed webhook body bounds", () => {
  it("bounds Stripe snapshot and v2 webhook raw bodies before signature verification", () => {
    const legacy = source("src/app/api/stripe/webhook/route.ts");
    const v2 = source("src/app/api/stripe/webhook/v2/route.ts");

    for (const route of [legacy, v2]) {
      assert.match(route, /readBoundedText\(req, [A-Z0-9_]+_WEBHOOK_BODY_MAX_BYTES\)/);
      assert.match(route, /isRequestBodyTooLargeError/);
      assert.match(route, /Payload too large/);
      assert.doesNotMatch(route, /await req\.text\(\)/);
    }
    assert.ok(
      legacy.indexOf("readBoundedText(req, STRIPE_WEBHOOK_BODY_MAX_BYTES)") <
        legacy.indexOf("stripe.webhooks.constructEvent(body, signature, secret)"),
    );
    assert.ok(
      v2.indexOf("readBoundedText(req, STRIPE_V2_WEBHOOK_BODY_MAX_BYTES)") <
        v2.indexOf("stripe.parseEventNotification(body, signature, secret)"),
    );
  });

  it("bounds Clerk and Resend webhook raw bodies before vendor verification", () => {
    const clerk = source("src/app/api/clerk/webhook/route.ts");
    const resend = source("src/app/api/resend/webhook/route.ts");

    assert.match(clerk, /readBoundedText\(req, CLERK_WEBHOOK_BODY_MAX_BYTES\)/);
    assert.match(clerk, /isRequestBodyTooLargeError/);
    assert.match(clerk, /Payload too large/);
    assert.doesNotMatch(clerk, /await req\.text\(\)/);
    assert.ok(
      clerk.indexOf("readBoundedText(req, CLERK_WEBHOOK_BODY_MAX_BYTES)") <
        clerk.indexOf("wh.verify(body"),
    );

    assert.match(resend, /readBoundedText\(request, RESEND_WEBHOOK_BODY_MAX_BYTES\)/);
    assert.match(resend, /isRequestBodyTooLargeError/);
    assert.match(resend, /Payload too large/);
    assert.doesNotMatch(resend, /await request\.text\(\)/);
    assert.ok(
      resend.indexOf("readBoundedText(request, RESEND_WEBHOOK_BODY_MAX_BYTES)") <
        resend.indexOf("resend.webhooks.verify"),
    );
  });
});
