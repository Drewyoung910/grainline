import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../src/lib/supportRequest.ts", import.meta.url), "utf8");

describe("support request helpers", () => {
  it("normalizes support requests before email delivery", () => {
    assert.match(source, /function normalizeEmailAddress/);
    assert.match(source, /normalizeUserText\(email \?\? ""\)\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(source, /SUPPORT_EMAIL_PATTERN\.test\(normalized\)/);
    assert.match(source, /name: cleanOptionalText\(input\.name, 100\)/);
    assert.match(source, /orderId: cleanOptionalText\(input\.orderId, 80\)/);
    assert.match(source, /supportRequestStorageKind/);
  });

  it("rejects invalid or empty requests", () => {
    assert.match(source, /const SUPPORT_EMAIL_PATTERN = \/\^\[A-Z0-9\._%\+-\]\+\@\[A-Z0-9\.-\]\+\\\.\[A-Z\]\{2,\}\$\/i/);
    assert.match(source, /if \(!normalized \|\| !SUPPORT_EMAIL_PATTERN\.test\(normalized\)\) return null/);
    assert.match(source, /message\.length < 10/);
    assert.match(source, /Enter a valid email address/);
    assert.match(source, /Add a few details so we can help/);
  });

  it("routes data requests to legal and escapes email HTML", () => {
    assert.match(source, /supportRequestRecipient/);
    assert.match(source, /legal@thegrainline\.com/);
    assert.match(source, /supportRequestSubject/);
    assert.match(source, /"Data request"/);
    assert.match(source, /supportRequestHtml/);
    assert.match(source, /esc\(request\.message\)/);
  });

  it("computes a 45-day SLA due date for verifiable data requests", () => {
    assert.match(source, /supportRequestSlaDueAt/);
    assert.match(source, /45 \* 24 \* 60 \* 60 \* 1000/);
  });
});
