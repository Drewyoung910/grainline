import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("user text normalization followups", () => {
  it("sanitizes free-form message and case text before persistence", () => {
    const messages = source("src/app/messages/[id]/page.tsx");
    const caseCreate = source("src/app/api/cases/route.ts");
    const caseMessages = source("src/app/api/cases/[id]/messages/route.ts");
    const customOrder = source("src/app/api/messages/custom-order-request/route.ts");

    assert.match(messages, /const body = truncateText\(sanitizeText/);
    assert.match(caseCreate, /const description = sanitizeRichText\(parsed\.description\.trim\(\)\)/);
    assert.match(caseMessages, /const messageBody = sanitizeRichText\(parsed\.body\.trim\(\)\)/);
    assert.match(customOrder, /const cleanedDescription = truncateText\(sanitizeText/);
    assert.match(customOrder, /description: cleanedDescription/);
  });

  it("sanitizes checkout gift notes, reports, seller notes, and audit reasons", () => {
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const report = source("src/app/api/users/[id]/report/route.ts");
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const audit = source("src/lib/audit.ts");

    assert.match(sellerCheckout, /const giftNote = body\.giftNote \? truncateText\(sanitizeText\(body\.giftNote\), 200\) : ""/);
    assert.match(singleCheckout, /giftNote: body\.giftNote \? truncateText\(sanitizeText\(body\.giftNote\), 200\) : ""/);
    assert.match(report, /const details = body\.details \? truncateText\(sanitizeText\(body\.details\), 500\) \|\| null : null/);
    assert.match(fulfillment, /data\.sellerNotes = payload\.sellerNotes \? truncateText\(sanitizeText\(payload\.sellerNotes\), 2000\) \|\| null : null/);
    assert.match(audit, /reason: reason \? truncateText\(sanitizeText\(reason\), 500\) \|\| null : undefined/);
  });

  it("keeps shipping address fields single-line after sanitization", () => {
    const route = source("src/app/api/account/shipping-address/route.ts");

    assert.match(route, /function sanitizeAddressLine/);
    assert.match(route, /replace\(\s*\/\[\\r\\n\\u0085\\u2028\\u2029\]\+\/g,\s*" "\s*\)/);
    assert.match(route, /shippingLine1: sanitizeAddressLine\(body\.line1\)/);
  });

  it("sanitizes Guild verification application narrative text", () => {
    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const route = source("src/app/api/verification/apply/route.ts");

    assert.match(dashboard, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
    assert.match(dashboard, /const craftDescription = truncateText\(sanitizeText\(String\(formData\.get\("craftDescription"\) \?\? ""\)\), 500\)/);
    assert.match(dashboard, /const craftBusiness = truncateText\(sanitizeText\(String\(formData\.get\("craftBusiness"\) \?\? ""\)\), 500\)/);
    assert.match(route, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
    assert.match(route, /const craftDescription = truncateText\(sanitizeText\(verParsed\.craftDescription\), 500\)/);
  });
});
