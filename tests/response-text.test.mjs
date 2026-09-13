import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { readResponseTextWithTimeout } = await import("../src/lib/responseText.ts");

describe("bounded response text reads", () => {
  it("reads response bodies without changing the text", async () => {
    const response = new Response("shippo error details");
    assert.equal(await readResponseTextWithTimeout(response, { timeoutMs: 50 }), "shippo error details");
  });

  it("truncates large response bodies", async () => {
    const response = new Response("abcdef");
    assert.equal(
      await readResponseTextWithTimeout(response, { timeoutMs: 50, maxBytes: 3 }),
      "abc\n[response body truncated]",
    );
  });

  it("returns a timeout marker instead of waiting forever", async () => {
    const stream = new ReadableStream({
      start() {
        // Keep the stream open without yielding data.
      },
    });
    const response = new Response(stream);
    const text = await readResponseTextWithTimeout(response, { timeoutMs: 10 });
    assert.match(text, /timed out/);
  });
});
