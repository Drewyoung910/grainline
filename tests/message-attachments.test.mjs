import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeMessageAttachments } = await import("../src/lib/messageAttachments.ts");

const isAllowedUrl = (url) => url.startsWith("https://cdn.thegrainline.com/");

describe("message attachment normalization", () => {
  it("sanitizes and caps client-provided attachment metadata before persistence", () => {
    const longName = `refund\u202E${"x".repeat(300)}.pdf`;
    const result = normalizeMessageAttachments(
      JSON.stringify([
        {
          url: "https://cdn.thegrainline.com/messageFile/user/123.pdf",
          name: longName,
          type: "application/pdf<script>",
        },
      ]),
      isAllowedUrl,
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].name?.includes("\u202E"), false);
    assert.equal(result[0].name?.length, 200);
    assert.equal(result[0].type, "application/pdf");
  });

  it("drops invalid URLs and caps attachment count", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      url: `https://cdn.thegrainline.com/messageFile/user/${index}.pdf`,
      name: `file-${index}.pdf`,
      type: "application/pdf",
    }));
    items.splice(1, 0, {
      url: "https://attacker.example/file.pdf",
      name: "bad.pdf",
      type: "application/pdf",
    });

    const result = normalizeMessageAttachments(JSON.stringify(items), isAllowedUrl);

    assert.equal(result.length, 6);
    assert.equal(result.some((item) => item.url.includes("attacker.example")), false);
  });
});
