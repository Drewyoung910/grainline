import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readBoundedJson,
  readBoundedText,
} from "../src/lib/requestBody.ts";

function requestWithBody(body, headers = {}) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers,
    body,
  });
}

describe("bounded request body helpers", () => {
  it("rejects oversized bodies from content-length before reading", async () => {
    const req = requestWithBody("{}", { "content-length": "999" });

    await assert.rejects(
      () => readBoundedText(req, 8),
      (error) => error instanceof RequestBodyTooLargeError && error.status === 413,
    );
  });

  it("rejects streamed bodies that exceed the byte limit", async () => {
    const req = requestWithBody("abcdefghijklmnop");

    await assert.rejects(
      () => readBoundedText(req, 8),
      (error) => error instanceof RequestBodyTooLargeError && error.maxBytes === 8,
    );
  });

  it("parses bounded JSON and rejects malformed JSON distinctly", async () => {
    assert.deepEqual(await readBoundedJson(requestWithBody('{"ok":true}'), 32), { ok: true });

    await assert.rejects(
      () => readBoundedJson(requestWithBody("{bad json"), 32),
      (error) => error instanceof InvalidJsonBodyError && error.status === 400,
    );
  });
});
