import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const {
  normalizeCheckoutShippingAddress,
  sanitizeAddressField,
} = await import("../src/lib/addressFields.ts");

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
    const ban = source("src/lib/ban.ts");

    assert.match(sellerCheckout, /const giftNote = body\.giftNote \? truncateText\(sanitizeText\(body\.giftNote\), 200\) : ""/);
    assert.match(singleCheckout, /giftNote: body\.giftNote \? truncateText\(sanitizeText\(body\.giftNote\), 200\) : ""/);
    assert.match(report, /const details = body\.details \? truncateText\(sanitizeText\(body\.details\), 500\) \|\| null : null/);
    assert.match(fulfillment, /const sellerNotes = payload\.sellerNotes \? truncateText\(sanitizeText\(payload\.sellerNotes\), 2000\) \|\| null : null/);
    assert.match(fulfillment, /data\.sellerNotes = sellerNotes/);
    assert.match(audit, /export function sanitizeAdminAuditReason/);
    assert.match(audit, /truncateText\(sanitizeText\(reason\), 500\) \|\| null/);
    assert.match(audit, /reason: sanitizeAdminAuditReason\(reason\)/);
    assert.match(ban, /import \{ sanitizeAdminAuditReason \} from '\.\/audit'/);
    assert.match(ban, /reason: sanitizeAdminAuditReason\(reason\)/);
  });

  it("keeps shipping address fields single-line after sanitization", () => {
    const route = source("src/app/api/account/shipping-address/route.ts");
    const seller = source("src/app/dashboard/seller/page.tsx");
    const checkoutSeller = source("src/app/api/cart/checkout-seller/route.ts");
    const checkoutSingle = source("src/app/api/cart/checkout/single/route.ts");
    const quote = source("src/app/api/shipping/quote/route.ts");

    assert.equal(sanitizeAddressField("123 Main\nFake Line 2\u2028Suite", 200), "123 Main Fake Line 2 Suite");
    assert.deepEqual(
      normalizeCheckoutShippingAddress({
        name: "Buyer\nName",
        line1: "123 Main\nFake Line",
        line2: "\u2028Apt 2",
        city: "Austin\nTX",
        state: "tx",
        postalCode: "78701",
        phone: "555\n1212",
      }),
      {
        name: "Buyer Name",
        line1: "123 Main Fake Line",
        line2: "Apt 2",
        city: "Austin TX",
        state: "TX",
        postalCode: "78701",
        phone: "555 1212",
      },
    );

    assert.match(route, /const RawAddressSchema = z\.object/);
    assert.match(route, /function normalizeShippingAddressInput/);
    assert.match(route, /body = AddressSchema\.parse\(normalizeShippingAddressInput\(\s*RawAddressSchema\.parse/s);
    assert.match(route, /name: sanitizeAddressName\(raw\.name\)/);
    assert.match(route, /line1: sanitizeAddressField\(raw\.line1, 200\)/);
    assert.match(route, /city: sanitizeAddressField\(raw\.city, 100\)/);
    assert.match(route, /state: sanitizeAddressField\(raw\.state, 2\)\.toUpperCase\(\)/);
    assert.match(route, /shippingName: body\.name/);
    assert.match(route, /shippingLine1: body\.line1/);
    assert.match(seller, /shipFromLine1[\s\S]*sanitizeAddressField\(rawShipFromLine1, 200\)/);
    assert.match(checkoutSeller, /const shippingAddress = normalizeCheckoutShippingAddress\(body\.shippingAddress\)/);
    assert.match(checkoutSingle, /const shippingAddress = normalizeCheckoutShippingAddress\(body\.shippingAddress\)/);
    assert.match(quote, /const sanitizedToCity = sanitizeOptionalAddressField\(body\.toCity, 100\)/);
    assert.match(quote, /const sanitizedToState = sanitizeOptionalAddressField\(body\.toState, 50\)/);
    assert.match(quote, /const sanitizedToCountry = sanitizeOptionalAddressField\(body\.toCountry, 2\)/);
    assert.match(quote, /postal: sanitizeAddressField\(body\.toPostal, 20\)/);
    assert.doesNotMatch(quote, /toName|toLine1|toLine2/);
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
