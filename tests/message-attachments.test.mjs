import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../src/lib/messageAttachments.ts", import.meta.url), "utf8");

describe("message attachment normalization guardrails", () => {
  it("sanitizes and caps client-provided attachment metadata before persistence", () => {
    assert.match(source, /import \{ sanitizeText, truncateText \} from "@\/lib\/sanitize"/);
    assert.match(source, /const MAX_ATTACHMENT_NAME_LENGTH = 200/);
    assert.match(source, /const MAX_ATTACHMENT_TYPE_LENGTH = 100/);
    assert.match(source, /truncateText\(sanitizeAttachmentText\(value\), maxLength\)/);
  });

  it("strips dangerous protocol text from attachment names and types", () => {
    assert.match(source, /function sanitizeAttachmentText\(input: string\): string/);
    assert.match(source, /const ATTACHMENT_CONTROL_CHARS = \/\[\\u0000-\\u001F\\u007F\]\/g/);
    assert.match(source, /return sanitizeText\(input\)\.replace\(ATTACHMENT_CONTROL_CHARS, ""\)/);
    assert.doesNotMatch(source, /\.replace\(\/javascript:/);
  });

  it("drops invalid URLs and caps attachment count", () => {
    assert.match(source, /const MAX_MESSAGE_ATTACHMENTS = 6/);
    assert.match(source, /const MAX_ATTACHMENT_URL_LENGTH = 1000/);
    assert.match(source, /attachments\.length >= MAX_MESSAGE_ATTACHMENTS/);
    assert.match(source, /url\.length > MAX_ATTACHMENT_URL_LENGTH \|\| !isAllowedUrl\(url\)/);
  });
});
