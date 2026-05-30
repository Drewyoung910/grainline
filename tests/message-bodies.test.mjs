import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../src/lib/messageBodies.ts", import.meta.url), "utf8");

describe("message body parser guardrails", () => {
  it("keeps file message read paths behind trusted media URL validation", () => {
    assert.match(source, /import \{ isR2PublicUrl \} from "@\/lib\/urlValidation"/);
    assert.match(source, /MAX_FILE_MESSAGE_URL_LENGTH = 1000/);
    assert.match(source, /isAllowedUrl: \(url: string\) => boolean = isR2PublicUrl/);
    assert.match(source, /url\.length > MAX_FILE_MESSAGE_URL_LENGTH \|\| !isAllowedUrl\(url\)/);
  });

  it("sanitizes and caps file message metadata on read", () => {
    assert.match(source, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
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
});
