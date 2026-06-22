import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../src/lib/messageBodies.ts", import.meta.url), "utf8");
const {
  parseCommissionInterestMessageBody,
  parseCustomOrderLinkMessageBody,
  parseCustomOrderRequestMessageBody,
  parseThreadMessagesEvent,
} = await import("../src/lib/messageBodies.ts");

describe("message body parser guardrails", () => {
  it("keeps file message read paths behind trusted media URL validation", () => {
    assert.match(source, /import \{ isR2PublicUrl \} from "\.\/urlValidation\.ts"/);
    assert.match(source, /MAX_FILE_MESSAGE_URL_LENGTH = 1000/);
    assert.match(source, /isAllowedUrl: \(url: string\) => boolean = isR2PublicUrl/);
    assert.match(source, /url\.length > MAX_FILE_MESSAGE_URL_LENGTH \|\| !isAllowedUrl\(url\)/);
  });

  it("sanitizes and caps file message metadata on read", () => {
    assert.match(source, /import \{ sanitizeText, truncateText \} from "\.\/sanitize\.ts"/);
    assert.match(source, /MAX_FILE_MESSAGE_NAME_LENGTH = 200/);
    assert.match(source, /MAX_FILE_MESSAGE_TYPE_LENGTH = 100/);
    assert.match(source, /const FILE_MESSAGE_CONTROL_CHARS = \/\[\\u0000-\\u001F\\u007F\]\/g/);
    assert.match(source, /optionalCleanNullableString\(obj\.name, MAX_FILE_MESSAGE_NAME_LENGTH\)/);
    assert.match(source, /optionalCleanNullableString\(obj\.type, MAX_FILE_MESSAGE_TYPE_LENGTH\)/);
    assert.match(source, /truncateText\(sanitizeText\(value\)\.replace\(FILE_MESSAGE_CONTROL_CHARS, ""\), maxLength\)/);
  });

  it("keeps non-file structured message parsers shape-checked", () => {
    assert.match(source, /parseCommissionInterestMessageBody/);
    assert.match(source, /parseCustomOrderRequestMessageBody/);
    assert.match(source, /parseCustomOrderLinkMessageBody/);
    assert.match(source, /parseThreadMessagesEvent/);
    assert.match(source, /typeof obj\.senderId !== "string"/);
  });

  it("sanitizes non-file structured message text on read", () => {
    const commission = parseCommissionInterestMessageBody(JSON.stringify({
      commissionId: "commission_1",
      commissionTitle: "<b>Table</b>\u202e",
      sellerName: "java\u200bscript: Maker",
      timeline: "onload=soon",
    }));
    assert.equal(commission.commissionTitle, "Table");
    assert.equal(commission.sellerName, "Maker");
    assert.equal(commission.timeline, "soon");

    const request = parseCustomOrderRequestMessageBody(JSON.stringify({
      description: "<img src=x onerror=alert(1)>Walnut shelf\u0000",
      dimensions: "<script>alert(1)</script> 24 x 8",
      timelineLabel: "data: spring",
      listingTitle: "<em>Original</em> chair",
    }));
    assert.equal(request.description, "Walnut shelf");
    assert.equal(request.dimensions, "24 x 8");
    assert.equal(request.timelineLabel, "spring");
    assert.equal(request.listingTitle, "Original chair");

    const link = parseCustomOrderLinkMessageBody(JSON.stringify({
      listingId: "listing_1",
      title: "<strong>Custom desk</strong>",
      priceCents: 120000,
      currency: "usd<script>",
    }));
    assert.equal(link.title, "Custom desk");
    assert.equal(link.currency, "usd");

    const event = parseThreadMessagesEvent(JSON.stringify({
      type: "messages",
      messages: [{
        id: "msg_1",
        senderId: "user_1",
        recipientId: "user_2",
        body: "<b>Hello</b>\u0000",
        createdAt: "2026-06-01T00:00:00.000Z",
      }],
    }));
    assert.equal(event?.[0]?.body, "Hello");
  });
});
