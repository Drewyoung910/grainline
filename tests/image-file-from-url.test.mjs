import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

const originalFetch = globalThis.fetch;
const { fileFromUrl } = await import("../src/lib/imageFileFromUrl.ts");

after(() => {
  globalThis.fetch = originalFetch;
});

describe("image file fetch helper", () => {
  it("says what happened when the browser cannot reach the image", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await assert.rejects(
      () => fileFromUrl("https://example.com/blocked.jpg", "blocked.jpg", 1000),
      /Could not load this image/,
    );
  });

  it("aborts stalled image fetches instead of waiting forever", async () => {
    globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });

    await assert.rejects(
      () => fileFromUrl("https://example.com/slow.jpg", "slow.jpg", 1),
      /Could not load this image/,
    );
  });
});
